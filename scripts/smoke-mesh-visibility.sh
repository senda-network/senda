#!/usr/bin/env bash
# Smoke-test the mesh-visibility Slice 1-4 pipeline against production.
#
# Validates that the four moving parts of the auto-audit / auto-heal
# pipeline are alive and talking to each other:
#
#   1. Local runtime is auditing — `/api/status.mesh_visibility` is
#      present on this machine's :3131 (only on >=0.66.18 + --join-url).
#   2. Website ingest is alive — POST a synthetic peer-report and
#      assert HTTP 200 with `{"ok":true}`.
#   3. Website read-side is alive — GET /api/peer-report returns
#      the report we just posted.
#   4. Public /api/status surfaces it — the synthetic node appears in
#      the merged `nodes[]` with `state: "unreachable"` and the
#      meshVisibility snapshot we posted.
#
# A green run here means a real invisible peer would surface on the
# public status page within ~5 seconds — the May 2026 MSI failure
# mode is detected. A red run pinpoints which layer broke.
#
# Usage:
#   ./scripts/smoke-mesh-visibility.sh
#   ./scripts/smoke-mesh-visibility.sh https://closedmesh.com http://127.0.0.1:3131
#
# Exit codes:
#   0 — every layer green
#   1 — website ingest broken (POST /api/peer-report)
#   2 — website read-side broken (GET /api/peer-report)
#   3 — public /api/status missing the synthetic peer
#   4 — local runtime not running mesh-visibility audit
#       (warning only when local runtime is unreachable — script still
#        passes overall in that case so it can be used from CI)

set -euo pipefail

SITE="${1:-${CLOSEDMESH_SITE:-https://closedmesh.com}}"
ADMIN="${2:-${CLOSEDMESH_ADMIN_URL:-http://127.0.0.1:3131}}"

require_jq() {
    if ! command -v jq >/dev/null 2>&1; then
        echo "[smoke] this script needs jq (brew install jq / apt install jq)" >&2
        exit 99
    fi
}
require_jq

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*" >&2; }
amber() { printf "\033[33m%s\033[0m\n" "$*" >&2; }

# Unique-per-run synthetic id so concurrent runs don't collide and so
# we never accidentally collide with a real peer.
SYNTH_ID="smoke-$(date +%s)-$RANDOM"

# --- Layer 1: local runtime audit field --------------------------------------
echo "[1/4] local runtime mesh_visibility on $ADMIN"
if local_body="$(curl -fsS --max-time 5 "$ADMIN/api/status" 2>/dev/null)"; then
    state="$(jq -r '.mesh_visibility.state // "(missing)"' <<<"$local_body")"
    if [[ "$state" == "(missing)" ]]; then
        amber "  warning: this runtime does not emit mesh_visibility yet"
        amber "  (expected on closedmesh-llm <0.66.18 or when --join-url is unset)"
    else
        entry="$(jq -r '.mesh_visibility.entry_url' <<<"$local_body")"
        green "  state=$state entry=$entry"
    fi
else
    amber "  warning: local admin $ADMIN unreachable; continuing"
fi

# --- Layer 2: website ingest -------------------------------------------------
echo "[2/4] POST $SITE/api/peer-report"
body=$(jq -nc --arg id "$SYNTH_ID" '
  {
    node_id: $id,
    hostname: "smoke",
    version: "smoke",
    serving_models: ["smoke-model"],
    mesh_visibility: {
      state: "invisible",
      last_check_unix: (now | floor),
      last_visible_unix: ((now | floor) - 60),
      consecutive_invisible_count: 3,
      last_error: "smoke",
      entry_url: "https://mesh.closedmesh.com",
      soft_reconnect_triggered: true,
      hard_reset_triggered: false
    }
  }')
ingest="$(curl -fsS -X POST "$SITE/api/peer-report" \
    -H 'content-type: application/json' \
    -d "$body" 2>&1)" || { red "  ingest failed: $ingest"; exit 1; }
if [[ "$(jq -r '.ok // false' <<<"$ingest")" != "true" ]]; then
    red "  ingest returned non-ok: $ingest"
    exit 1
fi
green "  ingest ok"

# --- Layer 3: website read-side ----------------------------------------------
echo "[3/4] GET $SITE/api/peer-report"
list="$(curl -fsS "$SITE/api/peer-report")" || { red "  list fetch failed"; exit 2; }
if ! jq -e --arg id "$SYNTH_ID" '.reports[] | select(.nodeId == $id)' <<<"$list" >/dev/null; then
    red "  $SYNTH_ID missing from /api/peer-report"
    exit 2
fi
green "  $SYNTH_ID found in reports list"

# --- Layer 4: public /api/status sees it -------------------------------------
echo "[4/4] GET $SITE/api/status"
status="$(curl -fsS "$SITE/api/status")" || { red "  status fetch failed"; exit 3; }
node_count="$(jq -r '.nodeCount' <<<"$status")"
if ! jq -e --arg id "$SYNTH_ID" '.nodes[] | select(.id == $id) | select(.state == "unreachable") | select(.meshVisibility.state == "invisible")' <<<"$status" >/dev/null; then
    red "  /api/status did not surface $SYNTH_ID as invisible"
    echo "  nodeCount=$node_count" >&2
    jq -r '.nodes[] | "    id=\(.id) state=\(.state) visibility=\(.meshVisibility.state // "null")"' <<<"$status" >&2
    exit 3
fi
green "  $SYNTH_ID surfaces as unreachable+invisible (nodeCount=$node_count)"

echo
green "all 4 layers OK"
