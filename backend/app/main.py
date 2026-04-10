from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, SessionLocal, engine

# Register all ORM models before create_all
from . import models  # noqa: F401

Base.metadata.create_all(bind=engine)

from .routers import auth, import_router, languages, review, stats, temas, test_mode, words

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
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(words.router)
app.include_router(review.router)
app.include_router(stats.router)
app.include_router(temas.router)
app.include_router(import_router.router)
app.include_router(languages.router)
app.include_router(test_mode.router)


@app.get("/", tags=["root"])
def root():
    return {"message": "Vocabox API", "docs": "/docs"}
