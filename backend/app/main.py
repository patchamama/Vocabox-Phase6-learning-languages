from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .database import Base, SessionLocal, engine

# Register all ORM models before create_all
from . import models  # noqa: F401


def _pre_migrate() -> None:
    """Drop tables that need a schema redesign — data is fully rebuildable."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    # word_video_refs: user_id column added in a later revision.
    # Table data is fully derived (rebuilt via reindex), so it's safe to drop.
    if "word_video_refs" in inspector.get_table_names():
        cols = {c["name"] for c in inspector.get_columns("word_video_refs")}
        if "user_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE word_video_refs"))


_pre_migrate()
Base.metadata.create_all(bind=engine)


def _migrate_words_columns() -> None:
    """Add new columns to the words table if they don't exist yet."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "words" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("words")}
    new_cols = [
        ("category", "VARCHAR(50)"),
        ("audio_url_translation", "VARCHAR(500)"),
        ("audio_text", "VARCHAR(200)"),
        ("audio_text_translation", "VARCHAR(200)"),
        ("source", "VARCHAR(50)"),
    ]
    with engine.begin() as conn:
        for col, typ in new_cols:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE words ADD COLUMN {col} {typ}"))


_migrate_words_columns()

from .routers import audio_review, auth, import_router, languages, leo, ollama, review, stats, subtitles, temas, test_mode, words

# ── Language dictionary seed data ─────────────────────────────────────────────

_LANGUAGE_SEED = [
    {"code": "de", "name_es": "Alemán",      "name_en": "German",      "name_de": "Deutsch",        "name_fr": "Allemand"},
    {"code": "es", "name_es": "Español",     "name_en": "Spanish",     "name_de": "Spanisch",       "name_fr": "Espagnol"},
    {"code": "en", "name_es": "Inglés",      "name_en": "English",     "name_de": "Englisch",       "name_fr": "Anglais"},
    {"code": "fr", "name_es": "Francés",     "name_en": "French",      "name_de": "Französisch",    "name_fr": "Français"},
    {"code": "it", "name_es": "Italiano",    "name_en": "Italian",     "name_de": "Italienisch",    "name_fr": "Italien"},
    {"code": "pt", "name_es": "Portugués",   "name_en": "Portuguese",  "name_de": "Portugiesisch",  "name_fr": "Portugais"},
    {"code": "nl", "name_es": "Neerlandés",  "name_en": "Dutch",       "name_de": "Niederländisch", "name_fr": "Néerlandais"},
    {"code": "ru", "name_es": "Ruso",        "name_en": "Russian",     "name_de": "Russisch",       "name_fr": "Russe"},
    {"code": "ja", "name_es": "Japonés",     "name_en": "Japanese",    "name_de": "Japanisch",      "name_fr": "Japonais"},
    {"code": "zh", "name_es": "Chino",       "name_en": "Chinese",     "name_de": "Chinesisch",     "name_fr": "Chinois"},
    {"code": "ar", "name_es": "Árabe",       "name_en": "Arabic",      "name_de": "Arabisch",       "name_fr": "Arabe"},
    {"code": "pl", "name_es": "Polaco",      "name_en": "Polish",      "name_de": "Polnisch",       "name_fr": "Polonais"},
    {"code": "ko", "name_es": "Coreano",     "name_en": "Korean",      "name_de": "Koreanisch",     "name_fr": "Coréen"},
    {"code": "tr", "name_es": "Turco",       "name_en": "Turkish",     "name_de": "Türkisch",       "name_fr": "Turc"},
    {"code": "sv", "name_es": "Sueco",       "name_en": "Swedish",     "name_de": "Schwedisch",     "name_fr": "Suédois"},
    {"code": "no", "name_es": "Noruego",     "name_en": "Norwegian",   "name_de": "Norwegisch",     "name_fr": "Norvégien"},
    {"code": "da", "name_es": "Danés",       "name_en": "Danish",      "name_de": "Dänisch",        "name_fr": "Danois"},
    {"code": "fi", "name_es": "Finlandés",   "name_en": "Finnish",     "name_de": "Finnisch",       "name_fr": "Finnois"},
    {"code": "cs", "name_es": "Checo",       "name_en": "Czech",       "name_de": "Tschechisch",    "name_fr": "Tchèque"},
    {"code": "hu", "name_es": "Húngaro",     "name_en": "Hungarian",   "name_de": "Ungarisch",      "name_fr": "Hongrois"},
]


def _seed_language_dict() -> None:
    from .models.language_dict import LanguageDict

    db = SessionLocal()
    try:
        if db.query(LanguageDict).count() == 0:
            db.bulk_insert_mappings(LanguageDict, _LANGUAGE_SEED)
            db.commit()
    finally:
        db.close()


_seed_language_dict()

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Vocabox API",
    description="Spaced-repetition language learning — Leitner box system",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://backend.patchamama.com:9009",
        "http://backend.patchamama.com",
        "https://patchamama.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,          prefix="/api")
app.include_router(words.router,         prefix="/api")
app.include_router(review.router,        prefix="/api")
app.include_router(stats.router,         prefix="/api")
app.include_router(temas.router,         prefix="/api")
app.include_router(import_router.router, prefix="/api")
app.include_router(languages.router,     prefix="/api")
app.include_router(test_mode.router,     prefix="/api")
app.include_router(leo.router,           prefix="/api")
app.include_router(ollama.router,        prefix="/api")
app.include_router(audio_review.router,  prefix="/api")
app.include_router(subtitles.router,     prefix="/api")

# ── Static frontend (served from app/static after deploy) ─────────────────────
_STATIC_DIR = Path(__file__).parent / "static"

if _STATIC_DIR.is_dir():
    # Single catch-all: serve real static files if they exist, otherwise SPA index.html.
    # Using a single route avoids FastAPI/Starlette routing conflicts between
    # app.mount() and @app.get("/{full_path:path}") catch-alls.
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        candidate = _STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(_STATIC_DIR / "index.html"))
else:
    @app.get("/", tags=["root"])
    def root():
        return {"message": "Vocabox API — run deploy to serve the frontend", "docs": "/docs"}
