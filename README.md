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

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Open a pull request

---

## License

MIT
