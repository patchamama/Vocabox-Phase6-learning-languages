"""
audio_review.py — Generate review audio from stored word MP3 files.
Downloads individual word+translation MP3s and concatenates them with ffmpeg.
"""

import asyncio
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

router = APIRouter(prefix="/audio-review", tags=["audio-review"])

# In-memory job store: job_id → {status, progress, total, filename, error, user_id}
_jobs: Dict[str, dict] = {}

# Persistent audio directory (configurable via env var)
_DATA_DIR = Path(os.environ.get("VOCABOX_DATA_DIR", str(Path(__file__).parent.parent.parent)))
AUDIO_DIR = _DATA_DIR / "audio_reviews"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


def _user_dir(user_id: int) -> Path:
    d = AUDIO_DIR / str(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


class GenerateRequest(BaseModel):
    word_ids: List[int]           # Word.id values
    order: str = "word_first"    # "word_first" | "translation_first"
    gap_seconds: float = 2.0
    beep: bool = False


@router.post("/generate")
async def start_generation(
    req: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not req.word_ids:
        raise HTTPException(status_code=400, detail="No words selected")

    # Collect words owned by this user that have both audio URLs
    owned_word_ids = {
        row.word_id
        for row in db.query(UserWord.word_id)
        .filter(UserWord.user_id == current_user.id)
        .all()
    }
    words_data: List[dict] = []
    for wid in req.word_ids:
        if wid not in owned_word_ids:
            continue
        w = db.query(Word).filter(Word.id == wid).first()
        if w and w.audio_url and w.audio_url_translation:
            words_data.append({
                "id": w.id,
                "palabra": w.palabra,
                "audio_url": w.audio_url,
                "audio_url_translation": w.audio_url_translation,
            })

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

    asyncio.create_task(
        _run_generation(job_id, words_data, req.order, req.gap_seconds, req.beep, current_user.id)
    )
    return {"job_id": job_id, "total": len(words_data)}


def _download_file(url: str, dest: str) -> None:
    import urllib.request
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; Vocabox/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)


async def _run_generation(
    job_id: str,
    words_data: List[dict],
    order: str,
    gap_seconds: float,
    beep: bool,
    user_id: int,
) -> None:
    _jobs[job_id]["status"] = "running"
    loop = asyncio.get_event_loop()

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            # 1. Generate silence clip
            silence_path = str(tmp_path / "silence.mp3")
            gap_s = max(0.1, float(gap_seconds))
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi",
                    "-i", "anullsrc=r=44100:cl=stereo",
                    "-t", str(gap_s), silence_path,
                ],
                check=True,
                capture_output=True,
            )

            # 2. Generate beep clip if requested
            beep_path: Optional[str] = None
            if beep:
                beep_path = str(tmp_path / "beep.mp3")
                subprocess.run(
                    [
                        "ffmpeg", "-y", "-f", "lavfi",
                        "-i", "sine=frequency=880:duration=0.3",
                        "-ar", "44100", "-ac", "2", beep_path,
                    ],
                    check=True,
                    capture_output=True,
                )

            # 3. Download audio files and build segment list
            segments: List[str] = []
            for i, word in enumerate(words_data):
                _jobs[job_id]["progress"] = i

                if order == "word_first":
                    first_url = word["audio_url"]
                    second_url = word["audio_url_translation"]
                else:
                    first_url = word["audio_url_translation"]
                    second_url = word["audio_url"]

                first_path = str(tmp_path / f"w{i}_a.mp3")
                second_path = str(tmp_path / f"w{i}_b.mp3")

                await loop.run_in_executor(None, _download_file, first_url, first_path)
                await loop.run_in_executor(None, _download_file, second_url, second_path)

                segments.append(first_path)
                if beep and beep_path:
                    segments.append(beep_path)
                segments.append(second_path)
                segments.append(silence_path)

            # 4. Write ffmpeg concat list
            list_path = str(tmp_path / "concat.txt")
            with open(list_path, "w") as f:
                for seg in segments:
                    f.write(f"file '{seg}'\n")

            # 5. Concatenate all segments into final MP3
            ts = int(time.time())
            out_name = f"review_{ts}_{job_id[:8]}.mp3"
            out_path = str(_user_dir(user_id) / out_name)

            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                    "-i", list_path,
                    "-ar", "44100", "-ac", "2",
                    out_path,
                ],
                check=True,
                capture_output=True,
            )

            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["progress"] = len(words_data)
            _jobs[job_id]["filename"] = out_name

    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode(errors="replace")[:300] if e.stderr else ""
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = f"ffmpeg error: {stderr}"
    except Exception as e:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(e)


@router.websocket("/ws/{job_id}")
async def ws_progress(
    websocket: WebSocket,
    job_id: str,
    token: str = Query(""),
):
    await websocket.accept()

    payload = decode_token(token) if token else None
    if not payload:
        await websocket.send_json({"error": "unauthorized"})
        await websocket.close(code=1008)
        return

    user_id = int(payload.get("sub", 0))
    job = _jobs.get(job_id)
    if not job or job["user_id"] != user_id:
        await websocket.send_json({"error": "job not found"})
        await websocket.close(code=1008)
        return

    try:
        while True:
            job = _jobs.get(job_id, {})
            await websocket.send_json({
                "status": job.get("status"),
                "progress": job.get("progress", 0),
                "total": job.get("total", 0),
                "filename": job.get("filename"),
                "error": job.get("error"),
            })
            if job.get("status") in ("done", "error"):
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.get("/list")
def list_audios(current_user: User = Depends(get_current_user)):
    d = _user_dir(current_user.id)
    files = []
    for f in sorted(d.glob("*.mp3"), key=lambda x: x.stat().st_mtime, reverse=True):
        s = f.stat()
        files.append({
            "filename": f.name,
            "size_kb": round(s.st_size / 1024, 1),
            "created_at": int(s.st_mtime),
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
