"""
leo_service.py — LEO Dictionary lookup (Alemán ↔ Español/Inglés/etc.)

Ported from test/leo_lookup.py — only the lookup logic, no HTML generation.
"""

import logging
import re
import secrets
import urllib.parse
from xml.etree import ElementTree as ET

from curl_cffi import requests as cf_requests

from .system_settings import (
    get_leo_last_working_proxy,
    get_youtube_proxy_url,
    is_sticky_supported,
    mark_sticky_unsupported,
    set_leo_last_working_proxy,
)

AUDIO_BASE = "https://dict.leo.org/media/audio/{file_id}.mp3"

LANG_PAIRS = {
    "esde": ("alem%C3%A1n-espa%C3%B1ol", {"es": "Español", "de": "Alemán"}),
    "ende": ("englisch-deutsch",           {"en": "Inglés",  "de": "Alemán"}),
    "frde": ("franz%C3%B6sisch-deutsch",   {"fr": "Francés", "de": "Alemán"}),
    "itde": ("italienisch-deutsch",        {"it": "Italiano","de": "Alemán"}),
    "ptde": ("portugiesisch-deutsch",      {"pt": "Portugués","de":"Alemán"}),
}

HEADERS = {
    "Accept-Language": "es-ES,es;q=0.9",
}


_MAX_PROXY_ATTEMPTS = 10
_WEBSHARE_HOSTS = ("webshare.io",)
_SESSION_SUFFIX_RE = re.compile(r"-session-[A-Za-z0-9]+$")
logger = logging.getLogger(__name__)


class LeoLookupError(RuntimeError):
    """Raised only after every configured LEO proxy candidate was exhausted."""


def _is_webshare(proxy_url: str) -> bool:
    try:
        host = (urllib.parse.urlparse(proxy_url).hostname or "").lower()
    except ValueError:
        return False
    return any(host == suffix or host.endswith("." + suffix) for suffix in _WEBSHARE_HOSTS)


def _with_session(proxy_url: str, session: str) -> str:
    """Create a Webshare sticky-session proxy URL without changing its endpoint."""
    parsed = urllib.parse.urlparse(proxy_url)
    if not parsed.username:
        return proxy_url
    username = _SESSION_SUFFIX_RE.sub("", parsed.username)
    auth = f"{username}-session-{session}"
    if parsed.password:
        auth += f":{parsed.password}"
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    rebuilt = f"{parsed.scheme}://{auth}@{host}{port}{parsed.path or ''}"
    if parsed.query:
        rebuilt += f"?{parsed.query}"
    return rebuilt


def _without_session(proxy_url: str) -> str:
    """Return a Webshare URL without its optional sticky-session suffix."""
    parsed = urllib.parse.urlparse(proxy_url)
    if not parsed.username:
        return proxy_url
    username = _SESSION_SUFFIX_RE.sub("", parsed.username)
    auth = username
    if parsed.password:
        auth += f":{parsed.password}"
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    rebuilt = f"{parsed.scheme}://{auth}@{host}{port}{parsed.path or ''}"
    if parsed.query:
        rebuilt += f"?{parsed.query}"
    return rebuilt


def _is_sticky_proxy(proxy_url: str | None) -> bool:
    if not proxy_url:
        return False
    try:
        username = urllib.parse.urlparse(proxy_url).username or ""
    except ValueError:
        return False
    return bool(_SESSION_SUFFIX_RE.search(username))


def _is_proxy_auth_error(exc: BaseException) -> bool:
    """Recognize Webshare's rejection of unsupported sticky usernames."""
    message = str(exc).lower()
    return "407" in message and ("proxy" in message or "tunnel" in message)


def _configured_proxies() -> list[str]:
    """Split a configured proxy list while retaining compatibility with one URL."""
    configured = get_youtube_proxy_url() or ""
    return [item.strip() for item in re.split(r"[\s,]+", configured) if item.strip()]


def _proxy_candidates(sticky_supported: bool | None = None) -> list[str | None]:
    """Prefer the known-good proxy, then visit distinct configured alternatives.

    Webshare is a rotating endpoint. Its sticky-session username is a distinct
    proxy candidate, which lets us move to another egress IP deterministically.
    """
    configured = _configured_proxies()
    if sticky_supported is None:
        sticky_supported = is_sticky_supported()
    last_working = get_leo_last_working_proxy()
    candidates: list[str | None] = []

    def add(candidate: str | None) -> None:
        if candidate not in candidates and len(candidates) < _MAX_PROXY_ATTEMPTS:
            candidates.append(candidate)

    if last_working:
        if _is_webshare(last_working) and not sticky_supported:
            last_working = _without_session(last_working)
        add(last_working)

    for proxy in configured:
        if len(candidates) >= _MAX_PROXY_ATTEMPTS:
            break
        if _is_webshare(proxy) and sticky_supported:
            # A fixed session chooses an egress IP. Try new sessions only after
            # the previously working one has failed.
            for _ in range(_MAX_PROXY_ATTEMPTS):
                if len(candidates) >= _MAX_PROXY_ATTEMPTS:
                    break
                add(_with_session(proxy, secrets.token_hex(6)))
        else:
            add(proxy)

    if not sticky_supported:
        # On plans without sticky usernames, the endpoint itself rotates egress
        # IPs. Deliberately repeat it after distinct configured proxies have had
        # a chance; each new connection can select a different exit.
        rotating = next((proxy for proxy in configured if _is_webshare(proxy)), None)
        while rotating and len(candidates) < _MAX_PROXY_ATTEMPTS:
            candidates.append(_without_session(rotating))

    # Keep the no-proxy behaviour for installations that have no proxy configured.
    if not candidates:
        add(None)
    return candidates


def _fetch_html(url: str, proxy: str | None) -> str:
    proxies = {"http": proxy, "https": proxy} if proxy else None
    response = cf_requests.get(
        url, headers=HEADERS, proxies=proxies, impersonate="chrome124", timeout=20
    )
    response.raise_for_status()
    return response.text


def _extract_xml(html: str) -> str:
    pattern = (
        r"<script[^>]*>\s*"
        r"(<xml[^>]+leorendertarget[^>]+>[\s\S]*?</xml>)"
        r"\s*</script>"
    )
    m = re.search(pattern, html)
    if not m:
        raise ValueError("No XML block found in LEO page.")
    return m.group(1)


def _parse_entries(xml_str: str, max_results: int) -> list:
    root = ET.fromstring(xml_str)
    results = []

    for section in root.iter("section"):
        if len(results) >= max_results:
            break
        sct_title = section.get("sctTitle", "")

        for entry in section.findall("entry"):
            if len(results) >= max_results:
                break

            aiid = entry.get("aiid", "")
            cat_el = entry.find(".//category")
            category_type = cat_el.get("type", "") if cat_el is not None else ""

            sides = []
            for side in entry.findall("side"):
                lang = side.get("lang", "")
                repr_el = side.find("repr")
                text = ""
                if repr_el is not None:
                    text = "".join(repr_el.itertext())
                    text = re.sub(r"\s+", " ", text).strip()

                audio_files = []
                pron = side.find(".//pron")
                if pron is not None:
                    for f in pron.findall("file"):
                        fid = f.get("name", "")
                        label = f.get("label", "")
                        if fid:
                            audio_files.append({
                                "file_id": fid,
                                "label":   label,
                                "mp3_url": AUDIO_BASE.format(file_id=fid),
                            })

                sides.append({
                    "lang":  lang,
                    "text":  text,
                    "audio": audio_files,
                })

            results.append({
                "aiid":     aiid,
                "section":  sct_title,
                "category": category_type,
                "sides":    sides,
            })

    return results


def lookup(word: str, lp: str = "esde", max_results: int = 3) -> dict:
    """Fetch LEO entries, failing over proxies before surfacing an error.

    A 200 page without LEO's render XML is considered a failed candidate too:
    Cloudflare challenge pages must never be returned as a successful lookup.
    """
    path, _ = LANG_PAIRS[lp]
    encoded = urllib.parse.quote(word, safe="")
    url = f"https://dict.leo.org/{path}/{encoded}"
    last_exc: Exception | None = None

    candidates = list(_proxy_candidates())
    attempts = 0
    while candidates and attempts < _MAX_PROXY_ATTEMPTS:
        proxy = candidates.pop(0)
        attempts += 1
        try:
            html = _fetch_html(url, proxy)
            xml_str = _extract_xml(html)
            entries = _parse_entries(xml_str, max_results)
            if proxy:
                try:
                    set_leo_last_working_proxy(proxy)
                except Exception:
                    # A successful lookup must not become a client-visible
                    # failure merely because the preference could not be saved.
                    logger.exception("Unable to persist the successful LEO proxy")
            _, lang_labels = LANG_PAIRS[lp]
            return {
                "word": word,
                "lang_pair": lp,
                "total_results": len(entries),
                "lang_labels": lang_labels,
                "entries": entries,
            }
        except Exception as exc:  # An unusable 200 response is also a failed proxy.
            last_exc = exc
            if _is_sticky_proxy(proxy) and _is_proxy_auth_error(exc):
                # Some Webshare plans reject the session username with 407.
                # Remember that capability result and continue with the normal
                # rotating endpoint instead of burning the remaining attempts.
                try:
                    mark_sticky_unsupported()
                except Exception:
                    logger.exception("Unable to persist unsupported Webshare sticky sessions")
                candidates = _proxy_candidates(sticky_supported=False)

    raise LeoLookupError(
        f"LEO lookup failed after {attempts} proxy candidates"
    ) from last_exc
