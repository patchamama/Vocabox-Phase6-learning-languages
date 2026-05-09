# Vocabox — Spaced Repetition Language Learning

A mobile-first Progressive Web App for vocabulary learning based on the **Leitner box system** (7-box spaced repetition). Cards advance through boxes as you answer correctly, and intervals grow automatically — so you review what you're about to forget, not what you already know.

![License](https://img.shields.io/badge/license-MIT-blue)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109-green)
![React](https://img.shields.io/badge/React-18-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6)

---

## Features

- **7-box Leitner system** — correct answer promotes the card, wrong answer resets it to box 0
- **Two exercise types** — free-write (type the translation) and multiple-choice
- **Audio** — Web Speech API plays any word in its source language
- **PWA** — installable on mobile, works offline after first load
- **Dark-mode UI** — mobile-first design with Tailwind CSS
- **JWT authentication** — register, login, persistent sessions
- **Statistics dashboard** — box distribution chart, pending cards, streak, accuracy
- **Topics (temas)** — colour-coded vocabulary groups

---

## Tech Stack

| Layer     | Technology                                      |
|-----------|-------------------------------------------------|
| Backend   | Python · FastAPI · SQLAlchemy 2 · SQLite · JWT  |
| Frontend  | React 18 · TypeScript · Zustand · Tailwind CSS  |
| Build     | Vite · vite-plugin-pwa · Workbox                |
| Auth      | python-jose · passlib (bcrypt)                  |

---

## Project Structure

```
vocabox/
├── backend/
│   ├── run.py                    # Entry point — reads PORT from .env
│   ├── app/
│   │   ├── main.py               # FastAPI app entry point
│   │   ├── config.py             # Settings (pydantic-settings)
│   │   ├── database.py           # SQLite engine & session
│   │   ├── dependencies.py       # get_current_user dependency
│   │   ├── models/               # SQLAlchemy ORM models
│   │   │   ├── user.py
│   │   │   ├── tema.py
│   │   │   ├── word.py
│   │   │   └── user_word.py
│   │   ├── schemas/              # Pydantic v2 request/response schemas
│   │   ├── services/
│   │   │   ├── auth.py           # JWT creation & bcrypt helpers
│   │   │   └── spaced_repetition.py  # Box-interval logic
│   │   └── routers/
│   │       ├── auth.py           # POST /auth/register, /auth/login, GET /auth/me
│   │       ├── words.py          # GET|POST /words, DELETE /words/{id}
│   │       ├── review.py         # GET /review, POST /review/answer
│   │       ├── stats.py          # GET /stats
│   │       └── temas.py          # GET|POST /temas
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── api/client.ts         # Axios instance + API helpers
    │   ├── stores/
    │   │   ├── authStore.ts      # Zustand auth store (persisted)
    │   │   └── reviewStore.ts    # Zustand review session store
    │   ├── pages/
    │   │   ├── Login.tsx
    │   │   ├── Register.tsx
    │   │   ├── Dashboard.tsx     # Stats overview + start review CTA
    │   │   ├── Review.tsx        # Active learning session
    │   │   ├── Words.tsx         # Vocabulary management
    │   │   └── Stats.tsx         # Charts & progress
    │   └── components/
    │       ├── exercises/
    │       │   ├── WriteExercise.tsx
    │       │   └── MultipleChoiceExercise.tsx
    │       ├── Layout.tsx
    │       └── NavBar.tsx
    ├── vite.config.ts
    ├── tailwind.config.js
    └── package.json
```

---

## Box System

| Box | Review interval |
|-----|----------------|
| 0   | Immediately    |
| 1   | 1 day          |
| 2   | 2 days         |
| 3   | 4 days         |
| 4   | 7 days         |
| 5   | 14 days        |
| 6   | 30 days        |

**Correct answer** → card moves to the next box.  
**Wrong answer** → card returns to box 0.

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+

---

### Backend

```bash
cd backend

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate        # Linux / macOS
# .venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env — set a strong SECRET_KEY and optionally change PORT

# Start the development server
python run.py
```

The API will be available at `http://localhost:9009` (or whichever `PORT` you set).  
Interactive docs: `http://localhost:9009/docs`

> The SQLite database file (`vocabox.db`) is created automatically on first run.

---

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`.

> The Vite dev server proxies all `/api/*` requests to the backend port configured in `vite.config.ts` (default: `9009`), so no CORS issues during development.

---

### Build for Production

```bash
# Backend — run behind a reverse proxy (nginx, caddy, etc.)
python run.py   # reads host/port from .env

# Frontend
cd frontend
npm run build        # Output: frontend/dist/
npm run preview      # Preview the production build locally
```

> Note: If you enable "Use Ollama directly from frontend", requests to `http://localhost:11434` are executed by the browser on the end-user machine. That machine must have Ollama running and CORS configured (`OLLAMA_ORIGINS`). Otherwise, keep backend fallback enabled.

---

## Ollama Directly From Frontend (CORS Setup)

You can configure the app to query Ollama directly from the browser (instead of backend-first) for the "Enhance with AI" flow.

### 1. Enable frontend Ollama in app settings

In **Settings → Ollama**:

- Enable: `Use Ollama directly from frontend`
- Select an Ollama model

### 2. Allow your web origin in Ollama (`OLLAMA_ORIGINS`)

Set `OLLAMA_ORIGINS` to the exact origin(s) where your app runs.

Examples:

```bash
OLLAMA_ORIGINS=https://your-domain.com
```

or multiple origins:

```bash
OLLAMA_ORIGINS=https://your-domain.com,http://localhost:5173
```

Notes:

- Use exact origins (scheme + host + optional port).
- Avoid `*` in production.
- Restart Ollama after changing env vars.

### 3. Verify CORS preflight

Run from the same machine where Ollama is running:

```bash
curl -i -X OPTIONS http://localhost:11434/api/generate \
  -H "Origin: https://your-domain.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected: non-`403` response with CORS allow headers.

### 4. Troubleshooting

#### Error: `Access to fetch ... blocked by CORS policy`

- `OLLAMA_ORIGINS` does not include your frontend origin, or
- Ollama was not restarted after env changes.

#### Error: `POST http://localhost:11434/api/generate 404 (Not Found)`

Check these points:

1. Ollama is running on the same machine as the browser and listening on port `11434`.
2. Endpoint exists:
   - `curl http://localhost:11434/api/tags`
3. Generate endpoint works:
   - `curl -s http://localhost:11434/api/generate -d '{"model":"<your-model>","prompt":"test","stream":false}'`
4. If the app is opened from a remote/public domain, browser-to-`localhost` calls depend on the end-user machine running Ollama locally. Otherwise, use backend fallback.

---

## API Overview

| Method | Endpoint           | Description                      | Auth |
|--------|--------------------|----------------------------------|------|
| POST   | /auth/register     | Create a new account             | —    |
| POST   | /auth/login        | Obtain a JWT token               | —    |
| GET    | /auth/me           | Current user info                | ✓    |
| GET    | /words             | List all words                   | ✓    |
| POST   | /words             | Add a word (auto-added to box 0) | ✓    |
| DELETE | /words/{id}        | Delete a word                    | ✓    |
| GET    | /words/my          | Words in the user's learning set | ✓    |
| GET    | /review            | Get words due for review         | ✓    |
| POST   | /review/answer     | Submit an answer                 | ✓    |
| GET    | /stats             | User statistics                  | ✓    |
| GET    | /temas             | List topics                      | ✓    |
| POST   | /temas             | Create a topic                   | ✓    |

---

## Environment Variables

Create a `.env` file in the `backend/` directory (copy from `.env.example`):

```env
# A long random string — used to sign JWT tokens
SECRET_KEY=change-this-to-a-secure-random-string

# SQLite database path (relative to where you run the server)
DATABASE_URL=sqlite:///./vocabox.db

# Token expiry in minutes (default: 30 days)
ACCESS_TOKEN_EXPIRE_MINUTES=43200

# Port the API server listens on (default: 9009)
PORT=9009
```

---

## Roadmap

### MVP (current)
- [x] 7-box Leitner spaced repetition engine
- [x] JWT authentication (register / login)
- [x] Write exercise (free-text answer)
- [x] Multiple-choice exercise (auto-generated distractors)
- [x] Audio playback via Web Speech API
- [x] Vocabulary management (add / delete words)
- [x] Topics with colour labels
- [x] Statistics dashboard with bar chart
- [x] PWA — installable + offline shell
- [x] Configurable server port via `.env`

### v2 — Planned
- [ ] **Backend tests** — pytest test suite covering auth, review logic, and spaced repetition service
- [ ] **Frontend tests** — Vitest + React Testing Library for stores, exercises, and page flows
- [ ] CSV import (bulk word upload)
- [ ] Google Translate integration (auto-fill translations)
- [ ] LEO dictionary integration
- [ ] External TTS API (higher-quality audio)
- [ ] Answer history and accurate accuracy tracking
- [ ] Daily streak calculation
- [ ] User settings (toggle exercise types, adjust intervals)
- [ ] Matching exercise type

### v3 — Future
- [ ] AI-powered example sentences and context
- [ ] Adaptive difficulty based on error patterns
- [ ] Shared word lists / community decks
- [ ] Push notifications (review reminders)

---

## Production Deployment — Plesk (Apache + nginx)

The app runs on FastAPI/uvicorn at port `9009` and is exposed at `https://patchamama.com/vocabox`.  
Plesk places **nginx in front of Apache** — both hops must be configured for WebSocket support.

### Active WebSocket endpoints

| Endpoint | Purpose |
|----------|---------|
| `wss://patchamama.com/vocabox/api/ws/grammar-queue` | Real-time grammar queue updates |
| `wss://patchamama.com/vocabox/api/ws/reindex/{job_id}` | Subtitle reindex progress |

The `StripVocaboxApiPrefix` ASGI middleware in `main.py` rewrites  
`/vocabox/api/ws/*` → `/api/ws/*` for both HTTP and WebSocket scopes before FastAPI routes the request.

---

### Recommended: nginx bypasses Apache (direct proxy to port 9009)

**Plesk → domain → Apache & nginx Settings → "Additional nginx directives"**

```nginx
# WebSocket upgrade map — add if not already present globally in Plesk
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /vocabox/ {
    proxy_pass         http://127.0.0.1:9009;
    proxy_http_version 1.1;

    # Required for WebSocket support
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection $connection_upgrade;

    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;

    # Long timeout — grammar-queue connection stays open
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering    off;
}
```

This bypasses Apache entirely for `/vocabox/` — nginx proxies straight to uvicorn.

---

### Alternative: Apache as proxy (requires mod_proxy_wstunnel)

**Plesk → domain → Apache & nginx Settings → "Additional Apache directives for HTTPS"**

```apache
# WebSocket rewrite — MUST come before ProxyPass HTTP rules
RewriteEngine On
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^/vocabox/(.*) ws://127.0.0.1:9009/vocabox/$1 [P,L]

# HTTP proxy
ProxyPreserveHost On
ProxyPass        /vocabox/ http://127.0.0.1:9009/vocabox/
ProxyPassReverse /vocabox/ http://127.0.0.1:9009/vocabox/
```

> **Note:** When using Plesk's nginx+Apache stack, nginx still receives the connection first.
> The nginx directives above (with `Upgrade` / `Connection` headers) are required even if Apache handles the final proxy hop.

---

### Verify WebSocket connectivity

```bash
# Test grammar-queue WebSocket (replace TOKEN with a valid JWT)
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://patchamama.com/vocabox/api/ws/grammar-queue?token=TOKEN"
# Expected: HTTP/1.1 101 Switching Protocols
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Open a pull request

---

## License

MIT
