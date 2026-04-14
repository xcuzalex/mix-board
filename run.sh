#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$ROOT_DIR/ui"
MODE="${1:-web}"
DEV_URL="http://localhost:5173"
FRONTEND_PID=""
FRONTEND_LOG="/tmp/mixboard-ui-dev.log"

print_help() {
  cat <<'EOF'
MixBoard startup script

Usage:
  ./run.sh               Start frontend dev environment
  ./run.sh web           Start frontend dev environment
  ./run.sh desktop       Start Tauri desktop dev environment
  ./run.sh --help        Show help
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing command: $cmd"
    exit 1
  fi
}

cleanup() {
  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
}

is_dev_server_running() {
  curl -fsS "$DEV_URL" >/dev/null 2>&1
}

wait_for_dev_server() {
  local retries=60
  local count=0

  until is_dev_server_running; do
    count=$((count + 1))
    if [ "$count" -ge "$retries" ]; then
      echo "[MixBoard] Frontend dev server startup timed out. Check logs: $FRONTEND_LOG"
      exit 1
    fi
    sleep 1
  done
}

ensure_ui_dependencies() {
  require_cmd npm

  if [ ! -d "$UI_DIR/node_modules" ]; then
    echo "[MixBoard] First run, installing frontend dependencies..."
    (cd "$UI_DIR" && npm install)
  fi
}

run_web() {
  ensure_ui_dependencies
  echo "[MixBoard] Starting frontend dev environment: $DEV_URL"
  cd "$UI_DIR"
  npm run dev
}

run_desktop() {
  ensure_ui_dependencies
  require_cmd curl
  require_cmd cargo
  require_cmd rustc

  trap cleanup EXIT INT TERM

  if is_dev_server_running; then
    echo "[MixBoard] Frontend dev server already running: $DEV_URL"
  else
    echo "[MixBoard] Starting frontend dev server..."
    (
      cd "$UI_DIR"
      npm run dev -- --host 127.0.0.1 --strictPort
    ) >"$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    wait_for_dev_server
    echo "[MixBoard] Frontend dev server ready: $DEV_URL"
  fi

  echo "[MixBoard] Starting Tauri desktop dev environment..."
  cd "$UI_DIR"
  npm run tauri:dev
}

case "$MODE" in
  web)
    run_web
    ;;
  desktop)
    run_desktop
    ;;
  -h|--help|help)
    print_help
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo
    print_help
    exit 1
    ;;
esac
