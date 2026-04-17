from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from ..database import Base


class AIProvider(Base):
    """User-configured AI provider (OpenAI, Anthropic, Gemini, Ollama, Azure, ...)."""

    __tablename__ = "ai_providers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    # ollama / openai / anthropic / gemini / azure / openai_compat
    provider_type = Column(String(20), nullable=False)
    # API key — None for local Ollama; stored plain-text (self-hosted app)
    api_key = Column(String(500), nullable=True)
    # Custom endpoint: Ollama host, Azure endpoint, LM Studio URL, etc.
    base_url = Column(String(500), nullable=True)
    model_name = Column(String(100), nullable=False)
    is_active = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User", backref="ai_providers")
