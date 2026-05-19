"""YouTube subtitle import service.

Pipeline:
- parse_source: detect video ID / playlist ID from raw URL or ID
- list_playlist_videos: yt-dlp flat-playlist extraction
- fetch_transcript: youtube-transcript-api with language preference + fallbacks
- import_sources: orchestrator, persists SubtitleFile + SubtitleSegment rows
"""

from __future__ import annotations

import logging
import os
import re
import time
import unicodedata
import urllib.parse
from typing import Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")

from sqlalchemy.orm import Session

from ..models.subtitle import SubtitleFile, SubtitleSegment
from ..models.tema import Tema
from ..schemas.subtitle import (
    YouTubeImportItem,
    YouTubeImportRequest,
    YouTubeImportResult,
)
from .system_settings import (
    get_sticky_session,
    get_youtube_proxy_url,
    is_sticky_supported,
    mark_sticky_unsupported,
    set_sticky_session,
)

import secrets

_WEBSHARE_HOSTS = ("webshare.io",)
_SESSION_SUFFIX_RE = re.compile(r"-session-[A-Za-z0-9]+$")


def _is_webshare(url: str) -> bool:
    try:
        host = (urllib.parse.urlparse(url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        return False
    return any(host == h or host.endswith("." + h) for h in _WEBSHARE_HOSTS)


def _with_session(proxy_url: str, session: str) -> str:
    """Inject `-session-<token>` into the username (Webshare convention)."""
    parsed = urllib.parse.urlparse(proxy_url)
    if not parsed.username:
        return proxy_url
    base_user = _SESSION_SUFFIX_RE.sub("", parsed.username)
    new_user = f"{base_user}-session-{session}"
    auth = f"{new_user}:{parsed.password}" if parsed.password else new_user
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    rebuilt = f"{parsed.scheme}://{auth}@{host}{port}{parsed.path or ''}"
    if parsed.query:
        rebuilt += "?" + parsed.query
    return rebuilt


def _new_session_token() -> str:
    return secrets.token_hex(6)


def _is_proxy_auth_error(exc: BaseException) -> bool:
    s = str(exc)
    return "407" in s and ("Proxy Authentication" in s or "Tunnel connection failed" in s)

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


def _ytdlp_opts(extra: Optional[dict] = None) -> dict:
    """Base yt-dlp options with proxy from system settings if configured."""
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }
    proxy = get_youtube_proxy_url()
    if proxy:
        opts["proxy"] = proxy
    if extra:
        opts.update(extra)
    return opts


def list_playlist_videos(playlist_id: str, max_videos: int) -> List[str]:
    """Return list of video IDs for a playlist, capped at max_videos."""
    import yt_dlp  # imported lazily so tests not requiring yt-dlp still run

    opts = _ytdlp_opts({
        "extract_flat": True,
        "playlistend": max_videos,
    })
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

    opts = _ytdlp_opts({
        "extract_flat": True,
        "playlistend": max_videos,
    })
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return _playlist_entries_from_info(info, max_videos)


def fetch_video_title(video_id: str) -> Optional[str]:
    try:
        import yt_dlp

        opts = _ytdlp_opts()
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


def _build_api_from_url(proxy_url: Optional[str]) -> "YouTubeTranscriptApi":  # type: ignore[name-defined]
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.proxies import GenericProxyConfig

    if proxy_url:
        return YouTubeTranscriptApi(
            proxy_config=GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
        )
    return YouTubeTranscriptApi()


def _build_api(use_proxy: bool) -> "YouTubeTranscriptApi":  # type: ignore[name-defined]
    """Backwards-compatible builder (no sticky session, no rotation token)."""
    return _build_api_from_url(get_youtube_proxy_url() if use_proxy else None)


class TranscriptFetchError(RuntimeError):
    """Raised by fetch_transcript when all retry+fallback paths fail."""


def _try_fetch_once(
    api: "YouTubeTranscriptApi",  # type: ignore[name-defined]
    video_id: str,
    langs: List[str],
) -> Tuple[Optional[list], Optional[str]]:
    """One attempt against the given api instance.

    Returns (rows, used_lang) on success or (None, None) when the video genuinely
    has no transcript. Raises IpBlocked / RequestBlocked on YouTube blocks, and
    TranscriptFetchError on other unexpected errors.
    """
    from youtube_transcript_api._errors import (
        IpBlocked,
        NoTranscriptFound,
        RequestBlocked,
        TranscriptsDisabled,
        VideoUnavailable,
    )

    try:
        tl = api.list(video_id)
    except (IpBlocked, RequestBlocked):
        raise
    except (TranscriptsDisabled, VideoUnavailable):
        return (None, None)
    except Exception as exc:  # noqa: BLE001
        raise TranscriptFetchError(f"{type(exc).__name__}: {exc}") from exc

    last_unexpected: Optional[Exception] = None
    for lang in langs:
        try:
            t = tl.find_manually_created_transcript([lang])
            return (list(t.fetch()), t.language_code)
        except (IpBlocked, RequestBlocked):
            raise
        except NoTranscriptFound:
            continue
        except Exception as exc:  # noqa: BLE001
            last_unexpected = exc
            continue
    for lang in langs:
        try:
            t = tl.find_generated_transcript([lang])
            return (list(t.fetch()), t.language_code)
        except (IpBlocked, RequestBlocked):
            raise
        except NoTranscriptFound:
            continue
        except Exception as exc:  # noqa: BLE001
            last_unexpected = exc
            continue

    if last_unexpected is not None:
        raise TranscriptFetchError(
            f"{type(last_unexpected).__name__}: {last_unexpected}"
        ) from last_unexpected
    return (None, None)


def fetch_transcript(
    video_id: str,
    language: str,
    fallback_languages: List[str],
) -> Tuple[Optional[list], Optional[str]]:
    """Fetch transcript with sticky-session, rotation, and direct-IP fallback.

    Strategy:
    1. If a Webshare proxy is configured and we have a persisted "sticky"
       session token (a Webshare-IP that worked last time), try that first.
    2. If sticky fails (or none), rotate up to YT_PROXY_RETRIES extra times.
       Each rotation attempt uses a freshly-generated session token, which
       Webshare maps to a different egress IP. The FIRST session that works
       gets persisted as the new sticky.
    3. If every proxy attempt is blocked and YT_FALLBACK_DIRECT is enabled,
       try once via the server's own IP.

    Env vars:
    - YT_PROXY_RETRIES (int, default 3)
    - YT_PROXY_RETRY_SLEEP (float seconds, default 0.5)
    - YT_FALLBACK_DIRECT (bool, default true)

    Returns (rows, used_lang) on success or (None, None) when the video has no
    transcript. Raises TranscriptFetchError when every path failed.
    """
    from youtube_transcript_api._errors import IpBlocked, RequestBlocked

    langs: List[str] = [language] + [l for l in fallback_languages if l and l != language]
    proxy_base = get_youtube_proxy_url()
    proxy_configured = bool(proxy_base)
    is_webshare = proxy_configured and _is_webshare(proxy_base)  # type: ignore[arg-type]
    retries = max(0, _env_int("YT_PROXY_RETRIES", 3))
    sleep_s = max(0.0, _env_float("YT_PROXY_RETRY_SLEEP", 0.5))
    fallback_direct = _env_bool("YT_FALLBACK_DIRECT", True)

    last_exc: Optional[Exception] = None
    sticky_enabled = is_webshare and is_sticky_supported()

    # Step 1: try the persisted sticky session (Webshare only, when supported).
    if sticky_enabled:
        sticky = get_sticky_session()
        if sticky:
            url = _with_session(proxy_base, sticky)  # type: ignore[arg-type]
            try:
                logger.info("transcript: using sticky session for %s", video_id)
                return _try_fetch_once(_build_api_from_url(url), video_id, langs)
            except (IpBlocked, RequestBlocked) as exc:
                last_exc = exc
                logger.warning(
                    "transcript: sticky session blocked for %s — rotating: %s",
                    video_id, type(exc).__name__,
                )
                set_sticky_session(None)
            except TranscriptFetchError as exc:
                last_exc = exc
                if _is_proxy_auth_error(exc):
                    logger.warning(
                        "transcript: proxy plan rejects session pin (407) — disabling sticky permanently"
                    )
                    mark_sticky_unsupported()
                    set_sticky_session(None)
                    sticky_enabled = False
                else:
                    logger.warning(
                        "transcript: sticky session error for %s — rotating: %s",
                        video_id, exc,
                    )
                    set_sticky_session(None)
            if sleep_s > 0:
                time.sleep(sleep_s)

    # Step 2: rotation. With sticky support, each attempt uses a fresh session
    # token (Webshare maps each session to a different egress IP). Without it,
    # just re-hit the rotating endpoint (it picks an IP on its own).
    if proxy_configured:
        attempts_left = retries + 1
        attempt_no = 0
        while attempts_left > 0:
            attempt_no += 1
            session = _new_session_token() if sticky_enabled else None
            url = _with_session(proxy_base, session) if session else proxy_base  # type: ignore[arg-type]
            try:
                result = _try_fetch_once(_build_api_from_url(url), video_id, langs)
                if sticky_enabled and session:
                    set_sticky_session(session)
                    logger.info(
                        "transcript: saved sticky session — reuse on next request"
                    )
                return result
            except (IpBlocked, RequestBlocked) as exc:
                last_exc = exc
                logger.warning(
                    "transcript: rotation #%d blocked for %s: %s",
                    attempt_no, video_id, type(exc).__name__,
                )
                attempts_left -= 1
            except TranscriptFetchError as exc:
                last_exc = exc
                if sticky_enabled and session and _is_proxy_auth_error(exc):
                    logger.warning(
                        "transcript: proxy plan rejects session pin (407) — disabling sticky and retrying"
                    )
                    mark_sticky_unsupported()
                    sticky_enabled = False
                    # do NOT decrement attempts_left — this round didn't really test the proxy
                    continue
                logger.warning(
                    "transcript: rotation #%d error for %s: %s",
                    attempt_no, video_id, exc,
                )
                attempts_left -= 1
            if attempts_left > 0 and sleep_s > 0:
                time.sleep(sleep_s)

    # Step 3: direct IP fallback (server's own outbound IP, no proxy).
    if proxy_configured and fallback_direct:
        logger.warning(
            "transcript: every proxy path failed for %s — trying direct IP",
            video_id,
        )
        try:
            return _try_fetch_once(_build_api_from_url(None), video_id, langs)
        except (IpBlocked, RequestBlocked) as exc:
            last_exc = exc
            logger.warning(
                "transcript: direct-IP fallback also blocked for %s: %s",
                video_id, type(exc).__name__,
            )
        except TranscriptFetchError as exc:
            last_exc = exc
    elif not proxy_configured:
        # No proxy at all — just try direct.
        try:
            return _try_fetch_once(_build_api_from_url(None), video_id, langs)
        except (IpBlocked, RequestBlocked) as exc:
            last_exc = exc
        except TranscriptFetchError as exc:
            last_exc = exc

    if last_exc is not None:
        first_line = str(last_exc).splitlines()[0][:300] if str(last_exc) else type(last_exc).__name__
        raise TranscriptFetchError(f"{type(last_exc).__name__}: {first_line}") from last_exc
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

    inter_delay = max(0.0, _env_float("YT_INTER_VIDEO_DELAY", 0.5))

    for idx, vid in enumerate(video_ids):
        if idx > 0 and inter_delay > 0:
            time.sleep(inter_delay)
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
