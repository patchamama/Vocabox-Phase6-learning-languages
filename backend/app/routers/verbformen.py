"""
verbformen.py — /api/verbformen/lookup

Scrapes verbformen.de for a German verb. Returns lemma, conjugation
(presente - praeteritum - perfekt), pre-formatted palabra string,
mp3 audio URL of the infinitive and example sentences.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import get_current_user
from ..models.user import User
from ..services.verbformen_service import lookup

router = APIRouter(prefix="/verbformen", tags=["verbformen"])


@router.get("/lookup")
def verbformen_lookup(
    word: str = Query(..., description="German verb to look up"),
    example_limit: int = Query(12, ge=0, le=30),
    current_user: User = Depends(get_current_user),
):
    try:
        return lookup(word.strip(), example_limit=example_limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"verbformen lookup failed: {exc}")
