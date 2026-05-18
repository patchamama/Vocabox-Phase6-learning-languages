from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..database import Base


class WordExample(Base):
    __tablename__ = "word_examples"

    id = Column(Integer, primary_key=True, index=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    texto = Column(Text, nullable=False)
    traduccion = Column(Text, nullable=True)
    source = Column(String(50), nullable=True)  # e.g. 'verbformen', 'manual'
    orden = Column(Integer, nullable=False, default=0)

    word = relationship("Word", back_populates="examples")
