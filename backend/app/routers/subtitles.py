import asyncio
import threading
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from sqlalchemy import func
from sqlalchemy.orm import Session, contains_eager, joinedload

from ..database import SessionLocal, get_db
from ..dependencies import get_current_user
from ..models.subtitle import SubtitleFile, SubtitlePlaylist, SubtitleSegment, subtitle_file_temas
from ..models.tema import Tema
from ..models.user_word import UserWord
from ..models.word_video_ref import WordVideoRef
from ..schemas.subtitle import (
    FileRefCountOut, ReindexRequest, SegmentContextOut,
    SubtitleBulkDelete, SubtitleBulkUpdate, SubtitleFileOut, SubtitleFileUpdate, SubtitlePlaylistOut,
    SubtitlePlaylistUpdate, SubtitleSearchOut, WordVideoRefOut,
    YouTubeImportRequest, YouTubeImportResult, YouTubeImportItem,
)
from ..services.auth import decode_token
from ..services.subtitle_indexer import DEFAULT_MAX_REFS, index_word, reindex_all
from ..services.subtitle_parser import detect_youtube_id, parse_subtitle
from ..services import youtube_subtitle_service as yts

router = APIRouter(prefix="/subtitles", tags=["subtitles"])

# In-memory job store (same pattern as audio_review)
_jobs: dict[str, dict] = {}
_yt_jobs: dict[str, dict] = {}


# ── Upload ─────────────────────────────────────────────────────────────────────

def _resolve_temas(db: Session, _user_id: int, tema_ids: List[int]) -> List[Tema]:
    """Return Tema rows for the requested ids. Silently drops unknown ids."""
    if not tema_ids:
        return []
    return db.query(Tema).filter(Tema.id.in_(tema_ids)).all()


def _fallback_csv(values: List[str]) -> str:
    return ",".join([v.strip() for v in values if v and v.strip()])


def _get_or_create_internal_playlist(
    db: Session,
    user_id: int,
    title: str,
    language: Optional[str],
    fallback_languages: str,
    max_videos: int,
    stars: int,
    temas: list,
) -> SubtitlePlaylist:
    """Reuse an existing internal playlist with the same title, or create a new one."""
    if title:
        existing = (
            db.query(SubtitlePlaylist)
            .filter(
                SubtitlePlaylist.user_id == user_id,
                SubtitlePlaylist.is_internal == True,
                SubtitlePlaylist.title == title,
            )
            .first()
        )
        if existing:
            return existing
    pl = SubtitlePlaylist(
        user_id=user_id,
        playlist_id=f"internal:{uuid.uuid4().hex[:16]}",
        title=title[:500] if title else None,
        source_url=None,
        is_internal=True,
        language=language,
        fallback_languages=fallback_languages,
        max_videos=max_videos,
        stars=stars,
    )
    pl.temas = temas
    db.add(pl)
    return pl


def _upsert_playlists_for_request(db: Session, user_id: int, req: YouTubeImportRequest) -> None:
    playlist_sources = yts.playlist_ids_from_sources(req.sources)
    if not playlist_sources:
        return
    temas = _resolve_temas(db, user_id, req.tema_ids)
    fallback = _fallback_csv(req.fallback_languages)
    stars = max(0, min(3, req.stars))
    for playlist_id, source_url in playlist_sources:
        pl = (
            db.query(SubtitlePlaylist)
            .filter(
                SubtitlePlaylist.user_id == user_id,
                SubtitlePlaylist.playlist_id == playlist_id,
            )
            .first()
        )
        if not pl:
            pl = SubtitlePlaylist(user_id=user_id, playlist_id=playlist_id, is_internal=False)
            db.add(pl)
        pl.source_url = source_url
        pl.language = req.language.strip() or None
        pl.fallback_languages = fallback
        pl.max_videos = req.max_videos
        pl.stars = stars
        pl.temas = list(temas)
    db.commit()


def _create_internal_playlist_for_result(
    db: Session,
    user_id: int,
    req: YouTubeImportRequest,
    result: YouTubeImportResult,
) -> None:
    file_ids = [
        int(item.file_id)
        for item in result.items
        if item.file_id and item.status in {"created", "skipped"}
    ]
    file_ids = list(dict.fromkeys(file_ids))[:9999]
    if not file_ids:
        return

    files = (
        db.query(SubtitleFile)
        .filter(SubtitleFile.user_id == user_id, SubtitleFile.id.in_(file_ids))
        .all()
    )
    if not files:
        return

    title = (req.internal_playlist_title or "").strip()
    if not title:
        title = f"Import {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"

    temas = _resolve_temas(db, user_id, req.tema_ids)
    pl = _get_or_create_internal_playlist(
        db=db,
        user_id=user_id,
        title=title,
        language=req.language.strip() or None,
        fallback_languages=_fallback_csv(req.fallback_languages),
        max_videos=min(9999, max(1, req.max_videos)),
        stars=max(0, min(3, req.stars)),
        temas=temas,
    )
    for f in files:
        if f not in pl.files:
            pl.files.append(f)
    db.commit()


@router.post("/upload", response_model=SubtitleFileOut, status_code=201)
async def upload_subtitle(
    file: UploadFile = File(...),
    youtube_id: Optional[str] = Form(default=None),
    language: Optional[str] = Form(default=None),
    fallback_languages: Optional[str] = Form(default=None),
    stars: int = Form(default=0),
    tema_ids: str = Form(default=""),
    create_internal_playlist: bool = Form(default=False),
    internal_playlist_title: Optional[str] = Form(default=None),
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
    parsed_tema_ids = [int(x) for x in tema_ids.split(",") if x.strip().isdigit()]
    stars_clamped = max(0, min(3, stars))

    sub = SubtitleFile(
        user_id=current_user.id,
        filename=filename,
        youtube_id=yt_id or None,
        language=(language or "").strip() or None,
        total_segments=len(segments),
        stars=stars_clamped,
    )
    if parsed_tema_ids:
        sub.temas = _resolve_temas(db, current_user.id, parsed_tema_ids)
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

    if create_internal_playlist:
        title = (internal_playlist_title or "").strip()
        if not title:
            title = f"Upload {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
        fallback_csv = _fallback_csv(
            [s.strip() for s in (fallback_languages or "").split(",") if s.strip()]
        )
        temas = _resolve_temas(db, current_user.id, parsed_tema_ids)
        pl = _get_or_create_internal_playlist(
            db=db,
            user_id=current_user.id,
            title=title,
            language=(language or "").strip() or None,
            fallback_languages=fallback_csv,
            max_videos=9999,
            stars=stars_clamped,
            temas=temas,
        )
        if sub not in pl.files:
            pl.files.append(sub)
        db.commit()

    db.refresh(sub)
    return sub


@router.patch("/bulk", response_model=List[SubtitleFileOut])
def bulk_update_subtitles(
    body: SubtitleBulkUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ids = list(dict.fromkeys([int(x) for x in body.file_ids if int(x) > 0]))
    if not ids:
        raise HTTPException(400, "No subtitle files selected")
    subs = (
        db.query(SubtitleFile)
        .filter(SubtitleFile.user_id == current_user.id, SubtitleFile.id.in_(ids))
        .all()
    )
    if not subs:
        raise HTTPException(404, "Archivos no encontrados")
    temas = None
    if body.tema_ids is not None:
        temas = _resolve_temas(db, current_user.id, body.tema_ids)
    for sub in subs:
        if body.stars is not None:
            sub.stars = max(0, min(3, body.stars))
        if body.language is not None:
            sub.language = body.language.strip() or None
        if temas is not None:
            sub.temas = list(temas)
    db.commit()
    for sub in subs:
        db.refresh(sub)
    return subs


@router.delete("/bulk", status_code=204)
def bulk_delete_subtitles(
    body: SubtitleBulkDelete,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ids = list(dict.fromkeys([int(x) for x in body.file_ids if int(x) > 0]))
    if not ids:
        raise HTTPException(400, "No subtitle files selected")
    subs = (
        db.query(SubtitleFile)
        .filter(SubtitleFile.user_id == current_user.id, SubtitleFile.id.in_(ids))
        .all()
    )
    for sub in subs:
        db.delete(sub)
    db.commit()


@router.patch("/{file_id}", response_model=SubtitleFileOut)
def update_subtitle(
    file_id: int,
    body: SubtitleFileUpdate,
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
    if body.stars is not None:
        sub.stars = max(0, min(3, body.stars))
    if body.language is not None:
        sub.language = body.language.strip() or None
    if body.tema_ids is not None:
        sub.temas = _resolve_temas(db, current_user.id, body.tema_ids)
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


# ── Registered YouTube playlists ───────────────────────────────────────────────

@router.get("/playlists", response_model=List[SubtitlePlaylistOut])
def list_playlists(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return (
        db.query(SubtitlePlaylist)
        .filter(SubtitlePlaylist.user_id == current_user.id)
        .order_by(SubtitlePlaylist.updated_at.desc(), SubtitlePlaylist.id.desc())
        .all()
    )


@router.patch("/playlists/{playlist_db_id}", response_model=SubtitlePlaylistOut)
def update_playlist(
    playlist_db_id: int,
    body: SubtitlePlaylistUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    pl = (
        db.query(SubtitlePlaylist)
        .filter(SubtitlePlaylist.id == playlist_db_id, SubtitlePlaylist.user_id == current_user.id)
        .first()
    )
    if not pl:
        raise HTTPException(404, "Playlist no encontrada")
    if body.title is not None:
        pl.title = body.title.strip() or None
    if body.language is not None:
        pl.language = body.language.strip() or None
    if body.fallback_languages is not None:
        pl.fallback_languages = _fallback_csv(body.fallback_languages)
    if body.max_videos is not None:
        pl.max_videos = body.max_videos
    if body.stars is not None:
        pl.stars = max(0, min(3, body.stars))
    if body.tema_ids is not None:
        pl.temas = _resolve_temas(db, current_user.id, body.tema_ids)
    db.commit()
    db.refresh(pl)
    return pl


@router.delete("/playlists/{playlist_db_id}", status_code=204)
def delete_playlist(
    playlist_db_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    pl = (
        db.query(SubtitlePlaylist)
        .filter(SubtitlePlaylist.id == playlist_db_id, SubtitlePlaylist.user_id == current_user.id)
        .first()
    )
    if not pl:
        return
    db.delete(pl)
    db.commit()


@router.post("/playlists/{playlist_db_id}/refresh", status_code=202)
def refresh_playlist(
    playlist_db_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    pl = (
        db.query(SubtitlePlaylist)
        .filter(SubtitlePlaylist.id == playlist_db_id, SubtitlePlaylist.user_id == current_user.id)
        .first()
    )
    if not pl:
        raise HTTPException(404, "Playlist no encontrada")
    if pl.is_internal:
        raise HTTPException(400, "Las playlists internas no se refrescan desde YouTube")

    req = YouTubeImportRequest(
        sources=[pl.source_url or pl.playlist_id],
        language=pl.language or "de",
        fallback_languages=[x.strip() for x in (pl.fallback_languages or "").split(",") if x.strip()],
        tema_ids=[tm.id for tm in pl.temas],
        stars=pl.stars,
        max_videos=min(9999, max(1, pl.max_videos)),
    )
    job_id = str(uuid.uuid4())
    user_id = current_user.id
    _yt_jobs[job_id] = {
        "user_id": user_id,
        "status": "pending",
        "progress": 0,
        "total": 0,
        "created": 0,
        "skipped": 0,
        "errors": 0,
        "result": None,
        "error": None,
    }

    def _run() -> None:
        db2 = SessionLocal()
        try:
            _yt_jobs[job_id]["status"] = "running"

            def _progress(done: int, total: int) -> None:
                _yt_jobs[job_id]["progress"] = done
                _yt_jobs[job_id]["total"] = total

            def _item(it) -> None:
                key = {"created": "created", "skipped": "skipped", "error": "errors"}.get(it.status)
                if key:
                    _yt_jobs[job_id][key] = _yt_jobs[job_id].get(key, 0) + 1

            result = yts.import_sources(req, user_id, db2, on_progress=_progress, on_item=_item)
            _yt_jobs[job_id]["result"] = result.model_dump()
            _yt_jobs[job_id]["status"] = "done"
        except Exception as exc:  # noqa: BLE001
            _yt_jobs[job_id]["status"] = "error"
            _yt_jobs[job_id]["error"] = str(exc)
        finally:
            db2.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"job_id": job_id}


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
                use_palabra=req.use_palabra,
                use_audio_text=req.use_audio_text,
                use_significado=req.use_significado,
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
    tema_ids: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Search subtitle segments by keyword, optionally filtered by tema, sorted by stars desc."""
    parsed_tema_ids = [int(x) for x in (tema_ids or "").split(",") if x.strip().isdigit()]

    files_q = db.query(SubtitleFile.id).filter(SubtitleFile.user_id == current_user.id)
    if parsed_tema_ids:
        files_q = files_q.filter(
            SubtitleFile.id.in_(
                db.query(subtitle_file_temas.c.subtitle_file_id)
                .filter(subtitle_file_temas.c.tema_id.in_(parsed_tema_ids))
            )
        )
    file_ids = [r.id for r in files_q.all()]
    if not file_ids:
        return {"results": [], "total": 0}

    q_lower = q.lower().strip()
    segs = (
        db.query(SubtitleSegment)
        .join(SubtitleFile, SubtitleSegment.file_id == SubtitleFile.id)
        .options(contains_eager(SubtitleSegment.file))
        .filter(
            SubtitleSegment.file_id.in_(file_ids),
            SubtitleSegment.text_lower.contains(q_lower),
        )
        .order_by(SubtitleFile.stars.desc(), SubtitleSegment.file_id, SubtitleSegment.start_ms)
        .limit(limit)
        .all()
    )
    return {"results": segs, "total": len(segs)}


# ── YouTube import — start job ─────────────────────────────────────────────────

@router.post("/youtube-import", status_code=202)
def start_youtube_import(
    req: YouTubeImportRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    job_id = str(uuid.uuid4())
    user_id = current_user.id
    # When the user opts into an internal combined playlist, ONLY register that
    # one (created after the job finishes). Otherwise, register each source
    # YouTube playlist as-is.
    if not req.create_internal_playlist:
        _upsert_playlists_for_request(db, user_id, req)
    _yt_jobs[job_id] = {
        "user_id": user_id,
        "status": "pending",
        "progress": 0,
        "total": 0,
        "created": 0,
        "skipped": 0,
        "errors": 0,
        "result": None,
        "error": None,
    }

    def _run() -> None:
        db2 = SessionLocal()
        try:
            _yt_jobs[job_id]["status"] = "running"

            def _progress(done: int, total: int) -> None:
                _yt_jobs[job_id]["progress"] = done
                _yt_jobs[job_id]["total"] = total

            def _item(it) -> None:
                key = {"created": "created", "skipped": "skipped", "error": "errors"}.get(it.status)
                if key:
                    _yt_jobs[job_id][key] = _yt_jobs[job_id].get(key, 0) + 1

            result = yts.import_sources(req, user_id, db2, on_progress=_progress, on_item=_item)
            if req.create_internal_playlist:
                _create_internal_playlist_for_result(db2, user_id, req, result)
            _yt_jobs[job_id]["result"] = result.model_dump()
            _yt_jobs[job_id]["status"] = "done"
        except Exception as exc:  # noqa: BLE001
            _yt_jobs[job_id]["status"] = "error"
            _yt_jobs[job_id]["error"] = str(exc)
        finally:
            db2.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"job_id": job_id}


@router.get("/youtube-jobs/{job_id}")
def get_youtube_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    job = _yt_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {
        "status":   job["status"],
        "progress": job["progress"],
        "total":    job["total"],
        "created":  job.get("created", 0),
        "skipped":  job.get("skipped", 0),
        "errors":   job.get("errors", 0),
        "result":   job["result"],
        "error":    job["error"],
    }


@router.delete("/youtube-jobs/{job_id}", status_code=204)
def delete_youtube_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    job = _yt_jobs.get(job_id)
    if not job:
        return
    if job["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    _yt_jobs.pop(job_id, None)


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


# ── Reindex job status — HTTP polling fallback ────────────────────────────────

@router.get("/jobs/{job_id}")
def get_reindex_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    state = {
        "status":       job["status"],
        "progress":     job["progress"],
        "total":        job["total"],
        "refs_created": job["refs_created"],
        "error":        job["error"],
    }
    if state["status"] in ("done", "error"):
        _jobs.pop(job_id, None)
    return state
