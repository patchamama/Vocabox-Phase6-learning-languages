"""
ai_providers.py — /ai-providers endpoints

CRUD for user-configured AI providers (OpenAI, Anthropic, Gemini, Ollama, Azure, etc.).
API keys are stored server-side and NEVER returned to the client.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.ai_provider import AIProvider
from ..models.user import User
from ..services.ai_client import build_client_from_provider

router = APIRouter(prefix="/ai-providers", tags=["ai-providers"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class ProviderCreate(BaseModel):
    name: str
    provider_type: str         # ollama / openai / anthropic / gemini / azure / openai_compat
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: str
    is_active: bool = False


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    is_active: Optional[bool] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
def list_providers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all configured providers for the current user (no api_key in response)."""
    providers = (
        db.query(AIProvider)
        .filter(AIProvider.user_id == current_user.id)
        .order_by(AIProvider.created_at)
        .all()
    )
    return [_safe(p) for p in providers]


@router.get("/active")
def get_active_provider(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the active provider info (no api_key), or null if none set."""
    p = (
        db.query(AIProvider)
        .filter(AIProvider.user_id == current_user.id, AIProvider.is_active.is_(True))
        .first()
    )
    return _safe(p) if p else None


@router.post("")
def create_provider(
    req: ProviderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if req.is_active:
        _deactivate_all(current_user.id, db)
    p = AIProvider(
        user_id=current_user.id,
        name=req.name,
        provider_type=req.provider_type,
        api_key=req.api_key or None,
        base_url=req.base_url or None,
        model_name=req.model_name,
        is_active=req.is_active,
        created_at=datetime.utcnow(),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _safe(p)


@router.put("/{provider_id}")
def update_provider(
    provider_id: int,
    req: ProviderUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _get_or_404(provider_id, current_user.id, db)
    if req.name is not None:
        p.name = req.name
    if req.api_key is not None:
        p.api_key = req.api_key or None
    if req.base_url is not None:
        p.base_url = req.base_url or None
    if req.model_name is not None:
        p.model_name = req.model_name
    if req.is_active is not None:
        if req.is_active:
            _deactivate_all(current_user.id, db)
        p.is_active = req.is_active
    db.commit()
    db.refresh(p)
    return _safe(p)


@router.delete("/{provider_id}")
def delete_provider(
    provider_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _get_or_404(provider_id, current_user.id, db)
    db.delete(p)
    db.commit()
    return {"deleted": provider_id}


@router.post("/{provider_id}/activate")
def activate_provider(
    provider_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set this provider as active, deactivating all others."""
    p = _get_or_404(provider_id, current_user.id, db)
    _deactivate_all(current_user.id, db)
    p.is_active = True
    db.commit()
    return _safe(p)


@router.post("/{provider_id}/deactivate")
def deactivate_provider(
    provider_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Deactivate this provider (fall back to Ollama from settings)."""
    p = _get_or_404(provider_id, current_user.id, db)
    p.is_active = False
    db.commit()
    return _safe(p)


@router.post("/{provider_id}/test")
def test_provider(
    provider_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Quick connectivity + auth check for a configured provider."""
    p = _get_or_404(provider_id, current_user.id, db)
    client = build_client_from_provider(p)
    ok = client.is_available(timeout=10)
    return {"ok": ok, "provider_type": p.provider_type, "model": p.model_name}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_or_404(provider_id: int, user_id: int, db: Session) -> AIProvider:
    p = (
        db.query(AIProvider)
        .filter(AIProvider.id == provider_id, AIProvider.user_id == user_id)
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    return p


def _deactivate_all(user_id: int, db: Session) -> None:
    db.query(AIProvider).filter(AIProvider.user_id == user_id).update({"is_active": False})


def _safe(p: AIProvider) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "provider_type": p.provider_type,
        "has_api_key": bool(p.api_key),
        "base_url": p.base_url,
        "model_name": p.model_name,
        "is_active": p.is_active,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }
