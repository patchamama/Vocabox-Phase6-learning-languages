from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..database import Base


class GrammarExercise(Base):
    __tablename__ = "grammar_exercises"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Random token for public sharing (e.g. 12-char base62). Null = not shared yet.
    share_token = Column(String(32), nullable=True, unique=True, index=True)
    title = Column(String(200), nullable=False)
    topic = Column(String(200), nullable=False, default="")
    language = Column(String(10), nullable=False, default="de")       # source lang
    interface_lang = Column(String(10), nullable=False, default="es") # UI lang when created
    segments_json = Column(Text, nullable=False)                       # JSON array of segments
    grammar_notes_json = Column(Text, nullable=False, default="[]")   # JSON array of strings
    vocabulary_used_json = Column(Text, nullable=False, default="[]") # JSON array of strings
    grammar_focus_json = Column(Text, nullable=False, default="[]")   # JSON array of strings
    score_correct = Column(Integer, nullable=True)                     # null until attempted
    score_total = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_attempted = Column(DateTime, nullable=True)

    # CEFR level: A1 A2 B1 B2 C1 C2 or None
    cefr_level = Column(String(3), nullable=True)
    # User-facing description (AI-suggested, user-editable)
    description = Column(Text, nullable=True)
    # Global = visible to all users with same target language
    is_global = Column(Boolean, nullable=False, default=False, index=True)
    # If adopted from a global exercise, points to the original
    original_exercise_id = Column(Integer, ForeignKey("grammar_exercises.id"), nullable=True)

    user = relationship("User", backref="grammar_exercises")
