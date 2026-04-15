"""
leo.py — /api/leo/lookup + /api/leo/auto-fetch-extras

Returns LEO dictionary entries for a given word.
auto-fetch-extras: given a German word, automatically fetches the first
result in each requested extra language pair and returns structured data
(text + audio URL) without requiring user interaction.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..dependencies import get_current_user
from ..models.user import User
from ..services.leo_service import LANG_PAIRS, lookup

router = APIRouter(prefix="/leo", tags=["leo"])

# Supported LEO pairs keyed by the non-German language code
# LEO always has German on one side; these are the non-DE sides.
# word is always assumed to be German (DE).
_LANG_TO_PAIR = {
    "es": "esde",
    "en": "ende",
    "fr": "frde",
    "it": "itde",
    "pt": "ptde",
}


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


class AutoFetchRequest(BaseModel):
    word: str                   # The German word to look up
    extra_langs: List[str]      # e.g. ["en", "fr", "it"]


class ExtraTranslation(BaseModel):
    idioma: str
    texto: str
    audio_url: Optional[str] = None
    audio_text: Optional[str] = None
    found: bool = True


@router.post("/auto-fetch-extras")
def auto_fetch_extras(
    body: AutoFetchRequest,
    current_user: User = Depends(get_current_user),
) -> List[ExtraTranslation]:
    """
    For each language in extra_langs, look up the German word in LEO and
    return the first result (text + audio). Runs one LEO request per language.
    Languages not supported by LEO or that return no results are skipped.
    Never raises — returns empty list on total failure.
    """
    results: List[ExtraTranslation] = []
    word = body.word.strip()

    for lang in body.extra_langs:
        lp = _LANG_TO_PAIR.get(lang)
        if not lp:
            # Language not supported by LEO — skip silently
            continue
        try:
            data = lookup(word, lp=lp, max_results=1)
            entries = data.get("entries", [])
            if not entries:
                continue

            entry = entries[0]
            # Find the non-German side
            target_side = next(
                (s for s in entry["sides"] if s["lang"] == lang),
                None,
            )
            if not target_side or not target_side["text"]:
                continue

            audio = target_side["audio"]
            results.append(ExtraTranslation(
                idioma=lang,
                texto=target_side["text"],
                audio_url=audio[0]["mp3_url"] if audio else None,
                audio_text=audio[0]["label"] if audio else target_side["text"],
                found=True,
            ))
        except Exception:
            # LEO lookup failed for this language — skip silently
            continue

    return results
