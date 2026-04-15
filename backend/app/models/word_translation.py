from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from ..database import Base


class WordTranslation(Base):
    """
    Additional translations for a word in extra languages.
    One Word can have multiple WordTranslation rows (one per extra language).
    """
    __tablename__ = "word_translations"
    __table_args__ = (
        UniqueConstraint("word_id", "idioma", name="uq_word_translation_word_lang"),
    )

    id = Column(Integer, primary_key=True, index=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    idioma = Column(String(10), nullable=False)       # e.g. "en", "fr", "it"
    texto = Column(String(200), nullable=False)        # translated text
    audio_url = Column(String(500), nullable=True)    # LEO MP3 URL
    audio_text = Column(String(200), nullable=True)   # audio label / pronunciation hint
    source = Column(String(50), nullable=True)        # e.g. "leo", "manual"

    word = relationship("Word", back_populates="translations")
