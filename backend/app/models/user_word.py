from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import relationship

from ..database import Base


class UserWord(Base):
    __tablename__ = "user_words"
    __table_args__ = (UniqueConstraint("user_id", "word_id", name="uq_user_word"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    word_id = Column(
        Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False
    )
    box_level = Column(Integer, default=0)
    next_review_date = Column(DateTime, default=datetime.utcnow)
    last_reviewed = Column(DateTime, nullable=True)
    times_reviewed = Column(Integer, default=0, nullable=False)
    times_correct = Column(Integer, default=0, nullable=False)
    times_incorrect = Column(Integer, default=0, nullable=False)

    user = relationship("User", back_populates="user_words")
    word = relationship("Word", back_populates="user_words")
