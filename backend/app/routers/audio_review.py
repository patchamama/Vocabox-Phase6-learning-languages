"""
audio_review.py — Generate review audio from stored word MP3 files.
Downloads individual word+translation MP3s and concatenates them with ffmpeg.

Key design notes:
- ffmpeg runs via asyncio.create_subprocess_exec (non-blocking, does NOT stall the event loop)
- Downloads run in a thread-pool executor (also non-blocking)
- WebSocket polls _jobs dict every 500ms → progress visible in real time
"""

import asyncio
import json
import logging
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.user import User
from ..models.user_word import UserWord
from ..models.word import Word
from ..services.auth import decode_token

# ── Logger ────────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)

# ── Storage ───────────────────────────────────────────────────────────────────
_DATA_DIR = Path(os.environ.get("VOCABOX_DATA_DIR", str(Path(__file__).parent.parent.parent)))
AUDIO_DIR = _DATA_DIR / "audio_reviews"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ── In-memory job store ───────────────────────────────────────────────────────
# job_id → {status, progress, total, filename, error, user_id}
_jobs: Dict[str, dict] = {}

router = APIRouter(prefix="/audio-review", tags=["audio-review"])


def _user_dir(user_id: int) -> Path:
    d = AUDIO_DIR / str(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── Schema ────────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    word_ids: List[int]           # Word.id values
    order: str = "word_first"    # "word_first" | "translation_first"
    gap_seconds: float = 2.0
    beep: bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate")
async def start_generation(
    req: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info(
        "Audio review request — user=%d, words=%d, order=%s, gap=%.1fs, beep=%s  |  storage: %s",
        current_user.id, len(req.word_ids), req.order, req.gap_seconds, req.beep,
        AUDIO_DIR.resolve(),
    )

    if not req.word_ids:
        raise HTTPException(status_code=400, detail="No words selected")

    # Filter to words owned by this user that have BOTH audio URLs
    owned = {
        row.word_id
        for row in db.query(UserWord.word_id)
        .filter(UserWord.user_id == current_user.id)
        .all()
    }
    words_data: List[dict] = []
    for wid in req.word_ids:
        if wid not in owned:
            logger.debug("  word_id=%d not owned by user %d — skipped", wid, current_user.id)
            continue
        w = db.query(Word).filter(Word.id == wid).first()
        if w and w.audio_url and w.audio_url_translation:
            words_data.append({
                "id": w.id,
                "palabra": w.palabra,
                "audio_url": w.audio_url,
                "audio_url_translation": w.audio_url_translation,
            })
        else:
            reason = "not found" if not w else "missing audio URL(s)"
            logger.debug("  word_id=%d skipped (%s)", wid, reason)

    logger.info("  %d/%d words eligible (have both audio URLs)", len(words_data), len(req.word_ids))

    if not words_data:
        raise HTTPException(status_code=400, detail="No words with audio found in selection")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "pending",
        "progress": 0,
        "total": len(words_data),
        "filename": None,
        "error": None,
        "user_id": current_user.id,
    }

    logger.info("  job_id=%s created — launching background task", job_id[:8])
    asyncio.create_task(
        _run_generation(job_id, words_data, req.order, req.gap_seconds, req.beep, current_user.id)
    )
    return {"job_id": job_id, "total": len(words_data)}


# ── Background generation ─────────────────────────────────────────────────────

async def _run_ffmpeg(*args: str, label: str = "ffmpeg") -> None:
    """Run ffmpeg asynchronously — does NOT block the event loop."""
    cmd = ["ffmpeg", "-y"] + list(args)
    logger.debug("[%s] cmd: %s", label, " ".join(cmd))
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        err_text = stderr.decode(errors="replace").strip()
        logger.error("[%s] ffmpeg failed (exit %d):\n%s", label, proc.returncode, err_text)
        raise RuntimeError(f"ffmpeg exit {proc.returncode}: {err_text[-400:]}")
    logger.debug("[%s] ffmpeg OK", label)


def _download_file(url: str, dest: str) -> None:
    """Sync download — call via run_in_executor to avoid blocking the event loop."""
    import urllib.request
    logger.debug("  download: %s", url)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; Vocabox/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)
    logger.debug("  saved %d bytes → %s", len(data), dest)


async def _run_generation(
    job_id: str,
    words_data: List[dict],
    order: str,
    gap_seconds: float,
    beep: bool,
    user_id: int,
) -> None:
    jid = job_id[:8]
    out_dir = _user_dir(user_id)
    loop = asyncio.get_running_loop()
    total = len(words_data)

    logger.info("[%s] Generation started: %d words, order=%s, gap=%.1fs, beep=%s",
                jid, total, order, gap_seconds, beep)
    logger.info("[%s] Output directory: %s", jid, out_dir.resolve())

    _jobs[job_id]["status"] = "running"

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            logger.info("[%s] Temp dir: %s", jid, tmp_path)

            # 1. Shared silence clip (generated once, reused between words)
            silence_path = str(tmp_path / "silence.mp3")
            gap_s = max(0.1, float(gap_seconds))
            logger.info("[%s] Generating %.1fs silence clip...", jid, gap_s)
            await _run_ffmpeg(
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-t", str(gap_s), silence_path,
                label=f"{jid}/silence",
            )

            # 2. Shared beep clip (optional, generated once)
            beep_path: Optional[str] = None
            if beep:
                beep_path = str(tmp_path / "beep.mp3")
                logger.info("[%s] Generating beep clip...", jid)
                await _run_ffmpeg(
                    "-f", "lavfi", "-i", "sine=frequency=880:duration=0.3",
                    "-ar", "44100", "-ac", "2", beep_path,
                    label=f"{jid}/beep",
                )

            # 3. Process each word pair independently:
            #    download → ffmpeg concat into one segment → update progress
            #    This makes progress real: each step = one fully-processed word.
            word_segments: List[str] = []

            for i, word in enumerate(words_data):
                logger.info("[%s] [%d/%d] «%s»", jid, i + 1, total, word["palabra"])

                if order == "word_first":
                    first_url, second_url = word["audio_url"], word["audio_url_translation"]
                else:
                    first_url, second_url = word["audio_url_translation"], word["audio_url"]

                raw_a = str(tmp_path / f"w{i}_a.mp3")
                raw_b = str(tmp_path / f"w{i}_b.mp3")

                # Download both audio files
                logger.info("[%s]   ↓ audio A: %s", jid, first_url)
                await loop.run_in_executor(None, _download_file, first_url, raw_a)

                logger.info("[%s]   ↓ audio B: %s", jid, second_url)
                await loop.run_in_executor(None, _download_file, second_url, raw_b)

                # Build mini concat list: [A] [beep?] [B] [silence]
                mini_list_path = str(tmp_path / f"w{i}_list.txt")
                with open(mini_list_path, "w") as f:
                    f.write(f"file '{raw_a}'\n")
                    if beep and beep_path:
                        f.write(f"file '{beep_path}'\n")
                    f.write(f"file '{raw_b}'\n")
                    f.write(f"file '{silence_path}'\n")

                # Merge this word's clips into one segment
                seg_path = str(tmp_path / f"seg_{i:04d}.mp3")
                logger.info("[%s]   ffmpeg concat → seg_%04d.mp3", jid, i)
                await _run_ffmpeg(
                    "-f", "concat", "-safe", "0",
                    "-i", mini_list_path,
                    "-ar", "44100", "-ac", "2",
                    seg_path,
                    label=f"{jid}/w{i}",
                )

                word_segments.append(seg_path)

                # Progress: i+1 words fully processed
                _jobs[job_id]["progress"] = i + 1
                logger.info("[%s]   progress %d/%d", jid, i + 1, total)

            # 4. Final concat: join all per-word segments into the output file
            logger.info("[%s] Joining %d segments into final file...", jid, len(word_segments))
            final_list_path = str(tmp_path / "final_list.txt")
            with open(final_list_path, "w") as f:
                for seg in word_segments:
                    f.write(f"file '{seg}'\n")

            ts = int(time.time())
            out_name = f"review_{ts}_{jid}.mp3"
            out_path  = str(out_dir / out_name)

            logger.info("[%s] Final ffmpeg concat → %s", jid, out_path)
            await _run_ffmpeg(
                "-f", "concat", "-safe", "0",
                "-i", final_list_path,
                "-c", "copy",          # segments already encoded → just copy streams
                out_path,
                label=f"{jid}/final",
            )

            size_kb = round(Path(out_path).stat().st_size / 1024, 1)
            logger.info("[%s] Done! → %s  (%s KB)", jid, out_path, size_kb)

            _jobs[job_id].update({
                "status": "done",
                "progress": total,
                "filename": out_name,
            })

    except Exception as exc:
        logger.error("[%s] Generation failed: %s", jid, exc, exc_info=True)
        _jobs[job_id].update({"status": "error", "error": str(exc)})


# ── WebSocket progress ────────────────────────────────────────────────────────

@router.websocket("/ws/{job_id}")
async def ws_progress(
    websocket: WebSocket,
    job_id: str,
    token: str = Query(""),
):
    jid = job_id[:8]
    await websocket.accept()

    # Auth via query-param token (WebSocket can't send Authorization headers)
    payload = decode_token(token) if token else None
    if not payload:
        logger.warning("[WS/%s] rejected — invalid token", jid)
        await websocket.send_json({"error": "unauthorized"})
        await websocket.close(code=1008)
        return

    user_id = int(payload.get("sub", 0))
    job = _jobs.get(job_id)
    if not job or job["user_id"] != user_id:
        logger.warning("[WS/%s] rejected — job not found for user %d", jid, user_id)
        await websocket.send_json({"error": "job not found"})
        await websocket.close(code=1008)
        return

    logger.info("[WS/%s] client connected (user=%d)", jid, user_id)

    try:
        while True:
            job = _jobs.get(job_id, {})
            msg = {
                "status":   job.get("status"),
                "progress": job.get("progress", 0),
                "total":    job.get("total", 0),
                "filename": job.get("filename"),
                "error":    job.get("error"),
            }
            await websocket.send_json(msg)
            logger.debug("[WS/%s] → %s", jid, msg)

            if msg["status"] in ("done", "error"):
                logger.info("[WS/%s] closing — final status: %s", jid, msg["status"])
                break
            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        logger.info("[WS/%s] client disconnected early", jid)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── File management ───────────────────────────────────────────────────────────

def _get_duration(path: Path) -> Optional[float]:
    """Return duration in seconds using ffprobe, or None on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None


@router.get("/list")
def list_audios(current_user: User = Depends(get_current_user)):
    d = _user_dir(current_user.id)
    files = []
    for f in sorted(d.glob("*.mp3"), key=lambda p: p.stat().st_mtime, reverse=True):
        s = f.stat()
        files.append({
            "filename":        f.name,
            "size_kb":         round(s.st_size / 1024, 1),
            "created_at":      int(s.st_mtime),
            "duration_seconds": _get_duration(f),
        })
    return files


@router.get("/file/{filename}")
def get_audio_file(filename: str, current_user: User = Depends(get_current_user)):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    f = _user_dir(current_user.id) / filename
    if not f.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(f), media_type="audio/mpeg")


@router.delete("/file/{filename}", status_code=204)
def delete_audio_file(filename: str, current_user: User = Depends(get_current_user)):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    f = _user_dir(current_user.id) / filename
    if not f.exists():
        raise HTTPException(status_code=404, detail="Not found")
    f.unlink()
    logger.info("Deleted audio: %s (user=%d)", filename, current_user.id)
