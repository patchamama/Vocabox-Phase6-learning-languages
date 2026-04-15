from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class TemaBase(BaseModel):
    nombre: str
    color: str = "#3B82F6"


class TemaOut(TemaBase):
    id: int

    model_config = {"from_attributes": True}


# ── WordTranslation schemas ───────────────────────────────────────────────────

class WordTranslationCreate(BaseModel):
    idioma: str
    texto: str
    audio_url: Optional[str] = None
    audio_text: Optional[str] = None
    source: Optional[str] = None


class WordTranslationOut(WordTranslationCreate):
    id: int
    word_id: int

    model_config = {"from_attributes": True}


# ── Word schemas ──────────────────────────────────────────────────────────────

class WordCreate(BaseModel):
    palabra: str
    significado: str
    idioma_origen: str = "de"
    idioma_destino: str = "es"
    tema_id: Optional[int] = None
    audio_url: Optional[str] = None
    audio_url_translation: Optional[str] = None
    audio_text: Optional[str] = None
    audio_text_translation: Optional[str] = None
    category: Optional[str] = None
    source: Optional[str] = None


class WordUpdate(BaseModel):
    palabra: Optional[str] = None
    significado: Optional[str] = None
    idioma_origen: Optional[str] = None
    idioma_destino: Optional[str] = None
    tema_id: Optional[int] = None
    audio_url: Optional[str] = None
    audio_url_translation: Optional[str] = None
    audio_text: Optional[str] = None
    audio_text_translation: Optional[str] = None
    category: Optional[str] = None
    source: Optional[str] = None


class WordOut(WordCreate):
    id: int
    tema: Optional[TemaOut] = None
    translations: List[WordTranslationOut] = []

    model_config = {"from_attributes": True}


class UserWordOut(BaseModel):
    id: int
    word: WordOut
    box_level: int
    next_review_date: datetime
    last_reviewed: Optional[datetime] = None
    times_reviewed: int = 0
    times_correct: int = 0
    times_incorrect: int = 0

    model_config = {"from_attributes": True}
