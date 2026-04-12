#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Build frontend and integrate it into the backend (macOS / Linux)
# Usage: bash deploy.sh [--skip-install]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"
STATIC_DIR="$BACKEND_DIR/app/static"
SKIP_INSTALL=false

for arg in "$@"; do
  [[ "$arg" == "--skip-install" ]] && SKIP_INSTALL=true
done

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║          Vocabox — Deploy Script         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Frontend dependencies ──────────────────────────────────────────────────
cd "$FRONTEND_DIR"

if [ "$SKIP_INSTALL" = false ]; then
  echo "[1/4] Installing frontend dependencies..."
  npm install --silent
  echo "      Done."
else
  echo "[1/4] Skipping npm install (--skip-install)."
fi

# ── 2. Build frontend ─────────────────────────────────────────────────────────
echo "[2/4] Building frontend..."
npm run build
echo "      Built → $FRONTEND_DIR/dist"

# ── 3. Copy dist → backend/app/static ────────────────────────────────────────
echo "[3/4] Copying dist to backend/app/static..."
rm -rf "$STATIC_DIR"
cp -r "$FRONTEND_DIR/dist" "$STATIC_DIR"
echo "      Copied → $STATIC_DIR"

# ── 4. Backend dependencies ───────────────────────────────────────────────────
cd "$BACKEND_DIR"
VENV_DIR="$BACKEND_DIR/.venv"

if [ "$SKIP_INSTALL" = false ]; then
  echo "[4/4] Installing backend dependencies..."
  if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
  fi
  source "$VENV_DIR/bin/activate"
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
  echo "      Done."
else
  echo "[4/4] Skipping pip install (--skip-install)."
fi

echo ""
echo "✓ Deploy complete."
echo ""
echo "  Start the server:   cd backend && bash start.sh"
echo "  App URL:            http://localhost:9009"
echo "  API docs:           http://localhost:9009/docs"
echo ""
