#!/usr/bin/env bash
set -e

VENV_DIR=".venv"

echo "=== Vocabox Backend ==="

# ── Virtual environment ────────────────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "[1/3] Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "      Done."
else
    echo "[1/3] Virtual environment already exists — skipping."
fi

# ── Activate ───────────────────────────────────────────────────────────────────
source "$VENV_DIR/bin/activate"

# ── Dependencies ───────────────────────────────────────────────────────────────
echo "[2/3] Installing / updating dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "      Done."

# ── Run ────────────────────────────────────────────────────────────────────────
echo "[3/3] Starting server (port from .env, default 9009)..."
echo "      Docs → http://localhost:$(python -c "from app.config import settings; print(settings.PORT)")/docs"
echo ""
python run.py
