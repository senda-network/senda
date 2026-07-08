#!/usr/bin/env bash
# scripts/dev.sh — bring up the whole Senda dev stack.
#
# - Starts the senda runtime in --private-only mode if it isn't already
#   running on 9337.
# - Starts the Next.js dev server.
# - Tears the runtime child process down on exit.
#
# Configurable via env:
#   SENDA_BIN  — path to the runtime binary
#                     (default: ../senda-llm/target/release/senda)
#   MODEL           — model id to load (default: Qwen3-0.6B-Q4_K_M)
#   API_PORT        — OpenAI-compatible API port (default: 9337)
#   ADMIN_PORT      — admin port (default: 3131)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_RUNTIME_BIN="$REPO_ROOT/../senda-llm/target/release/senda"

RUNTIME_BIN="${SENDA_BIN:-${MESH_BIN:-$DEFAULT_RUNTIME_BIN}}"
MODEL="${MODEL:-Qwen3-0.6B-Q4_K_M}"
API_PORT="${API_PORT:-9337}"
ADMIN_PORT="${ADMIN_PORT:-${CONSOLE_PORT:-3131}}"

API_URL="http://127.0.0.1:${API_PORT}/v1"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { color "0;36" "[senda] $*"; }
warn() { color "0;33" "[senda] $*"; }
err()  { color "0;31" "[senda] $*" >&2; }

LOG_DIR="$REPO_ROOT/.senda"
mkdir -p "$LOG_DIR"
RUNTIME_LOG="$LOG_DIR/runtime.log"

RUNTIME_PID=""

cleanup() {
  if [[ -n "$RUNTIME_PID" ]] && kill -0 "$RUNTIME_PID" 2>/dev/null; then
    info "Stopping senda runtime (pid $RUNTIME_PID)…"
    kill "$RUNTIME_PID" 2>/dev/null || true
    wait "$RUNTIME_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if curl -fsS "$API_URL/models" >/dev/null 2>&1; then
  info "senda runtime already serving on :${API_PORT}, reusing it."
else
  if [[ ! -x "$RUNTIME_BIN" ]]; then
    err "senda binary not found or not executable at: $RUNTIME_BIN"
    err "Build it first: cd ../senda-llm && cargo build --release -p mesh-llm"
    exit 1
  fi

  info "Starting senda (--private-only, model=$MODEL)…"
  info "  log: $RUNTIME_LOG"
  "$RUNTIME_BIN" serve --private-only --model "$MODEL" --headless \
    --port "$API_PORT" --console "$ADMIN_PORT" \
    >"$RUNTIME_LOG" 2>&1 &
  RUNTIME_PID=$!

  info "Waiting for $API_URL/models to come up…"
  for i in $(seq 1 120); do
    if curl -fsS "$API_URL/models" >/dev/null 2>&1; then
      info "senda ready (pid $RUNTIME_PID, ${i}s)"
      break
    fi
    if ! kill -0 "$RUNTIME_PID" 2>/dev/null; then
      err "senda exited before becoming ready. Last log lines:"
      tail -n 40 "$RUNTIME_LOG" >&2 || true
      exit 1
    fi
    sleep 1
  done

  if ! curl -fsS "$API_URL/models" >/dev/null 2>&1; then
    err "senda did not become ready within 120s. Last log lines:"
    tail -n 40 "$RUNTIME_LOG" >&2 || true
    exit 1
  fi
fi

info "Runtime API:   $API_URL"
info "Runtime admin: http://127.0.0.1:${ADMIN_PORT}"
info "Website:       http://127.0.0.1:9338"
info "Starting Next.js dev server…"

cd "$REPO_ROOT"
npm run dev
