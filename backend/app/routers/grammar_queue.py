"""
grammar_queue.py — Persistent grammar exercise generation queue.

REST endpoints:
  POST   /grammar/queue          — add item to queue
  GET    /grammar/queue          — list queue items for current user
  DELETE /grammar/queue/{id}     — remove item (only if pending/error)
  POST   /grammar/queue/resume   — start/resume background worker
  POST   /grammar/queue/stop     — stop worker after current item

WebSocket:
  WS     /ws/grammar-queue       — real-time updates (token in query string)

Worker flow per item:
  pending → generating → [grammar_check] → ready | error | grammar_error
"""

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..dependencies import get_current_user
from ..models.grammar_exercise import GrammarExercise
from ..models.grammar_queue_item import GrammarQueueItem
from ..models.user import User
from ..services import grammar_service
from ..services.ai_client import get_active_client_and_model, OllamaClient
from ..services.auth import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(tags=["grammar-queue"])

# ── In-process state ──────────────────────────────────────────────────────────

# user_id → set of WebSocket connections
_ws_connections: dict[int, set[WebSocket]] = {}

# user_id → asyncio.Task (the running worker)
_worker_tasks: dict[int, asyncio.Task] = {}

# user_id → stop flag
_stop_flags: dict[int, bool] = {}

_executor = ThreadPoolExecutor(max_workers=4)

# ── Schemas ───────────────────────────────────────────────────────────────────

class AddToQueueRequest(BaseModel):
    topic: str
    interface_lang: str = "es"
    grammar_focus: list[str] = []
    vocabulary: list[str] = []
    model: str
    timeout: int = 120
    custom_prompt: Optional[str] = None
    temperature: Optional[float] = None
    num_predict: Optional[int] = None
    top_p: Optional[float] = None
    mode: str = "rolling"
    rolling_sentences: int = 6
    prose_override: Optional[str] = None
    double_correct: bool = False
    max_blanks: int = 10
    grammar_check_enabled: bool = False
    cefr_level: str = ""
    is_global: bool = False


# ── Serialization ─────────────────────────────────────────────────────────────

def _item_to_dict(item: GrammarQueueItem) -> dict:
    params = json.loads(item.params_json) if item.params_json else {}
    return {
        "id": item.id,
        "status": item.status,
        "position": item.position,
        "params": params,
        "exercise_id": item.exercise_id,
        "grammar_check_enabled": item.grammar_check_enabled,
        "grammar_check_feedback": item.grammar_check_feedback,
        "error_message": item.error_message,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
    }


# ── WebSocket broadcast ───────────────────────────────────────────────────────

async def _broadcast(user_id: int, event: dict) -> None:
    sockets = list(_ws_connections.get(user_id, set()))
    dead = set()
    for ws in sockets:
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    if dead:
        _ws_connections.get(user_id, set()).difference_update(dead)


# ── Background worker ─────────────────────────────────────────────────────────

def _process_item_sync(item_id: int, user_id: int) -> None:
    """Run in thread executor — calls sync grammar_service functions."""
    db = SessionLocal()
    try:
        item = db.query(GrammarQueueItem).filter_by(id=item_id, user_id=user_id).first()
        if not item:
            return

        params = json.loads(item.params_json)
        model = params.get("model", "")
        timeout = params.get("timeout", 120)

        # Resolve AI client
        active = get_active_client_and_model(user_id, db)
        if active:
            ai_client, resolved_model = active
        else:
            ai_client = None
            resolved_model = model

        # Generate exercise
        exercise_data = grammar_service.generate_exercise(
            topic=params.get("topic", ""),
            interface_lang=params.get("interface_lang", "es"),
            grammar_focus=params.get("grammar_focus", []),
            vocabulary=params.get("vocabulary", []),
            model=resolved_model,
            timeout=max(10, min(900, timeout)),
            custom_prompt=params.get("custom_prompt") or "",
            ai_client=ai_client,
            temperature=params.get("temperature"),
            num_predict=params.get("num_predict"),
            top_p=params.get("top_p"),
            mode=params.get("mode", "rolling"),
            rolling_sentences=max(2, min(12, params.get("rolling_sentences", 6))),
            prose_override=params.get("prose_override"),
            double_correct=params.get("double_correct", False),
            max_blanks=max(3, min(20, params.get("max_blanks", 10))),
            cefr_level=params.get("cefr_level", "") or "",
        )

        # Save exercise to DB
        ex = GrammarExercise(
            user_id=user_id,
            title=exercise_data.get("title", params.get("topic", "")[:40]),
            topic=params.get("topic", ""),
            language="de",
            interface_lang=params.get("interface_lang", "es"),
            segments_json=json.dumps(exercise_data.get("segments", [])),
            grammar_notes_json=json.dumps(exercise_data.get("grammar_notes", [])),
            vocabulary_used_json=json.dumps(exercise_data.get("vocabulary_used", [])),
            grammar_focus_json=json.dumps(params.get("grammar_focus", [])),
            cefr_level=exercise_data.get("cefr_level") or None,
            description=exercise_data.get("description") or None,
            is_global=params.get("is_global", False),
            created_at=datetime.utcnow(),
        )
        db.add(ex)
        db.flush()

        # Grammar check if enabled
        grammar_check_feedback = None
        has_grammar_errors = False
        if item.grammar_check_enabled:
            item.status = "grammar_check"
            db.commit()

            # Reconstruct plain prose from segments for checking
            segs = exercise_data.get("segments", [])
            prose = "".join(
                s.get("v", "") if s.get("t") == "text"
                else (s.get("options", [""])[s.get("correct", 0)] if s.get("t") == "blank" else "")
                for s in segs
            )
            try:
                feedback = grammar_service.check_prose(
                    text=prose,
                    interface_lang=params.get("interface_lang", "es"),
                    model=resolved_model,
                    timeout=max(30, timeout // 3),
                    ai_client=ai_client,
                )
                grammar_check_feedback = feedback
                # Heuristic: if feedback is long or lacks "no error" phrases, flag it
                no_error_phrases = [
                    "no se encontr", "no errors", "keine fehler", "pas d'erreur",
                    "correct", "korrekt", "correcto", "sin errores",
                ]
                short_and_clean = len(feedback.strip()) < 120 and any(
                    p in feedback.lower() for p in no_error_phrases
                )
                has_grammar_errors = not short_and_clean
            except Exception as exc:
                logger.warning("[queue] Grammar check failed for item %d: %s", item_id, exc)

        # Update queue item
        item.exercise_id = ex.id
        item.status = "grammar_error" if has_grammar_errors else "ready"
        item.grammar_check_feedback = grammar_check_feedback
        item.completed_at = datetime.utcnow()
        db.commit()

    except Exception as exc:
        logger.error("[queue] Item %d failed: %s", item_id, exc)
        db = SessionLocal()  # fresh session after potential failure
        try:
            item = db.query(GrammarQueueItem).filter_by(id=item_id, user_id=user_id).first()
            if item:
                item.status = "error"
                item.error_message = str(exc)[:500]
                item.completed_at = datetime.utcnow()
                db.commit()
        finally:
            db.close()
    finally:
        db.close()


async def _run_worker(user_id: int) -> None:
    """Async worker — picks pending items one by one, runs sync processing in executor."""
    logger.info("[queue] Worker started for user %d", user_id)
    _stop_flags[user_id] = False

    while True:
        if _stop_flags.get(user_id):
            logger.info("[queue] Worker stopped by user %d", user_id)
            break

        # Pick next pending item
        db = SessionLocal()
        try:
            item = (
                db.query(GrammarQueueItem)
                .filter_by(user_id=user_id, status="pending")
                .order_by(GrammarQueueItem.position)
                .first()
            )
            if not item:
                logger.info("[queue] No more pending items for user %d, worker done", user_id)
                break

            item_id = item.id
            item.status = "generating"
            item.started_at = datetime.utcnow()
            db.commit()
            item_dict = _item_to_dict(item)
        finally:
            db.close()

        # Broadcast status change
        await _broadcast(user_id, {"type": "queue_item_update", "item": item_dict})

        # Run sync generation in thread pool
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(_executor, _process_item_sync, item_id, user_id)
        except Exception as exc:
            logger.error("[queue] Executor error for item %d: %s", item_id, exc)

        # Broadcast final state
        db = SessionLocal()
        try:
            item = db.query(GrammarQueueItem).filter_by(id=item_id).first()
            if item:
                await _broadcast(user_id, {"type": "queue_item_update", "item": _item_to_dict(item)})
        finally:
            db.close()

    # Worker done — clean up task reference
    _worker_tasks.pop(user_id, None)
    await _broadcast(user_id, {"type": "worker_stopped"})


def _ensure_worker(user_id: int) -> None:
    """Start worker task if not already running. Must be called from async context."""
    existing = _worker_tasks.get(user_id)
    if existing and not existing.done():
        return
    task = asyncio.ensure_future(_run_worker(user_id))
    _worker_tasks[user_id] = task


# ── REST endpoints ────────────────────────────────────────────────────────────

@router.post("/grammar/queue", status_code=201)
def add_to_queue(
    req: AddToQueueRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a generation task to the queue (max 50 pending per user)."""
    pending_count = (
        db.query(GrammarQueueItem)
        .filter_by(user_id=current_user.id)
        .filter(GrammarQueueItem.status.in_(["pending", "generating", "grammar_check"]))
        .count()
    )
    if pending_count >= 50:
        raise HTTPException(status_code=429, detail="Queue is full (max 50 items)")

    # Next position
    max_pos = db.query(GrammarQueueItem).filter_by(user_id=current_user.id).count()

    item = GrammarQueueItem(
        user_id=current_user.id,
        status="pending",
        position=max_pos,
        params_json=json.dumps(req.model_dump()),
        grammar_check_enabled=req.grammar_check_enabled,
        created_at=datetime.utcnow(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_to_dict(item)


@router.get("/grammar/queue")
def list_queue(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all queue items for the current user."""
    items = (
        db.query(GrammarQueueItem)
        .filter_by(user_id=current_user.id)
        .order_by(GrammarQueueItem.position)
        .all()
    )
    worker_running = (
        current_user.id in _worker_tasks
        and not _worker_tasks[current_user.id].done()
    )
    return {
        "items": [_item_to_dict(i) for i in items],
        "worker_running": worker_running,
    }


@router.delete("/grammar/queue/{item_id}")
def delete_queue_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a queue item (only if pending or error)."""
    item = (
        db.query(GrammarQueueItem)
        .filter_by(id=item_id, user_id=current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.status in ("generating", "grammar_check"):
        raise HTTPException(status_code=409, detail="Cannot delete item currently being processed")
    db.delete(item)
    db.commit()
    return {"deleted": item_id}


@router.post("/grammar/queue/resume")
async def resume_queue(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start or resume the background worker for this user."""
    # Reset stale generating items back to pending (e.g. after server restart)
    db.query(GrammarQueueItem).filter(
        GrammarQueueItem.user_id == current_user.id,
        GrammarQueueItem.status.in_(["generating", "grammar_check"]),
    ).update({"status": "pending", "started_at": None})
    db.commit()

    _stop_flags[current_user.id] = False
    _ensure_worker(current_user.id)
    return {"started": True}


@router.post("/grammar/queue/stop")
def stop_queue(current_user: User = Depends(get_current_user)):
    """Signal the worker to stop after the current item finishes."""
    _stop_flags[current_user.id] = True
    return {"stopped": True}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/ws/grammar-queue")
async def ws_grammar_queue(
    websocket: WebSocket,
    token: str = Query(""),
):
    """Real-time queue updates. Auth via token query param."""
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=1008)
        return

    sub = payload.get("sub")
    if not sub:
        await websocket.close(code=1008)
        return
    try:
        user_id: int = int(sub)
    except (ValueError, TypeError):
        await websocket.close(code=1008)
        return

    await websocket.accept()

    # Register connection
    if user_id not in _ws_connections:
        _ws_connections[user_id] = set()
    _ws_connections[user_id].add(websocket)

    # Send initial snapshot
    db = SessionLocal()
    try:
        items = (
            db.query(GrammarQueueItem)
            .filter_by(user_id=user_id)
            .order_by(GrammarQueueItem.position)
            .all()
        )
        worker_running = (
            user_id in _worker_tasks and not _worker_tasks[user_id].done()
        )
        await websocket.send_json({
            "type": "queue_snapshot",
            "items": [_item_to_dict(i) for i in items],
            "worker_running": worker_running,
        })
    finally:
        db.close()

    try:
        while True:
            # Keep connection alive — client sends pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_connections.get(user_id, set()).discard(websocket)
