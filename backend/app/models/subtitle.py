from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from ..database import Base


class SubtitleFile(Base):
    __tablename__ = "subtitle_files"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(500), nullable=False)
    youtube_id = Column(String(20), nullable=True)
    language = Column(String(10), nullable=True)
    total_segments = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    segments = relationship("SubtitleSegment", back_populates="file", cascade="all, delete-orphan")


class SubtitleSegment(Base):
    __tablename__ = "subtitle_segments"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey("subtitle_files.id", ondelete="CASCADE"), nullable=False, index=True)
    start_ms = Column(Integer, nullable=False)
    end_ms = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    text_lower = Column(Text, nullable=False)

    file = relationship("SubtitleFile", back_populates="segments")
    word_refs = relationship("WordVideoRef", back_populates="segment", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_sub_seg_file_lower", "file_id", "text_lower"),)
