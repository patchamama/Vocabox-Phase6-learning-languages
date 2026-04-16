"""
ollama.py — /api/ollama/status and /api/ollama/enhance-word

Detects if Ollama is running locally and returns available models.
Also provides a word-enhancement endpoint that uses a local LLM to
correct, enrich, and translate vocabulary entries.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..dependencies import get_current_user
from ..models.user import User
from ..services.ollama_service import enhance_word, get_default_prompts, get_status

router = APIRouter(prefix="/ollama", tags=["ollama"])


@router.get("/status")
def ollama_status(current_user: User = Depends(get_current_user)):
    """Return Ollama running status and available model list."""
    return get_status()


@router.get("/default-prompts")
def ollama_default_prompts(current_user: User = Depends(get_current_user)):
    """Return the built-in prompt templates (static, does not require Ollama running)."""
    return get_default_prompts()


class EnhanceWordRequest(BaseModel):
    palabra: str
    significado: str
    idioma_origen: str
    idioma_destino: str
    model: str
    extra_langs: list[str] = []
    timeout: int = 60
    prompt_override: str | None = None


@router.post("/enhance-word")
def ollama_enhance_word(
    req: EnhanceWordRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Use the local Ollama model to analyze and enrich a vocabulary entry.
    Returns corrected word, improved translation, category, and extra translations.
    """
    result = enhance_word(
        palabra=req.palabra,
        significado=req.significado,
        idioma_origen=req.idioma_origen,
        idioma_destino=req.idioma_destino,
        model=req.model,
        extra_langs=req.extra_langs or None,
        timeout=max(10, min(300, req.timeout)),
        prompt_override=req.prompt_override or None,
    )
    if result is None:
        raise HTTPException(status_code=503, detail="Ollama unavailable or returned no result")
    return result
