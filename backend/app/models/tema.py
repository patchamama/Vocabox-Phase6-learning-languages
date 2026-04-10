from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from ..database import Base


class Tema(Base):
    __tablename__ = "temas"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    color = Column(String(20), default="#3B82F6")

    words = relationship("Word", back_populates="tema")
