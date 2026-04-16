from sqlalchemy import Column, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.orm import relationship

from ..database import Base


class WordVideoRef(Base):
    __tablename__ = "word_video_refs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    segment_id = Column(Integer, ForeignKey("subtitle_segments.id", ondelete="CASCADE"), nullable=False, index=True)

    segment = relationship("SubtitleSegment", back_populates="word_refs")

    __table_args__ = (
        UniqueConstraint("user_id", "word_id", "segment_id", name="uq_user_word_segment"),
        Index("ix_word_video_refs_user_word", "user_id", "word_id"),
    )
