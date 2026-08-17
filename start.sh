#!/usr/bin/env bash
# EchoType — start local API (transcript proxy) + frontend with one command.
# Usage: ./start.sh
set -e
cd "$(dirname "$0")"

# --- Prepare frontend deps ---
if [ ! -d node_modules ]; then
  echo "==> Installing npm dependencies..."
  npm install
fi

API_PID=""
FRONTEND_PID=""

cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

# --- Local API (port 8000, proxied by Vite for /api/*) ---
if curl -s --max-time 2 http://127.0.0.1:8000/api/transcript -o /dev/null; then
  echo "==> API already running on http://localhost:8000 (skipping)"
else
  echo "==> Starting local API on http://localhost:8000 ..."
  node server.mjs &
  API_PID=$!
  for i in $(seq 1 30); do
    if curl -s --max-time 1 http://127.0.0.1:8000/api/transcript -o /dev/null; then break; fi
    sleep 0.5
  done
fi

# --- Frontend (port 5173) ---
if curl -s --max-time 2 http://localhost:5173/ -o /dev/null; then
  echo "==> Frontend already running on http://localhost:5173 (skipping)"
else
  echo "==> Starting frontend on http://localhost:5173 ..."
  npm run dev &
  FRONTEND_PID=$!
  for i in $(seq 1 30); do
    if curl -s --max-time 1 http://localhost:5173/ -o /dev/null; then break; fi
    sleep 0.5
  done
fi

echo ""
echo "EchoType is ready:  http://localhost:5173/"
echo "Press Ctrl+C to stop both servers."

wait
