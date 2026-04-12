# Vocabox — Deploy Guide

## Overview

Vocabox is a React SPA (frontend) served by a FastAPI backend (Python).
After deploy, a single server on port `9009` handles both the API (`/api/*`) and the web app.

```
http://localhost:9009/        → React app (index.html)
http://localhost:9009/api/*   → FastAPI endpoints
http://localhost:9009/docs    → Swagger UI
```

---

## Prerequisites

| Tool | Minimum version | Check |
|------|----------------|-------|
| Python | 3.11+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |

---

## Quick Deploy

### macOS / Linux

```bash
# From the project root:
bash deploy.sh
```

### Windows

```bat
REM From the project root:
deploy.bat
```

The script runs 4 steps automatically:

1. `npm install` — installs frontend dependencies
2. `npm run build` — compiles the React app into `frontend/dist/`
3. Copies `frontend/dist/` → `backend/app/static/`
4. Creates/updates Python virtualenv and installs backend dependencies

---

## Start the Server

### macOS / Linux

```bash
cd backend
bash start.sh
```

### Windows

```bat
cd backend
start.bat
```

The server starts on port `9009` by default (configurable via `.env`).

---

## Environment Configuration

Create `backend/.env` to override defaults:

```env
PORT=9009
SECRET_KEY=your-strong-secret-key-here
DATABASE_URL=sqlite:///./vocabox.db
ACCESS_TOKEN_EXPIRE_MINUTES=43200
```

**Important:** Change `SECRET_KEY` in production. Never commit `.env` to version control.

---

## Skip dependency install (faster re-deploy)

If dependencies haven't changed, skip the install steps:

```bash
bash deploy.sh --skip-install
```

```bat
deploy.bat --skip-install
```

---

## How it Works

### Build → Static

`npm run build` produces `frontend/dist/`:

```
frontend/dist/
├── index.html
├── sw.js               ← PWA service worker
├── workbox-*.js
└── assets/
    ├── index-*.js
    └── index-*.css
```

The deploy script copies this to `backend/app/static/`.

### FastAPI Static Serving

`backend/app/main.py` detects `app/static/` and mounts:

- `/assets/*` → `StaticFiles` (JS, CSS, images)
- `/sw.js` → service worker
- `/workbox-*` → Workbox runtime
- `/{any}` → `index.html` (SPA fallback for React Router)

API routes (`/auth`, `/words`, `/review`, etc.) are registered before the SPA fallback and take priority.

### PWA

The app is a Progressive Web App. After deploy it can be installed on desktop/mobile and works offline (cached assets via service worker).

---

## Development Mode

In development, run frontend and backend separately:

```bash
# Terminal 1 — backend (port 9009)
cd backend && bash start.sh

# Terminal 2 — frontend dev server (port 5173, with HMR)
cd frontend && npm run dev
```

The frontend Vite dev server proxies `/api` requests to `http://localhost:9009` automatically (`vite.config.ts`).

---

## Re-deploy After Changes

Every time you modify the frontend source, re-run the deploy script:

```bash
bash deploy.sh --skip-install   # skip npm/pip if only source files changed
```

Then restart the backend server to serve the updated static files.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 9009 already in use | `bash start.sh` kills the existing process automatically |
| `ModuleNotFoundError: aiofiles` | Run `bash deploy.sh` (not `--skip-install`) to update pip deps |
| White screen / 404 on refresh | Ensure `backend/app/static/` exists and contains `index.html` |
| API returns 401 | `SECRET_KEY` in `.env` changed — users need to log in again |
| Build fails: TypeScript errors | Run `npx tsc --noEmit` in `frontend/` to see errors |
