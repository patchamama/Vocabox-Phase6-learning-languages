from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from ..database import Base


class Word(Base):
    __tablename__ = "words"

    id = Column(Integer, primary_key=True, index=True)
    palabra = Column(String(200), nullable=False)
    significado = Column(String(200), nullable=False)
    idioma_origen = Column(String(10), default="de")
    idioma_destino = Column(String(10), default="es")
    tema_id = Column(Integer, ForeignKey("temas.id"), nullable=True)
    audio_url = Column(String(500), nullable=True)

    tema = relationship("Tema", back_populates="words")
    user_words = relationship(
        "UserWord", back_populates="word", cascade="all, delete-orphan"
    )
