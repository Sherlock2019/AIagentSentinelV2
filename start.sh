#!/usr/bin/env bash
# AgentSentinel — one-command launcher.
#   chmod +x start.sh && ./start.sh
# No Docker, no sudo, no API keys. Ctrl+C stops everything it started.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

HOST=127.0.0.1
# Override the ports only if you need to:
#   SENTINEL_BACKEND_PORT=8010 SENTINEL_FRONTEND_PORT=5183 ./start.sh
BACKEND_PORT="${SENTINEL_BACKEND_PORT:-8000}"
FRONTEND_PORT="${SENTINEL_FRONTEND_PORT:-5173}"

# Public mode: serve the dashboard on every interface so it is reachable on the
# machine's public IP (e.g. an AWS EC2 instance). Auto-enabled on EC2.
#   ./start.sh --public     force on        ./start.sh --local     force off
PUBLIC="${SENTINEL_PUBLIC:-auto}"
for arg in "$@"; do
  case "$arg" in
    --public) PUBLIC=1 ;;
    --local)  PUBLIC=0 ;;
    -h|--help) sed -n '2,4p' "$0"; echo "#   ./start.sh [--public | --local]"; exit 0 ;;
    *) echo "Unknown option: $arg (use --public or --local)" >&2; exit 2 ;;
  esac
done
RUN_DIR="$ROOT/.run"
VENV="$ROOT/.venv"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_PID=""
FRONTEND_PID=""

info() { printf '\033[1;34m[sentinel]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[sentinel] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- prerequisites
command -v python3 >/dev/null 2>&1 || fail "python3 not found. Install Python 3.11+ (https://www.python.org/downloads/)."
command -v node    >/dev/null 2>&1 || fail "node not found. Install Node.js 18+ (https://nodejs.org/)."
command -v npm     >/dev/null 2>&1 || fail "npm not found. It ships with Node.js (https://nodejs.org/)."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || fail "Python 3.11+ is required (found $(python3 --version 2>&1))."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' \
  || fail "Node.js 18+ is required (found $(node --version))."

mkdir -p "$RUN_DIR" "$ROOT/data"

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
port_in_use() {
  python3 - "$HOST" "$1" <<'PY'
import socket, sys
with socket.socket() as s:
    s.settimeout(0.5)
    sys.exit(0 if s.connect_ex((sys.argv[1], int(sys.argv[2]))) == 0 else 1)
PY
}
http_ok() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
sys.exit(0 if urllib.request.urlopen(sys.argv[1], timeout=2).status == 200 else 1)
PY
}

# ------------------------------------------- stop anything from a previous run
# 1. Services this checkout started earlier (PID files).
"$ROOT/stop.sh" 2>/dev/null | grep -v "Nothing to stop" || true

# 2. Whatever still listens on our two ports: an older copy, an orphan, a stray server.
port_pids() {
  {
    ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2
    command -v lsof >/dev/null 2>&1 && lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null
  } | sort -u
}
free_port() {
  local port="$1" pids pid
  pids="$(port_pids "$port" || true)"
  if [ -z "$pids" ]; then
    port_in_use "$port" || return 0
    fail "Port $port is in use by a process this user cannot see (another user or root).
         Find it with:  sudo ss -ltnp | grep :$port   and stop it, or pick other ports:
           SENTINEL_BACKEND_PORT=8010 SENTINEL_FRONTEND_PORT=5183 ./start.sh"
  fi
  for pid in $pids; do
    info "Port $port is held by PID $pid ($(ps -p "$pid" -o args= 2>/dev/null | cut -c1-70)) — stopping it"
    kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 25); do
    port_in_use "$port" || return 0
    sleep 0.2
  done
  for pid in $(port_pids "$port" || true); do kill -KILL "$pid" 2>/dev/null || true; done
  sleep 0.5
  port_in_use "$port" && fail "Could not free port $port (owned by another user?). Try: sudo ss -ltnp | grep :$port"
  return 0
}
free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

# ----------------------------------------------------------- public / EC2 mode
# Ask the EC2 metadata service (IMDSv2) for this instance's public IP. Prints nothing off EC2.
ec2_public_ip() {
  python3 - <<'PY' 2>/dev/null || true
import urllib.request
base = "http://169.254.169.254/latest/"
token = urllib.request.urlopen(urllib.request.Request(
    base + "api/token", method="PUT", headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"}), timeout=1).read().decode()
print(urllib.request.urlopen(urllib.request.Request(
    base + "meta-data/public-ipv4", headers={"X-aws-ec2-metadata-token": token}), timeout=1).read().decode().strip())
PY
}
PUBLIC_IP="${SENTINEL_PUBLIC_IP:-}"
if [ "$PUBLIC" != 0 ] && [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="$(ec2_public_ip)"
fi
if [ "$PUBLIC" = auto ]; then
  if [ -n "$PUBLIC_IP" ]; then PUBLIC=1; else PUBLIC=0; fi
fi
FRONTEND_BIND="$HOST"
if [ "$PUBLIC" = 1 ]; then
  FRONTEND_BIND=0.0.0.0
  export SENTINEL_PUBLIC=1
  info "Public mode: dashboard will listen on all interfaces${PUBLIC_IP:+ (public IP $PUBLIC_IP)}"
fi

# ------------------------------------------------------------- python backend
if [ ! -x "$VENV/bin/python" ]; then
  info "Creating Python virtual environment (.venv)"
  python3 -m venv "$VENV" || fail "Could not create a virtualenv. On Debian/Ubuntu install it with: apt install python3-venv"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

REQ_HASH="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' backend/requirements.txt)"
if [ "$(cat "$VENV/.requirements.sha256" 2>/dev/null || true)" != "$REQ_HASH" ]; then
  info "Installing backend dependencies"
  python -m pip install --quiet --disable-pip-version-check -r backend/requirements.txt \
    || fail "pip install failed. Check your network connection and try again."
  echo "$REQ_HASH" > "$VENV/.requirements.sha256"
else
  info "Backend dependencies up to date"
fi

# ------------------------------------------------------------ node frontend
LOCK_FILE="frontend/package-lock.json"
[ -f "$LOCK_FILE" ] || LOCK_FILE="frontend/package.json"
LOCK_HASH="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$LOCK_FILE")"
if [ ! -d frontend/node_modules ] || [ "$(cat frontend/node_modules/.install-hash 2>/dev/null || true)" != "$LOCK_HASH" ]; then
  info "Installing frontend dependencies (first run takes a minute)"
  if [ -f frontend/package-lock.json ]; then
    (cd frontend && npm ci --no-audit --no-fund --loglevel=error) || fail "npm ci failed. Check your network connection and try again."
  else
    (cd frontend && npm install --no-audit --no-fund --loglevel=error) || fail "npm install failed. Check your network connection and try again."
  fi
  echo "$LOCK_HASH" > frontend/node_modules/.install-hash
else
  info "Frontend dependencies up to date"
fi

# -------------------------------------------------------------------- config
if [ ! -f .env ]; then
  cp .env.example .env
  info "Created .env from .env.example (AI_PROVIDER=mock — no API key needed)"
fi

# ------------------------------------------------------------------- cleanup
CLEANED=0
cleanup() {
  [ "$CLEANED" = 1 ] && return
  CLEANED=1
  trap - INT TERM EXIT
  echo
  info "Stopping AgentSentinel..."
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    pid_alive "$pid" && kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 25); do
    pid_alive "$FRONTEND_PID" || pid_alive "$BACKEND_PID" || break
    sleep 0.2
  done
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    pid_alive "$pid" && kill -KILL "$pid" 2>/dev/null || true
  done
  # Only remove PID files that are still ours: a newer ./start.sh may have replaced this run.
  [ "$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)" = "$BACKEND_PID" ] && rm -f "$BACKEND_PID_FILE"
  [ "$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)" = "$FRONTEND_PID" ] && rm -f "$FRONTEND_PID_FILE"
  info "Stopped."
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# ---------------------------------------------------------- database + seed
info "Initializing database and demo data"
(cd backend && python -m app.database.seed) || fail "Database initialization failed (see output above)."

# ------------------------------------------------------------------ backend
info "Starting FastAPI backend on http://$HOST:$BACKEND_PORT"
# `exec` makes the recorded PID the server itself, so nothing is orphaned on stop.
(cd backend && exec python -m uvicorn app.main:app --host "$HOST" --port "$BACKEND_PORT" --log-level warning) \
  > "$RUN_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

for attempt in $(seq 1 60); do
  if http_ok "http://$HOST:$BACKEND_PORT/health"; then break; fi
  if ! pid_alive "$BACKEND_PID"; then
    tail -n 30 "$RUN_DIR/backend.log" >&2 || true
    fail "Backend exited during startup. Full log: $RUN_DIR/backend.log"
  fi
  [ "$attempt" = 60 ] && { tail -n 30 "$RUN_DIR/backend.log" >&2 || true; fail "Backend did not become healthy within 30s. Log: $RUN_DIR/backend.log"; }
  sleep 0.5
done
info "Backend healthy"

# ----------------------------------------------------------------- frontend
info "Starting Vite frontend on http://$FRONTEND_BIND:$FRONTEND_PORT"
export VITE_BACKEND_URL="http://$HOST:$BACKEND_PORT"  # where the dev server proxies /api
(cd frontend && exec node node_modules/vite/bin/vite.js --host "$FRONTEND_BIND" --port "$FRONTEND_PORT" --strictPort) \
  > "$RUN_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$FRONTEND_PID_FILE"

for attempt in $(seq 1 60); do
  if port_in_use "$FRONTEND_PORT"; then break; fi
  if ! pid_alive "$FRONTEND_PID"; then
    tail -n 30 "$RUN_DIR/frontend.log" >&2 || true
    fail "Frontend exited during startup. Full log: $RUN_DIR/frontend.log"
  fi
  [ "$attempt" = 60 ] && fail "Frontend did not start within 30s. Log: $RUN_DIR/frontend.log"
  sleep 0.5
done

cat <<EOF

================================================

       AGENTSENTINEL IS RUNNING

================================================

Dashboard:

http://localhost:$FRONTEND_PORT

FastAPI:

http://localhost:$BACKEND_PORT

API Docs:

http://localhost:$BACKEND_PORT/docs

Health:

http://localhost:$BACKEND_PORT/health

Press Ctrl+C to stop.

================================================

EOF

if [ "$PUBLIC" = 1 ]; then
  SHOWN_IP="${PUBLIC_IP:-<this-machine-public-ip>}"
  cat <<EOF
PUBLIC ACCESS (one port — the API stays on localhost and is reached through the dashboard):

Dashboard:   http://$SHOWN_IP:$FRONTEND_PORT
API Docs:    http://$SHOWN_IP:$FRONTEND_PORT/docs
Health:      http://$SHOWN_IP:$FRONTEND_PORT/health

AWS: allow inbound TCP $FRONTEND_PORT in the instance's security group.
     This POC has NO LOGIN — restrict the rule to your own IP ("My IP"), not 0.0.0.0/0.

================================================

EOF
fi

# Stay in the foreground; if either service dies, shut the other down too.
while pid_alive "$BACKEND_PID" && pid_alive "$FRONTEND_PID"; do
  sleep 1
done
pid_alive "$BACKEND_PID" || { echo; info "Backend stopped unexpectedly. Log: $RUN_DIR/backend.log"; }
pid_alive "$FRONTEND_PID" || { echo; info "Frontend stopped unexpectedly. Log: $RUN_DIR/frontend.log"; }
exit 1
