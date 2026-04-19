#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VENV_DIR="$PROJECT_ROOT/.venv"

echo "=== Vocabox Backend ==="

# ── Read PORT from .env (fallback to 9009) ────────────────────────────────────
PORT=9009
if [ -f "$SCRIPT_DIR/.env" ]; then
    _PORT=$(grep -E "^PORT=[0-9]+" "$SCRIPT_DIR/.env" | cut -d'=' -f2 | tr -d '[:space:]')
    [ -n "$_PORT" ] && PORT="$_PORT"
fi

# ── Free the port if something is already listening on it ─────────────────────
echo "[0/3] Checking port $PORT..."
_freed=0
if command -v fuser &>/dev/null; then
    if fuser "${PORT}/tcp" &>/dev/null 2>&1; then
        fuser -k "${PORT}/tcp" 2>/dev/null || true
        _freed=1
    fi
elif command -v lsof &>/dev/null; then
    _pids=$(lsof -ti:"${PORT}" 2>/dev/null || true)
    if [ -n "$_pids" ]; then
        echo "$_pids" | xargs kill -9 2>/dev/null || true
        _freed=1
    fi
fi
if [ "$_freed" -eq 1 ]; then
    echo "      Process on port $PORT stopped."
else
    echo "      Port $PORT is free."
fi

# ── Virtual environment ───────────────────────────────────────────────────────
if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "[1/3] Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "      Done."
else
    echo "[1/3] Virtual environment already exists — skipping."
fi

# ── Activate ──────────────────────────────────────────────────────────────────
source "$VENV_DIR/bin/activate"

# ── Dependencies (hash-based: only install when requirements.txt changes) ─────
echo "[2/3] Checking dependencies..."
REQS="$SCRIPT_DIR/requirements.txt"
HASH_FILE="$VENV_DIR/.deps_vocabox_backend"
_hash=$(md5sum "$REQS" 2>/dev/null | cut -d' ' -f1)
if [ "$(cat "$HASH_FILE" 2>/dev/null)" != "$_hash" ]; then
    echo "      Installing missing dependencies..."
    pip install --quiet --upgrade pip
    pip install --quiet -r "$REQS"
    echo "$_hash" > "$HASH_FILE"
    echo "      Done."
else
    echo "      Dependencies up to date — skipping install."
fi

# ── Run ───────────────────────────────────────────────────────────────────────
echo "[3/3] Starting server on port $PORT..."
echo "      Docs → https://backend.patchamama.com:${PORT}/docs"
echo ""
cd "$SCRIPT_DIR" && python run.py
