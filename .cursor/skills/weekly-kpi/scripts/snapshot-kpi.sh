#!/usr/bin/env bash
# Snapshot Senda KPIs from /api/status for weekly reports.
#
#   ./scripts/snapshot-kpi.sh
#   ./scripts/snapshot-kpi.sh http://127.0.0.1:3131 Qwen3-32B-Q4_K_M
#   ./scripts/snapshot-kpi.sh --save
#   ./scripts/snapshot-kpi.sh https://senda.network/api/status Qwen3-8B-Q4_K_M --save
#
# With --save, writes internal/kpi/YYYY-Www.json (gitignored).

set -euo pipefail

SAVE=false
ARGS=()
for a in "$@"; do
  if [[ "$a" == "--save" ]]; then SAVE=true; else ARGS+=("$a"); fi
done

BASE="${ARGS[0]:-${SENDA_KPI_STATUS_URL:-https://entry.senda.network/api/status}}"
FLAGSHIP="${ARGS[1]:-${SENDA_KPI_FLAGSHIP_MODEL:-Qwen3-8B-Q4_K_M}}"

# Allow passing full status URL (mesh entry or website proxy path).
if [[ "$BASE" == */api/status ]]; then
  STATUS_URL="$BASE"
elif [[ "$BASE" == http*://* ]]; then
  STATUS_URL="${BASE%/}/api/status"
else
  STATUS_URL="${BASE%/}/api/status"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[snapshot-kpi] needs jq" >&2
  exit 1
fi

if ! body="$(curl -fsS --max-time 15 "$STATUS_URL" 2>/dev/null)"; then
  echo "[snapshot-kpi] could not reach $STATUS_URL" >&2
  exit 1
fi

# ISO week label (GNU date on Linux; gdate on macOS if needed).
week_label() {
  if date -u +%G-W%V >/dev/null 2>&1; then
    date -u +%G-W%V
  else
    date -u +%Y-W%U
  fi
}

snapshot="$(jq -c --arg m "$FLAGSHIP" --arg url "$STATUS_URL" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  def backends: [(.peers // [])[] | .capability.backend // empty] | unique | sort;
  def contrib_vram: [.peers[]? | (.capability.vram_gb // .vram_gb // 0)] | add // 0;
  def tps_vals: [.peers[]?, .] | map(.measured_tps_p50_by_model[$m] // empty) | map(select(. > 0));
  def ttft_vals: [.peers[]?, .] | map(.measured_ttft_ms_p50_by_model[$m] // empty) | map(select(. > 0));
  def serving(n): (
    ((n.serving_models // []) + (n.hosted_models // []) + (n.capability.loadedModels // []))
    | index($m) != null
  );
  {
    captured_at: $at,
    status_url: $url,
    flagship_model: $m,
    runtime_version: (.version // null),
    peer_count: ((.peers // []) | length),
    backends: backends,
    pooled_vram_gb: (contrib_vram + (.my_vram_gb // 0)),
    flagship: {
      contributors: ([.peers[]?, .] | map(select(serving(.))) | length),
      tps_p50_median: (tps_vals | if length > 0 then (sort | if length % 2 == 1 then .[length/2|floor] else (.[length/2-1] + .[length/2]) / 2 end) else null end),
      ttft_ms_best: (ttft_vals | if length > 0 then min else null end),
      tps_sample_count: (tps_vals | length),
      ttft_sample_count: (ttft_vals | length)
    },
    models_available: ((.serving_models // []) + (.hosted_models // []) | unique | length)
  }
' <<<"$body")"

echo "$snapshot" | jq .

if [[ "$SAVE" == true ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/../../../../" && pwd)"
  OUT_DIR="$REPO_ROOT/internal/kpi"
  mkdir -p "$OUT_DIR"
  OUT_FILE="$OUT_DIR/$(week_label).json"
  echo "$snapshot" | jq . >"$OUT_FILE"
  echo "[snapshot-kpi] saved $OUT_FILE" >&2
fi
