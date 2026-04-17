from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..database import Base


class GrammarExercise(Base):
    __tablename__ = "grammar_exercises"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    topic = Column(String(200), nullable=False, default="")
    language = Column(String(10), nullable=False, default="de")       # source lang
    interface_lang = Column(String(10), nullable=False, default="es") # UI lang when created
    segments_json = Column(Text, nullable=False)                       # JSON array of segments
    grammar_notes_json = Column(Text, nullable=False, default="[]")   # JSON array of strings
    vocabulary_used_json = Column(Text, nullable=False, default="[]") # JSON array of strings
    score_correct = Column(Integer, nullable=True)                     # null until attempted
    score_total = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_attempted = Column(DateTime, nullable=True)

    user = relationship("User", backref="grammar_exercises")
