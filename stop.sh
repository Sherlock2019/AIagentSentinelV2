#!/usr/bin/env bash
# Stop the AgentSentinel services started by ./start.sh (and only those).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.run"
stopped=0

stop_service() {
  local name="$1" pid_file="$2" signature="$3" pid
  [ -f "$pid_file" ] || return 0
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  rm -f "$pid_file"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 0

  # PIDs get recycled: only signal the process if it really is our service.
  if ! tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "$signature" \
     && ! ps -p "$pid" -o args= 2>/dev/null | grep -q "$signature"; then
    echo "[sentinel] PID $pid is no longer the $name — leaving it alone."
    return 0
  fi

  kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 25); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null
  fi
  echo "[sentinel] Stopped $name (PID $pid)"
  stopped=1
}

stop_service "frontend" "$RUN_DIR/frontend.pid" "vite"
stop_service "backend" "$RUN_DIR/backend.pid" "uvicorn"

[ "$stopped" = 1 ] || echo "[sentinel] Nothing to stop — AgentSentinel is not running."
exit 0
