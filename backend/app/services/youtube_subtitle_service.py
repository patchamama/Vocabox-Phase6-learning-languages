"""YouTube subtitle import service.

Pipeline:
- parse_source: detect video ID / playlist ID from raw URL or ID
- list_playlist_videos: yt-dlp flat-playlist extraction
- fetch_transcript: youtube-transcript-api with language preference + fallbacks
- import_sources: orchestrator, persists SubtitleFile + SubtitleSegment rows
"""

from __future__ import annotations

import logging
import re
import unicodedata
import urllib.parse
from typing import Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session

from ..models.subtitle import SubtitleFile, SubtitleSegment
from ..models.tema import Tema
from ..schemas.subtitle import (
    YouTubeImportItem,
    YouTubeImportRequest,
    YouTubeImportResult,
)

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_PLAYLIST_ID_RE = re.compile(r"^(PL|UU|FL|RD|OLAK5uy_)[A-Za-z0-9_-]{10,}$")


class NotImplementedYet(RuntimeError):
    pass


def parse_source(src: str) -> Optional[Tuple[str, str]]:
    """Return ('video'|'playlist', id) or None if unrecognised."""
    s = (src or "").strip()
    if not s:
        return None
    if _VIDEO_ID_RE.match(s):
        return ("video", s)
    if _PLAYLIST_ID_RE.match(s):
        return ("playlist", s)
    try:
        u = urllib.parse.urlparse(s)
    except Exception:
        return None
    if not u.netloc:
        return None
    qs = urllib.parse.parse_qs(u.query)
    if "list" in qs and qs["list"]:
        return ("playlist", qs["list"][0])
    if "v" in qs and qs["v"]:
        vid = qs["v"][0]
        if _VIDEO_ID_RE.match(vid):
            return ("video", vid)
    if u.netloc.endswith("youtu.be") and u.path:
        vid = u.path.lstrip("/").split("/")[0]
        if _VIDEO_ID_RE.match(vid):
            return ("video", vid)
    parts = [p for p in u.path.split("/") if p]
    if len(parts) >= 2 and parts[0] in ("shorts", "embed", "v"):
        if _VIDEO_ID_RE.match(parts[1]):
            return ("video", parts[1])
    return None


def playlist_ids_from_sources(sources: List[str]) -> List[Tuple[str, str]]:
    """Return unique playlist IDs plus their original source string."""
    out: List[Tuple[str, str]] = []
    seen: set[str] = set()
    for src in sources:
        parsed = parse_source(src)
        if not parsed:
            continue
        kind, ident = parsed
        if kind == "playlist" and ident not in seen:
            seen.add(ident)
            out.append((ident, src))
    return out


def list_playlist_videos(playlist_id: str, max_videos: int) -> List[str]:
    """Return list of video IDs for a playlist, capped at max_videos."""
    import yt_dlp  # imported lazily so tests not requiring yt-dlp still run

    opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "playlistend": max_videos,
    }
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return [video_id for video_id, _title in _playlist_entries_from_info(info, max_videos)]


def _playlist_entries_from_info(info: dict | None, max_videos: int) -> List[Tuple[str, Optional[str]]]:
    entries = (info or {}).get("entries") or []
    out: List[Tuple[str, Optional[str]]] = []
    for e in entries:
        vid = (e or {}).get("id") or (e or {}).get("url")
        if isinstance(vid, str) and _VIDEO_ID_RE.match(vid):
            title = (e or {}).get("title")
            out.append((vid, title if isinstance(title, str) else None))
        if len(out) >= max_videos:
            break
    return out


def list_playlist_video_entries(playlist_id: str, max_videos: int) -> List[Tuple[str, Optional[str]]]:
    import yt_dlp

    opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "playlistend": max_videos,
    }
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return _playlist_entries_from_info(info, max_videos)


def fetch_video_title(video_id: str) -> Optional[str]:
    try:
        import yt_dlp

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        title = (info or {}).get("title")
        return title if isinstance(title, str) and title.strip() else None
    except Exception:
        return None


def _safe_filename_title(title: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", title or "")
    ascii_title = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "", ascii_title)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._-")
    return (cleaned or fallback)[:140]


def _build_api() -> "YouTubeTranscriptApi":  # type: ignore[name-defined]
    import os
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.proxies import GenericProxyConfig

    proxy_url = os.environ.get("YOUTUBE_PROXY_URL", "").strip() or None
    if proxy_url:
        return YouTubeTranscriptApi(proxy_config=GenericProxyConfig(http_url=proxy_url, https_url=proxy_url))
    return YouTubeTranscriptApi()


class TranscriptFetchError(RuntimeError):
    """Raised by fetch_transcript for a non-IpBlocked failure with a meaningful message."""


def fetch_transcript(
    video_id: str,
    language: str,
    fallback_languages: List[str],
) -> Tuple[Optional[list], Optional[str]]:
    """Return (snippets, used_lang) or (None, None) if no transcript available.

    Raises IpBlocked if YouTube blocks the server IP — callers should handle this
    by aborting the batch rather than retrying per-video.
    Raises TranscriptFetchError on unexpected fetch errors (network, proxy, etc.)
    so the caller can surface the real cause instead of "No transcript available".
    """
    from youtube_transcript_api._errors import (
        IpBlocked,
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
    )

    langs: List[str] = [language] + [l for l in fallback_languages if l and l != language]
    api = _build_api()
    try:
        tl = api.list(video_id)
    except IpBlocked:
        raise
    except (TranscriptsDisabled, VideoUnavailable):
        return (None, None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("transcript list() failed for %s: %s: %s",
                       video_id, type(exc).__name__, exc)
        raise TranscriptFetchError(f"{type(exc).__name__}: {exc}") from exc

    last_unexpected: Optional[Exception] = None

    # Prefer manually-created
    for lang in langs:
        try:
            t = tl.find_manually_created_transcript([lang])
            fetched = t.fetch()
            return (list(fetched), t.language_code)
        except IpBlocked:
            raise
        except NoTranscriptFound:
            continue
        except Exception as exc:  # noqa: BLE001
            last_unexpected = exc
            logger.warning("manual transcript fetch failed for %s [%s]: %s: %s",
                           video_id, lang, type(exc).__name__, exc)
            continue
    # Fallback to auto-generated
    for lang in langs:
        try:
            t = tl.find_generated_transcript([lang])
            fetched = t.fetch()
            return (list(fetched), t.language_code)
        except IpBlocked:
            raise
        except NoTranscriptFound:
            continue
        except Exception as exc:  # noqa: BLE001
            last_unexpected = exc
            logger.warning("generated transcript fetch failed for %s [%s]: %s: %s",
                           video_id, lang, type(exc).__name__, exc)
            continue

    if last_unexpected is not None:
        raise TranscriptFetchError(
            f"{type(last_unexpected).__name__}: {last_unexpected}"
        ) from last_unexpected
    return (None, None)


def _rows_to_segments(rows: list) -> List[dict]:
    """Convert FetchedTranscriptSnippet items (or dict rows) to segment payloads."""
    out: List[dict] = []
    for r in rows:
        if isinstance(r, dict):
            start_val = r.get("start", 0)
            dur_val = r.get("duration", 0)
            text_val = r.get("text") or ""
        else:
            start_val = getattr(r, "start", 0)
            dur_val = getattr(r, "duration", 0)
            text_val = getattr(r, "text", "") or ""
        try:
            start = float(start_val or 0)
            dur = float(dur_val or 0)
        except (TypeError, ValueError):
            continue
        text = (text_val or "").strip()
        if not text:
            continue
        out.append({
            "start_ms": int(start * 1000),
            "end_ms": int((start + dur) * 1000),
            "text": text,
            "text_lower": text.lower(),
        })
    return out


def _expand_sources(
    sources: List[str],
    max_videos: int,
) -> Tuple[List[str], Dict[str, str], List[YouTubeImportItem]]:
    video_ids: List[str] = []
    titles: Dict[str, str] = {}
    seen: set[str] = set()
    errors: List[YouTubeImportItem] = []

    for raw in sources:
        if len(video_ids) >= max_videos:
            break
        parsed = parse_source(raw)
        if not parsed:
            errors.append(YouTubeImportItem(
                video_id=(raw or "")[:32],
                status="error",
                error="Invalid source",
            ))
            continue
        kind, ident = parsed
        if kind == "video":
            if ident not in seen:
                seen.add(ident)
                video_ids.append(ident)
        else:
            remaining = max_videos - len(video_ids)
            try:
                pl_ids = list_playlist_video_entries(ident, remaining)
            except Exception as exc:  # noqa: BLE001
                errors.append(YouTubeImportItem(
                    video_id=ident,
                    status="error",
                    error=f"Playlist error: {exc}",
                ))
                continue
            for v, title in pl_ids:
                if v in seen:
                    continue
                seen.add(v)
                video_ids.append(v)
                if title:
                    titles[v] = title
                if len(video_ids) >= max_videos:
                    break
    return video_ids[:max_videos], titles, errors


def import_sources(
    req: YouTubeImportRequest,
    user_id: int,
    db: Session,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> YouTubeImportResult:
    from youtube_transcript_api._errors import IpBlocked

    items: List[YouTubeImportItem] = []
    video_ids, known_titles, parse_errors = _expand_sources(req.sources, req.max_videos)
    items.extend(parse_errors)

    total = len(video_ids)
    if on_progress:
        on_progress(0, total)

    temas: List[Tema] = []
    if req.tema_ids:
        temas = db.query(Tema).filter(Tema.id.in_(req.tema_ids)).all()
    stars = max(0, min(3, req.stars))

    for idx, vid in enumerate(video_ids):
        existing = (
            db.query(SubtitleFile)
            .filter(
                SubtitleFile.user_id == user_id,
                SubtitleFile.youtube_id == vid,
            )
            .first()
        )
        if existing:
            items.append(YouTubeImportItem(
                video_id=vid,
                status="skipped",
                file_id=existing.id,
                filename=existing.filename,
                segments=existing.total_segments,
                error="Already imported",
            ))
            if on_progress:
                on_progress(idx + 1, total)
            continue

        try:
            try:
                rows, used_lang = fetch_transcript(vid, req.language, req.fallback_languages)
            except TranscriptFetchError as fetch_exc:
                items.append(YouTubeImportItem(
                    video_id=vid,
                    status="error",
                    error=str(fetch_exc)[:200],
                ))
                if on_progress:
                    on_progress(idx + 1, total)
                continue
            if not rows:
                items.append(YouTubeImportItem(
                    video_id=vid,
                    status="error",
                    error="No transcript available",
                ))
                if on_progress:
                    on_progress(idx + 1, total)
                continue
            segs = _rows_to_segments(rows)
            if not segs:
                items.append(YouTubeImportItem(
                    video_id=vid,
                    status="error",
                    error="Empty transcript",
                ))
                if on_progress:
                    on_progress(idx + 1, total)
                continue

            title = known_titles.get(vid) or fetch_video_title(vid) or vid
            safe_title = _safe_filename_title(title, vid)
            filename = f"{safe_title}.{used_lang or req.language}.vtt"
            sub = SubtitleFile(
                user_id=user_id,
                filename=filename,
                youtube_id=vid,
                language=used_lang or req.language,
                total_segments=len(segs),
                stars=stars,
            )
            if temas:
                sub.temas = list(temas)
            db.add(sub)
            db.flush()

            db.bulk_insert_mappings(
                SubtitleSegment,
                [{"file_id": sub.id, **s} for s in segs],
            )
            db.commit()

            items.append(YouTubeImportItem(
                video_id=vid,
                status="created",
                file_id=sub.id,
                filename=sub.filename,
                segments=len(segs),
            ))
        except IpBlocked as exc:
            db.rollback()
            ip_msg = "IP bloqueada por YouTube — configurá YOUTUBE_PROXY_URL en el servidor"
            items.append(YouTubeImportItem(video_id=vid, status="error", error=ip_msg))
            # No point retrying remaining videos — bail out and mark all as failed
            for remaining in video_ids[idx + 1:]:
                items.append(YouTubeImportItem(video_id=remaining, status="error", error=ip_msg))
            if on_progress:
                on_progress(total, total)
            break
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            items.append(YouTubeImportItem(
                video_id=vid,
                status="error",
                error=str(exc)[:200],
            ))
        if on_progress:
            on_progress(idx + 1, total)

    created = sum(1 for i in items if i.status == "created")
    skipped = sum(1 for i in items if i.status == "skipped")
    errors = sum(1 for i in items if i.status == "error")
    return YouTubeImportResult(
        items=items,
        created=created,
        skipped=skipped,
        errors=errors,
    )


__all__ = [
    "NotImplementedYet",
    "import_sources",
    "parse_source",
    "playlist_ids_from_sources",
    "list_playlist_videos",
    "fetch_transcript",
    "YouTubeImportItem",
    "YouTubeImportRequest",
    "YouTubeImportResult",
]
