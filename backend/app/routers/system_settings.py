"""Admin-only endpoints for app-wide system settings."""

from __future__ import annotations

import concurrent.futures
import os
import re
from typing import List, Literal, Optional
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..dependencies import get_current_admin
from ..models.user import User
from ..services.system_settings import (
    YOUTUBE_COOKIES_KEY,
    YOUTUBE_PROXY_KEY,
    get_youtube_cookies_source,
    get_youtube_cookies_text,
    get_sticky_session,
    get_youtube_proxy_url,
    get_youtube_proxy_source,
    is_sticky_supported,
    reset_sticky_support,
    set_setting,
    set_sticky_session,
)

router = APIRouter(prefix="/system-settings", tags=["system-settings"])

# Stable video used to detect YouTube IP blocks. "Me at the zoo" — first
# YouTube video ever uploaded, public, has transcripts, unlikely to disappear.
_PROBE_VIDEO_ID = "jNQXAC9IVRw"


def _mask_proxy(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    return re.sub(r"(://)([^:/@]+):([^@]+)@", r"\1***:***@", url)


class ProxyInfo(BaseModel):
    masked_url: Optional[str]
    source: Literal["db", "env", "none"]
    has_value: bool
    db_override_set: bool
    env_set: bool
    sticky_supported: bool
    sticky_active: bool


class ProxyUpdate(BaseModel):
    url: Optional[str] = None


class YouTubeCookiesInfo(BaseModel):
    source: Literal["db", "env", "none"]
    has_value: bool
    db_override_set: bool
    env_set: bool


class YouTubeCookiesUpdate(BaseModel):
    cookies: Optional[str] = None


class ProxyTestResult(BaseModel):
    ok: bool
    status_code: Optional[int] = None
    detail: Optional[str] = None
    origin: Optional[str] = None


class ProxyCheckRequest(BaseModel):
    urls: List[str] = Field(default_factory=list)
    samples: int = 1  # for a single rotating proxy, probe N times to surface multiple egress IPs


class ProxyCheckItem(BaseModel):
    url_masked: str
    reachable: bool                  # TCP+auth ok via httpbin
    egress_ip: Optional[str] = None
    youtube_ok: bool                 # YouTube did NOT block this proxy
    youtube_blocked: bool            # explicit block (IpBlocked / RequestBlocked)
    youtube_status: str              # 'ok' | 'blocked' | 'error' | 'unreachable'
    detail: Optional[str] = None


class ProxyCheckResponse(BaseModel):
    results: List[ProxyCheckItem]


def _build_info() -> ProxyInfo:
    effective = get_youtube_proxy_url()
    source = get_youtube_proxy_source()
    return ProxyInfo(
        masked_url=_mask_proxy(effective),
        source=source,
        has_value=bool(effective),
        db_override_set=source == "db",
        env_set=bool((os.environ.get("YOUTUBE_PROXY_URL") or "").strip()),
        sticky_supported=is_sticky_supported(),
        sticky_active=bool(get_sticky_session()),
    )


def _build_cookies_info() -> YouTubeCookiesInfo:
    source = get_youtube_cookies_source()
    return YouTubeCookiesInfo(
        source=source,
        has_value=bool(get_youtube_cookies_text()),
        db_override_set=source == "db",
        env_set=bool((os.environ.get("YOUTUBE_COOKIES") or "").strip()),
    )


def _validate_netscape_cookies(raw: str) -> None:
    lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#") and not stripped.startswith("#HttpOnly_"):
            continue
        lines.append(stripped)
    if not lines:
        raise HTTPException(status_code=400, detail="Cookies are empty")
    valid = 0
    for line in lines:
        parts = line.split("\t")
        if len(parts) == 7 and "youtube.com" in parts[0].lower():
            valid += 1
    if valid == 0:
        raise HTTPException(
            status_code=400,
            detail="Paste cookies in Netscape format exported for youtube.com",
        )


@router.get("/youtube-proxy", response_model=ProxyInfo)
def get_youtube_proxy(_: User = Depends(get_current_admin)):
    return _build_info()


@router.put("/youtube-proxy", response_model=ProxyInfo)
def put_youtube_proxy(payload: ProxyUpdate, _: User = Depends(get_current_admin)):
    raw = (payload.url or "").strip()
    if raw:
        try:
            parsed = urlparse(raw)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid proxy URL")
        if parsed.scheme not in {"http", "https", "socks5", "socks5h"} or not parsed.hostname:
            raise HTTPException(status_code=400, detail="Proxy URL must include scheme and host")
    set_setting(YOUTUBE_PROXY_KEY, raw or None)
    return _build_info()


@router.delete("/youtube-proxy", response_model=ProxyInfo)
def clear_youtube_proxy(_: User = Depends(get_current_admin)):
    """Clear DB override. Effective value falls back to env var if set."""
    set_setting(YOUTUBE_PROXY_KEY, None)
    return _build_info()


@router.post("/youtube-proxy/sticky/reset", response_model=ProxyInfo)
def reset_sticky(_: User = Depends(get_current_admin)):
    """Re-enable sticky session attempts (after upgrading proxy plan, etc.)."""
    reset_sticky_support()
    set_sticky_session(None)
    return _build_info()


@router.get("/youtube-cookies", response_model=YouTubeCookiesInfo)
def get_youtube_cookies(_: User = Depends(get_current_admin)):
    return _build_cookies_info()


@router.put("/youtube-cookies", response_model=YouTubeCookiesInfo)
def put_youtube_cookies(payload: YouTubeCookiesUpdate, _: User = Depends(get_current_admin)):
    raw = (payload.cookies or "").strip()
    if raw:
        _validate_netscape_cookies(raw)
    set_setting(YOUTUBE_COOKIES_KEY, raw or None)
    return _build_cookies_info()


@router.delete("/youtube-cookies", response_model=YouTubeCookiesInfo)
def clear_youtube_cookies(_: User = Depends(get_current_admin)):
    set_setting(YOUTUBE_COOKIES_KEY, None)
    return _build_cookies_info()


@router.post("/youtube-proxy/test", response_model=ProxyTestResult)
def test_youtube_proxy(_: User = Depends(get_current_admin)):
    """Probe the currently-effective proxy by hitting httpbin.org/ip."""
    proxy = get_youtube_proxy_url()
    if not proxy:
        return ProxyTestResult(ok=False, detail="No proxy configured")
    try:
        r = requests.get(
            "https://httpbin.org/ip",
            proxies={"http": proxy, "https": proxy},
            timeout=12,
        )
        if r.status_code == 200:
            try:
                origin = (r.json() or {}).get("origin")
            except ValueError:
                origin = None
            return ProxyTestResult(ok=True, status_code=200, origin=origin)
        return ProxyTestResult(ok=False, status_code=r.status_code, detail=r.text[:200])
    except Exception as exc:  # noqa: BLE001
        return ProxyTestResult(ok=False, detail=f"{type(exc).__name__}: {exc}"[:300])


def _probe_one(proxy_url: str) -> ProxyCheckItem:
    """Probe a single proxy: egress IP via httpbin, then YouTube block check."""
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import IpBlocked, RequestBlocked
    from youtube_transcript_api.proxies import GenericProxyConfig

    masked = _mask_proxy(proxy_url) or proxy_url
    proxies = {"http": proxy_url, "https": proxy_url}

    egress: Optional[str] = None
    reachable = False
    detail_parts: List[str] = []
    try:
        r = requests.get("https://httpbin.org/ip", proxies=proxies, timeout=12)
        if r.status_code == 200:
            reachable = True
            try:
                egress = (r.json() or {}).get("origin")
            except ValueError:
                egress = None
        else:
            detail_parts.append(f"httpbin {r.status_code}")
    except Exception as exc:  # noqa: BLE001
        detail_parts.append(f"httpbin error: {type(exc).__name__}: {exc}")

    youtube_status = "unreachable"
    youtube_ok = False
    youtube_blocked = False
    if reachable:
        try:
            api = YouTubeTranscriptApi(
                proxy_config=GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
            )
            api.list(_PROBE_VIDEO_ID)
            youtube_status = "ok"
            youtube_ok = True
        except (IpBlocked, RequestBlocked) as exc:
            youtube_status = "blocked"
            youtube_blocked = True
            detail_parts.append(f"YT block: {type(exc).__name__}")
        except Exception as exc:  # noqa: BLE001
            youtube_status = "error"
            detail_parts.append(f"YT error: {type(exc).__name__}: {str(exc).splitlines()[0][:120]}")

    return ProxyCheckItem(
        url_masked=masked,
        reachable=reachable,
        egress_ip=egress,
        youtube_ok=youtube_ok,
        youtube_blocked=youtube_blocked,
        youtube_status=youtube_status,
        detail=" | ".join(detail_parts)[:400] or None,
    )


@router.post("/youtube-proxy/check", response_model=ProxyCheckResponse)
def check_youtube_proxies(
    payload: ProxyCheckRequest,
    _: User = Depends(get_current_admin),
):
    """Probe each given proxy URL against YouTube.

    - If `urls` is empty, falls back to the currently-effective proxy.
    - For a rotating proxy, set `samples` > 1 to probe several times and surface
      multiple egress IPs (each row in the result is one independent probe).
    """
    urls = [u.strip() for u in (payload.urls or []) if u and u.strip()]
    if not urls:
        eff = get_youtube_proxy_url()
        if not eff:
            return ProxyCheckResponse(results=[])
        urls = [eff]

    samples = max(1, min(10, int(payload.samples or 1)))
    expanded: List[str] = []
    for u in urls:
        expanded.extend([u] * samples)

    # Cap concurrency: too many parallel probes via the same upstream proxy can
    # itself look abusive. 5 parallel max.
    results: List[ProxyCheckItem] = []
    if not expanded:
        return ProxyCheckResponse(results=results)
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(5, len(expanded))) as pool:
        for item in pool.map(_probe_one, expanded):
            results.append(item)
    return ProxyCheckResponse(results=results)
