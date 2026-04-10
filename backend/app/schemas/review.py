from typing import List, Optional

from pydantic import BaseModel


class ReviewWordOut(BaseModel):
    user_word_id: int
    word_id: int
    palabra: str
    significado: str
    idioma_origen: str
    idioma_destino: str
    box_level: int
    audio_url: Optional[str] = None
    exercise_type: str  # "write" | "multiple_choice"
    choices: Optional[List[str]] = None
    tema_nombre: Optional[str] = None


class AnswerIn(BaseModel):
    user_word_id: int
    correct: bool


class AnswerOut(BaseModel):
    user_word_id: int
    new_box_level: int
    next_review_date: str
    message: str
