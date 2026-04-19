"""
grammar.py — /grammar endpoints

AI-powered German grammar exercise generation (via Ollama) and
persistence of exercises for later replay.
"""

import json
import secrets
import string
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.grammar_exercise import GrammarExercise
from ..models.user import User
from ..services import grammar_service
from ..services.grammar_service import inject_extra_blanks
from ..services.ai_client import get_active_client_and_model, OllamaClient

router = APIRouter(prefix="/grammar", tags=["grammar"])


# ── Request / Response schemas ─────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    topic: str
    interface_lang: str = "es"
    grammar_focus: list[str] = []
    vocabulary: list[str] = []
    model: str
    timeout: int = 60
    custom_prompt: Optional[str] = None
    temperature: Optional[float] = None   # 0.0–1.0; None = model default (0.4)
    num_predict: Optional[int] = None     # max tokens; None = model default (4096)
    top_p: Optional[float] = None         # 0.0–1.0; None = model default (0.9)
    mode: str = "two_phase"               # "two_phase" | "rolling" | "custom"
    rolling_sentences: int = 6            # sentences to generate in rolling mode
    prose_override: Optional[str] = None  # skip Phase 1, use this text directly (two_phase only)
    double_correct: bool = False          # run a second auto-correction pass on Phase 1 prose
    max_blanks: int = 10                  # maximum number of blanks to generate
    cefr_level: str = ""                  # A1/A2/B1/B2/C1/C2 or "" for intermediate default
    force_extra_grammar: bool = False     # inject additional rule-based blanks (Python, no AI)
    extra_grammar_categories: list[str] = []  # which categories to inject (empty = all)
    max_blanks_per_sentence: int = 0      # 0 = no per-sentence limit


class CheckProseRequest(BaseModel):
    text: str
    interface_lang: str = "es"
    model: str
    timeout: int = 60


class SuggestTopicsRequest(BaseModel):
    interface_lang: str = "es"
    model: str
    timeout: int = 60


class SaveExerciseRequest(BaseModel):
    title: str
    topic: str
    language: str = "de"
    interface_lang: str = "es"
    segments_json: str
    grammar_notes_json: str = "[]"
    vocabulary_used_json: str = "[]"
    grammar_focus_json: str = "[]"
    score_correct: Optional[int] = None
    score_total: Optional[int] = None
    cefr_level: Optional[str] = None
    description: Optional[str] = None
    is_global: bool = False


class UpdateExerciseMetaRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cefr_level: Optional[str] = None
    is_global: Optional[bool] = None


class UpdateScoreRequest(BaseModel):
    correct: int
    total: int


class InjectExtraRequest(BaseModel):
    allowed_categories: list[str] = []
    max_blanks_per_sentence: int = 3
    max_extra: int = 20


class DefaultPromptResponse(BaseModel):
    prompt: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/generate")
def generate_exercise(
    req: GenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Generate a fill-in-the-blank grammar exercise.
    Uses the user's active AI provider if configured; falls back to Ollama.
    Does NOT save to DB — client calls POST /grammar/exercises to persist.
    """
    active = get_active_client_and_model(current_user.id, db)
    if active:
        ai_client, model = active
    else:
        ai_client = None  # grammar_service will use OllamaClient
        model = req.model

    try:
        exercise = grammar_service.generate_exercise(
            topic=req.topic,
            interface_lang=req.interface_lang,
            grammar_focus=req.grammar_focus,
            vocabulary=req.vocabulary,
            model=model,
            timeout=max(10, min(900, req.timeout)),
            custom_prompt=req.custom_prompt or "",
            ai_client=ai_client,
            temperature=req.temperature,
            num_predict=req.num_predict,
            top_p=req.top_p,
            mode=req.mode,
            rolling_sentences=max(2, min(12, req.rolling_sentences)),
            prose_override=req.prose_override or None,
            double_correct=req.double_correct,
            max_blanks=max(3, min(20, req.max_blanks)),
            cefr_level=req.cefr_level or "",
            force_extra_grammar=req.force_extra_grammar,
            extra_grammar_categories=req.extra_grammar_categories or None,
            max_blanks_per_sentence=req.max_blanks_per_sentence,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"AI provider unavailable: {exc}")

    return exercise


@router.post("/check-prose")
def check_prose(
    req: CheckProseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ask the AI to review a German text for grammatical errors."""
    active = get_active_client_and_model(current_user.id, db)
    if active:
        ai_client, model = active
    else:
        ai_client = None
        model = req.model

    try:
        feedback = grammar_service.check_prose(
            text=req.text,
            interface_lang=req.interface_lang,
            model=model,
            timeout=max(10, min(900, req.timeout)),
            ai_client=ai_client,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"AI provider unavailable: {exc}")

    return {"feedback": feedback}


@router.post("/suggest-topics")
def suggest_topics(
    req: SuggestTopicsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ask the active AI provider for exercise topic suggestions."""
    active = get_active_client_and_model(current_user.id, db)
    if active:
        ai_client, model = active
    else:
        ai_client = None
        model = req.model

    topics = grammar_service.suggest_topics(
        interface_lang=req.interface_lang,
        model=model,
        timeout=max(10, min(900, req.timeout)),
        ai_client=ai_client,
    )
    return {"topics": topics}


@router.get("/extra-grammar-categories")
def get_extra_grammar_categories(current_user: User = Depends(get_current_user)):
    """Return the list of rule-based extra grammar categories available for injection."""
    return grammar_service.EXTRA_GRAMMAR_CATEGORIES


@router.get("/default-prompt")
def get_default_prompt(
    mode: str = "custom",
    current_user: User = Depends(get_current_user),
):
    """Return the built-in prompt template for the given generation mode."""
    return {"prompt": grammar_service.get_default_grammar_prompt(mode)}


@router.post("/exercises")
def save_exercise(
    req: SaveExerciseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a generated exercise to the database."""
    # Validate JSON fields
    try:
        json.loads(req.segments_json)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid segments_json")

    exercise = GrammarExercise(
        user_id=current_user.id,
        title=req.title,
        topic=req.topic,
        language=req.language,
        interface_lang=req.interface_lang,
        segments_json=req.segments_json,
        grammar_notes_json=req.grammar_notes_json,
        vocabulary_used_json=req.vocabulary_used_json,
        grammar_focus_json=req.grammar_focus_json,
        score_correct=req.score_correct,
        score_total=req.score_total,
        cefr_level=req.cefr_level or None,
        description=req.description or None,
        is_global=req.is_global,
        created_at=datetime.utcnow(),
        last_attempted=datetime.utcnow() if req.score_correct is not None else None,
    )
    db.add(exercise)
    db.commit()
    db.refresh(exercise)
    return _exercise_summary(exercise)


@router.get("/exercises")
def list_exercises(
    filter: str = Query("all", regex="^(all|private|global)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List saved exercises for the current user (summary, no segments). filter=all|private|global"""
    q = db.query(GrammarExercise).filter(GrammarExercise.user_id == current_user.id)
    if filter == "private":
        q = q.filter(GrammarExercise.is_global == False)
    elif filter == "global":
        q = q.filter(GrammarExercise.is_global == True)
    exercises = q.order_by(GrammarExercise.created_at.desc()).all()
    return [_exercise_summary(e) for e in exercises]


@router.get("/exercises/explore")
def explore_exercises(
    search: Optional[str] = Query(None),
    cefr_level: Optional[str] = Query(None),
    filter: str = Query("global", regex="^(global|all)$"),
    language: str = Query("de"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Explore global exercises from all users (excluding current user's own)."""
    q = db.query(GrammarExercise).filter(
        GrammarExercise.is_global == True,
        GrammarExercise.language == language,
    )
    if filter == "global":
        q = q.filter(GrammarExercise.user_id != current_user.id)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (GrammarExercise.title.ilike(like)) |
            (GrammarExercise.topic.ilike(like)) |
            (GrammarExercise.description.ilike(like))
        )
    if cefr_level:
        q = q.filter(GrammarExercise.cefr_level == cefr_level)
    exercises = q.order_by(GrammarExercise.created_at.desc()).limit(50).all()
    return [_exercise_summary(e) for e in exercises]


@router.post("/exercises/{exercise_id}/adopt")
def adopt_exercise(
    exercise_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Copy a global exercise into the current user's library as private."""
    original = (
        db.query(GrammarExercise)
        .filter(GrammarExercise.id == exercise_id, GrammarExercise.is_global == True)
        .first()
    )
    if not original:
        raise HTTPException(status_code=404, detail="Global exercise not found")

    copy = GrammarExercise(
        user_id=current_user.id,
        title=original.title,
        topic=original.topic,
        language=original.language,
        interface_lang=original.interface_lang,
        segments_json=original.segments_json,
        grammar_notes_json=original.grammar_notes_json,
        vocabulary_used_json=original.vocabulary_used_json,
        grammar_focus_json=original.grammar_focus_json,
        cefr_level=original.cefr_level,
        description=original.description,
        is_global=False,
        original_exercise_id=original.id,
        created_at=datetime.utcnow(),
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _exercise_summary(copy)


@router.get("/exercises/{exercise_id}")
def get_exercise(
    exercise_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single saved exercise with full segments. Also allows reading global exercises."""
    exercise = (
        db.query(GrammarExercise)
        .filter(GrammarExercise.id == exercise_id)
        .filter(
            (GrammarExercise.user_id == current_user.id) |
            (GrammarExercise.is_global == True)
        )
        .first()
    )
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return _exercise_full(exercise)


@router.patch("/exercises/{exercise_id}/meta")
def update_exercise_meta(
    exercise_id: int,
    req: UpdateExerciseMetaRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update title, description, cefr_level, or is_global for a user's own exercise."""
    exercise = _get_or_404(exercise_id, current_user.id, db)
    if req.title is not None:
        exercise.title = req.title
    if req.description is not None:
        exercise.description = req.description
    if req.cefr_level is not None:
        exercise.cefr_level = req.cefr_level or None
    if req.is_global is not None:
        exercise.is_global = req.is_global
    db.commit()
    return _exercise_summary(exercise)


@router.patch("/exercises/{exercise_id}/score")
def update_score(
    exercise_id: int,
    req: UpdateScoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the score for a completed exercise attempt."""
    exercise = _get_or_404(exercise_id, current_user.id, db)
    exercise.score_correct = req.correct
    exercise.score_total = req.total
    exercise.last_attempted = datetime.utcnow()
    db.commit()
    return {"id": exercise.id, "score_correct": req.correct, "score_total": req.total}


@router.delete("/exercises/{exercise_id}")
def delete_exercise(
    exercise_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a saved exercise."""
    exercise = _get_or_404(exercise_id, current_user.id, db)
    db.delete(exercise)
    db.commit()
    return {"deleted": exercise_id}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_or_404(exercise_id: int, user_id: int, db: Session) -> GrammarExercise:
    exercise = (
        db.query(GrammarExercise)
        .filter(GrammarExercise.id == exercise_id, GrammarExercise.user_id == user_id)
        .first()
    )
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return exercise


_TOKEN_ALPHABET = string.ascii_letters + string.digits

def _generate_share_token() -> str:
    """Generate a URL-safe random token (12 chars, ~71 bits entropy)."""
    return "".join(secrets.choice(_TOKEN_ALPHABET) for _ in range(12))


def _exercise_summary(e: GrammarExercise) -> dict:
    return {
        "id": e.id,
        "user_id": e.user_id,
        "title": e.title,
        "topic": e.topic,
        "language": e.language,
        "interface_lang": e.interface_lang,
        "score_correct": e.score_correct,
        "score_total": e.score_total,
        "cefr_level": e.cefr_level,
        "description": e.description,
        "is_global": bool(e.is_global),
        "original_exercise_id": e.original_exercise_id,
        "grammar_focus": json.loads(e.grammar_focus_json or "[]"),
        "share_token": e.share_token,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "last_attempted": e.last_attempted.isoformat() if e.last_attempted else None,
    }


def _exercise_full(e: GrammarExercise) -> dict:
    summary = _exercise_summary(e)
    summary["segments"] = json.loads(e.segments_json)
    summary["grammar_notes"] = json.loads(e.grammar_notes_json or "[]")
    summary["vocabulary_used"] = json.loads(e.vocabulary_used_json or "[]")
    return summary


@router.post("/exercises/{exercise_id}/inject-extra")
def inject_extra_into_exercise(
    exercise_id: int,
    req: InjectExtraRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Re-inject rule-based blanks into an existing exercise without calling the AI.
    Only adds blanks where each sentence has fewer than max_blanks_per_sentence.
    Updates the exercise in the DB and returns the full updated exercise.
    """
    exercise = _get_or_404(exercise_id, current_user.id, db)
    segments = json.loads(exercise.segments_json)
    new_segments = inject_extra_blanks(
        segments=segments,
        allowed_categories=req.allowed_categories or None,
        max_blanks_per_sentence=req.max_blanks_per_sentence,
        max_extra=max(1, min(50, req.max_extra)),
    )
    exercise.segments_json = json.dumps(new_segments)
    db.commit()
    return _exercise_full(exercise)


@router.post("/exercises/{exercise_id}/share-token")
def generate_share_token(
    exercise_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate (or return existing) share token for an exercise."""
    exercise = _get_or_404(exercise_id, current_user.id, db)
    if not exercise.share_token:
        # Ensure uniqueness (collision probability negligible but handle it)
        token = _generate_share_token()
        while db.query(GrammarExercise).filter_by(share_token=token).first():
            token = _generate_share_token()
        exercise.share_token = token
        db.commit()
        db.refresh(exercise)
    return {"share_token": exercise.share_token}


@router.get("/share/{token}")
def get_exercise_by_token(
    token: str,
    db: Session = Depends(get_db),
):
    """Get a single saved exercise by share token — no authentication required."""
    exercise = db.query(GrammarExercise).filter_by(share_token=token).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return _exercise_full(exercise)
