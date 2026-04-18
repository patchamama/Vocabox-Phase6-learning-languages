"""
grammar_queue_item.py — Persistent grammar exercise generation queue.

Statuses:
  pending        — waiting in queue
  generating     — currently being processed by the background worker
  grammar_check  — generation done, running grammar check
  ready          — saved as GrammarExercise, available to solve
  error          — generation failed
  grammar_error  — generated OK but grammar check flagged errors
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey
from ..database import Base


class GrammarQueueItem(Base):
    __tablename__ = "grammar_queue_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Queue state
    status = Column(String(20), nullable=False, default="pending")  # see module docstring
    position = Column(Integer, nullable=False, default=0)

    # Generation params (serialized JSON)
    params_json = Column(Text, nullable=False)  # topic, mode, grammar_focus, etc.

    # Result
    exercise_id = Column(Integer, ForeignKey("grammar_exercises.id"), nullable=True)

    # Grammar check
    grammar_check_enabled = Column(Boolean, nullable=False, default=False)
    grammar_check_feedback = Column(Text, nullable=True)

    # Error info
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
