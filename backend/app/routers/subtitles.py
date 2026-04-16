import asyncio
import threading
import uuid
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import SessionLocal, get_db
from ..dependencies import get_current_user
from ..models.subtitle import SubtitleFile, SubtitleSegment
from ..models.user_word import UserWord
from ..models.word_video_ref import WordVideoRef
from ..schemas.subtitle import (
    FileRefCountOut, ReindexRequest, SegmentContextOut,
    SubtitleFileOut, SubtitleSearchOut, WordVideoRefOut,
)
from ..services.auth import decode_token
from ..services.subtitle_indexer import DEFAULT_MAX_REFS, index_word, reindex_all
from ..services.subtitle_parser import detect_youtube_id, parse_subtitle

router = APIRouter(prefix="/subtitles", tags=["subtitles"])

# In-memory job store (same pattern as audio_review)
_jobs: dict[str, dict] = {}


# ── Upload ─────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=SubtitleFileOut, status_code=201)
async def upload_subtitle(
    file: UploadFile = File(...),
    youtube_id: Optional[str] = Form(default=None),
    language: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    filename = file.filename or "subtitle.vtt"
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in ("vtt", "srt"):
        raise HTTPException(400, "Solo se aceptan archivos .vtt y .srt")

    # Duplicate check — same filename for the same user
    existing = (
        db.query(SubtitleFile)
        .filter(SubtitleFile.user_id == current_user.id, SubtitleFile.filename == filename)
        .first()
    )
    if existing:
        raise HTTPException(409, f"Ya existe un subtítulo con ese nombre: {filename}")

    content = (await file.read()).decode("utf-8", errors="replace")
    segments = parse_subtitle(content)
    if not segments:
        raise HTTPException(
            400,
            "No se pudieron extraer segmentos. Verificá que el archivo sea un .vtt o .srt válido.",
        )

    yt_id = (youtube_id or "").strip() or detect_youtube_id(filename)

    sub = SubtitleFile(
        user_id=current_user.id,
        filename=filename,
        youtube_id=yt_id or None,
        language=(language or "").strip() or None,
        total_segments=len(segments),
    )
    db.add(sub)
    db.flush()

    db.bulk_insert_mappings(
        SubtitleSegment,
        [
            {
                "file_id": sub.id,
                "start_ms": s.start_ms,
                "end_ms": s.end_ms,
                "text": s.text,
                "text_lower": s.text.lower(),
            }
            for s in segments
        ],
    )
    db.commit()
    db.refresh(sub)
    return sub


# ── List ───────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[SubtitleFileOut])
def list_subtitles(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return (
        db.query(SubtitleFile)
        .filter(SubtitleFile.user_id == current_user.id)
        .order_by(SubtitleFile.created_at.desc())
        .all()
    )


# ── Delete all refs (MUST come before /{file_id}) ─────────────────────────────

@router.delete("/all-refs", status_code=204)
def delete_all_refs(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    db.query(WordVideoRef).filter(WordVideoRef.user_id == current_user.id).delete()
    db.commit()


# ── Delete subtitle file ───────────────────────────────────────────────────────

@router.delete("/{file_id}", status_code=204)
def delete_subtitle(
    file_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    sub = (
        db.query(SubtitleFile)
        .filter(SubtitleFile.id == file_id, SubtitleFile.user_id == current_user.id)
        .first()
    )
    if not sub:
        raise HTTPException(404, "Archivo no encontrado")
    db.delete(sub)
    db.commit()


# ── Word video refs ────────────────────────────────────────────────────────────

@router.get("/refs/{word_id}", response_model=List[WordVideoRefOut])
def get_word_refs(
    word_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    uw = (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id, UserWord.word_id == word_id)
        .first()
    )
    if not uw:
        raise HTTPException(404, "Palabra no encontrada")

    return (
        db.query(WordVideoRef)
        .filter(
            WordVideoRef.user_id == current_user.id,
            WordVideoRef.word_id == word_id,
        )
        .options(joinedload(WordVideoRef.segment).joinedload(SubtitleSegment.file))
        .all()
    )


# ── Word IDs that have video refs ─────────────────────────────────────────────

@router.get("/word-ids-with-refs")
def get_word_ids_with_refs(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    rows = (
        db.query(WordVideoRef.word_id, func.count(WordVideoRef.id).label("count"))
        .filter(WordVideoRef.user_id == current_user.id)
        .group_by(WordVideoRef.word_id)
        .all()
    )
    return {"refs": [{"word_id": r.word_id, "count": r.count} for r in rows]}


# ── Segment context ────────────────────────────────────────────────────────────

@router.get("/segment-context/{segment_id}", response_model=SegmentContextOut)
def get_segment_context(
    segment_id: int,
    before: int = 0,
    after: int = 0,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    seg = (
        db.query(SubtitleSegment)
        .options(joinedload(SubtitleSegment.file))
        .filter(SubtitleSegment.id == segment_id)
        .first()
    )
    if not seg:
        raise HTTPException(404, "Segmento no encontrado")
    if seg.file.user_id != current_user.id:
        raise HTTPException(403, "Acceso denegado")

    before_segs: list[SubtitleSegment] = []
    after_segs: list[SubtitleSegment] = []

    if before > 0:
        before_segs = (
            db.query(SubtitleSegment)
            .options(joinedload(SubtitleSegment.file))
            .filter(
                SubtitleSegment.file_id == seg.file_id,
                SubtitleSegment.start_ms < seg.start_ms,
            )
            .order_by(SubtitleSegment.start_ms.desc())
            .limit(before)
            .all()
        )[::-1]

    if after > 0:
        after_segs = (
            db.query(SubtitleSegment)
            .options(joinedload(SubtitleSegment.file))
            .filter(
                SubtitleSegment.file_id == seg.file_id,
                SubtitleSegment.start_ms > seg.start_ms,
            )
            .order_by(SubtitleSegment.start_ms.asc())
            .limit(after)
            .all()
        )

    return {"before": before_segs, "segment": seg, "after": after_segs}


# ── Reindex — start job ────────────────────────────────────────────────────────

@router.post("/reindex", status_code=202)
def start_reindex(
    req: ReindexRequest = Body(default_factory=ReindexRequest),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    job_id = str(uuid.uuid4())
    user_id = current_user.id
    effective_max = req.max_refs if req.max_refs > 0 else DEFAULT_MAX_REFS
    _jobs[job_id] = {
        "user_id": user_id,
        "status": "pending",
        "progress": 0,
        "total": 0,
        "refs_created": 0,
        "error": None,
    }

    def _run() -> None:
        db2 = SessionLocal()
        try:
            _jobs[job_id]["status"] = "running"

            def _progress(done: int, total: int) -> None:
                _jobs[job_id]["progress"] = done
                _jobs[job_id]["total"] = total

            result = reindex_all(
                user_id, db2, on_progress=_progress,
                min_refs=req.min_refs,
                max_refs=effective_max,
            )
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["refs_created"] = result["refs_created"]
            _jobs[job_id]["total"] = result["total_words"]
        except Exception as exc:  # noqa: BLE001
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["error"] = str(exc)
        finally:
            db2.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"job_id": job_id}


# ── File ref counts ────────────────────────────────────────────────────────────

@router.get("/file-ref-counts", response_model=list[FileRefCountOut])
def get_file_ref_counts(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return the number of word-video refs stored per subtitle file for this user."""
    rows = (
        db.query(SubtitleSegment.file_id, func.count(WordVideoRef.id).label("count"))
        .join(WordVideoRef, WordVideoRef.segment_id == SubtitleSegment.id)
        .filter(WordVideoRef.user_id == current_user.id)
        .group_by(SubtitleSegment.file_id)
        .all()
    )
    return [{"file_id": r.file_id, "count": r.count} for r in rows]


# ── Subtitle search ────────────────────────────────────────────────────────────

@router.get("/search", response_model=SubtitleSearchOut)
def search_subtitles(
    q: str = Query(min_length=2),
    limit: int = Query(default=30, le=200),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Search subtitle segments by keyword and return matching SegmentRef objects."""
    file_ids = [
        r.id for r in db.query(SubtitleFile.id)
        .filter(SubtitleFile.user_id == current_user.id)
        .all()
    ]
    if not file_ids:
        return {"results": [], "total": 0}

    q_lower = q.lower().strip()
    segs = (
        db.query(SubtitleSegment)
        .options(joinedload(SubtitleSegment.file))
        .filter(
            SubtitleSegment.file_id.in_(file_ids),
            SubtitleSegment.text_lower.contains(q_lower),
        )
        .order_by(SubtitleSegment.file_id, SubtitleSegment.start_ms)
        .limit(limit)
        .all()
    )
    return {"results": segs, "total": len(segs)}


# ── Reindex — WebSocket progress ───────────────────────────────────────────────

@router.websocket("/ws/reindex/{job_id}")
async def ws_reindex(
    websocket: WebSocket,
    job_id: str,
    token: str = "",
):
    await websocket.accept()

    payload = decode_token(token)
    if not payload:
        await websocket.send_json({"status": "error", "error": "Unauthorized"})
        await websocket.close()
        return

    user_id = int(payload.get("sub", 0))
    job = _jobs.get(job_id)
    if not job or job["user_id"] != user_id:
        await websocket.send_json({"status": "error", "error": "Job not found"})
        await websocket.close()
        return

    try:
        while True:
            j = _jobs.get(job_id, {})
            await websocket.send_json({
                "status": j.get("status", "unknown"),
                "progress": j.get("progress", 0),
                "total": j.get("total", 0),
                "refs_created": j.get("refs_created", 0),
                "error": j.get("error"),
            })
            if j.get("status") in ("done", "error"):
                _jobs.pop(job_id, None)
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
