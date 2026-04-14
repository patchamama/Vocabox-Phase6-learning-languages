"""
leo.py — /api/leo/lookup

Returns up to N LEO dictionary entries for a given word.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from ..dependencies import get_current_user
from ..models.user import User
from ..services.leo_service import LANG_PAIRS, lookup

router = APIRouter(prefix="/leo", tags=["leo"])


@router.get("/lookup")
def leo_lookup(
    word: str = Query(..., description="Word to look up"),
    lp: str = Query("esde", description="Language pair: esde|ende|frde|itde|ptde"),
    results: int = Query(5, ge=1, le=10, description="Max number of results"),
    current_user: User = Depends(get_current_user),
):
    if lp not in LANG_PAIRS:
        raise HTTPException(status_code=400, detail=f"Unknown language pair '{lp}'")
    try:
        data = lookup(word.strip(), lp=lp, max_results=results)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LEO lookup failed: {exc}")
    return data
