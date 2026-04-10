#!/usr/bin/env bash
set -e

VENV_DIR=".venv"

echo "=== Vocabox Backend ==="

# ── Read PORT from .env (fallback to 9009) ────────────────────────────────────
PORT=9009
if [ -f ".env" ]; then
    _PORT=$(grep -E "^PORT=[0-9]+" .env | cut -d'=' -f2 | tr -d '[:space:]')
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
if [ ! -d "$VENV_DIR" ]; then
    echo "[1/3] Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "      Done."
else
    echo "[1/3] Virtual environment already exists — skipping."
fi

# ── Activate ──────────────────────────────────────────────────────────────────
source "$VENV_DIR/bin/activate"

# ── Dependencies ──────────────────────────────────────────────────────────────
echo "[2/3] Installing / updating dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "      Done."

# ── Run ───────────────────────────────────────────────────────────────────────
echo "[3/3] Starting server on port $PORT..."
echo "      Docs → http://localhost:${PORT}/docs"
echo ""
python run.py
