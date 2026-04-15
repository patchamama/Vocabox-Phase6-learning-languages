"""
ollama.py — /api/ollama/status

Detects if Ollama is running locally and returns available models.
Used by the frontend Settings page to enable/disable LLM translation.
"""

from fastapi import APIRouter, Depends

from ..dependencies import get_current_user
from ..models.user import User
from ..services.ollama_service import get_status

router = APIRouter(prefix="/ollama", tags=["ollama"])


@router.get("/status")
def ollama_status(current_user: User = Depends(get_current_user)):
    """Return Ollama running status and available model list."""
    return get_status()
