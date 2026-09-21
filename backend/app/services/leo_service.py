"""
leo_service.py — LEO Dictionary lookup (Alemán ↔ Español/Inglés/etc.)

Ported from test/leo_lookup.py — only the lookup logic, no HTML generation.
"""

import atexit
import logging
import queue
import re
import secrets
import threading
import urllib.parse
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

from curl_cffi import requests as cf_requests

from .system_settings import (
    get_leo_fast_tier_down_until,
    get_leo_last_working_proxy,
    get_youtube_proxy_url,
    is_sticky_supported,
    mark_sticky_unsupported,
    set_leo_fast_tier_down_until,
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


_MAX_PROXY_ATTEMPTS = 4  # kept small: a reliable (if slower) headless-browser tier follows
_WEBSHARE_HOSTS = ("webshare.io",)
_SESSION_SUFFIX_RE = re.compile(r"-session-[A-Za-z0-9]+$")
_FAST_TIER_COOLDOWN = timedelta(hours=4)
logger = logging.getLogger(__name__)


class LeoLookupError(RuntimeError):
    """Raised only after every configured LEO proxy candidate was exhausted."""


def _is_fast_tier_down() -> bool:
    """True while the curl_cffi tier is on cooldown after being fully blocked."""
    until = get_leo_fast_tier_down_until()
    return until is not None and datetime.utcnow() < until


def _mark_fast_tier_down() -> None:
    until = datetime.utcnow() + _FAST_TIER_COOLDOWN
    try:
        set_leo_fast_tier_down_until(until)
    except Exception:
        logger.exception("Unable to persist LEO fast-tier cooldown")
    logger.warning("LEO: fast tier fully blocked, skipping it until %s", until.isoformat())


def _clear_fast_tier_down() -> None:
    try:
        set_leo_fast_tier_down_until(None)
    except Exception:
        logger.exception("Unable to clear LEO fast-tier cooldown")


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


_CF_CHALLENGE_MARKERS = ("Just a moment", "Attention Required", "cdn-cgi/challenge-platform")


def _is_cloudflare_challenge(html: str) -> bool:
    return any(marker in html for marker in _CF_CHALLENGE_MARKERS)


def _fetch_html(url: str, proxy: str | None) -> str:
    """Fetch the page, guaranteeing the result is real LEO content.

    Raises on network failure, HTTP error, or a Cloudflare challenge page —
    all three mean "this candidate is blocked," never "word not found."
    """
    proxies = {"http": proxy, "https": proxy} if proxy else None
    response = cf_requests.get(
        url, headers=HEADERS, proxies=proxies, impersonate="chrome124", timeout=20
    )
    response.raise_for_status()
    html = response.text
    if _is_cloudflare_challenge(html):
        raise RuntimeError("Cloudflare challenge page (blocked)")
    return html


_PLAYWRIGHT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


def _playwright_candidates() -> list[str | None]:
    """Short candidate list for the (expensive) headless-browser fallback.

    Unlike curl_cffi, a real browser executes Cloudflare's JS challenge, so
    it isn't limited by the proxy's TLS-fingerprint reputation — direct
    access from this server has proven at least as reliable, and it's
    cheaper (no proxy auth hop), so it's tried first here.
    """
    seen: list[str | None] = [None]
    last_working = get_leo_last_working_proxy()
    if last_working:
        seen.append(last_working)
    for proxy in _configured_proxies():
        if proxy not in seen:
            seen.append(proxy)
        if len(seen) >= 3:
            break
    return seen


def _proxy_to_playwright_config(proxy: str | None) -> dict | None:
    if not proxy:
        return None
    parsed = urllib.parse.urlparse(proxy)
    return {
        "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
        "username": parsed.username,
        "password": parsed.password,
    }


class _PlaywrightWorker:
    """Keeps one headless browser alive across requests instead of relaunching
    it per lookup, and reuses one BrowserContext per proxy so Cloudflare's
    clearance cookie survives between searches too.

    Playwright's sync API may only be touched from the thread that started
    it, but FastAPI's sync routes run in a rotating threadpool — so all
    browser work happens on a single dedicated worker thread, and callers
    (any thread) submit jobs to it through a queue.
    """

    def __init__(self) -> None:
        self._jobs: "queue.Queue[tuple | None]" = queue.Queue()
        self._thread: threading.Thread | None = None
        self._start_lock = threading.Lock()

    def _ensure_started(self) -> None:
        if self._thread is not None:
            return
        with self._start_lock:
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, daemon=True)
                self._thread.start()

    def _run(self) -> None:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True, args=["--disable-blink-features=AutomationControlled"]
            )
            contexts: dict[str, object] = {}
            try:
                while True:
                    job = self._jobs.get()
                    if job is None:  # shutdown sentinel
                        break
                    url, proxy, timeout_ms, result_q = job
                    try:
                        key = proxy or "__direct__"
                        ctx = contexts.get(key)
                        if ctx is None:
                            ctx = browser.new_context(
                                proxy=_proxy_to_playwright_config(proxy),
                                user_agent=_PLAYWRIGHT_UA,
                                locale="es-ES",
                            )
                            # Cloudflare checks navigator.webdriver among other tells.
                            ctx.add_init_script(
                                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
                            )
                            contexts[key] = ctx
                        page = ctx.new_page()
                        try:
                            page.goto(url, timeout=timeout_ms, wait_until="load")
                            page.wait_for_timeout(1200)  # let the challenge/results script settle
                            html = page.content()
                        finally:
                            page.close()
                        result_q.put(("ok", html))
                    except Exception as exc:
                        result_q.put(("error", exc))
            finally:
                for ctx in contexts.values():
                    try:
                        ctx.close()
                    except Exception:
                        pass
                browser.close()

    def fetch(self, url: str, proxy: str | None, timeout_ms: int = 30000) -> str:
        self._ensure_started()
        result_q: "queue.Queue[tuple]" = queue.Queue(maxsize=1)
        self._jobs.put((url, proxy, timeout_ms, result_q))
        try:
            status, payload = result_q.get(timeout=(timeout_ms / 1000) + 15)
        except queue.Empty:
            raise TimeoutError("Playwright worker did not respond in time")
        if status == "error":
            raise payload
        return payload

    def shutdown(self) -> None:
        if self._thread is not None:
            self._jobs.put(None)
            self._thread.join(timeout=10)


_playwright_worker = _PlaywrightWorker()
atexit.register(_playwright_worker.shutdown)


def _fetch_html_playwright(url: str, proxy: str | None, timeout_ms: int = 30000) -> str:
    """Last-resort fetch via a real headless browser.

    curl_cffi only impersonates a browser's TLS/JA3 fingerprint — it cannot
    execute JavaScript, so it can never pass an actual Cloudflare challenge
    page. A real (headless) browser does, and the persistent context above
    means repeat searches on the same proxy skip re-solving it.
    """
    html = _playwright_worker.fetch(url, proxy, timeout_ms=timeout_ms)
    if _is_cloudflare_challenge(html):
        raise RuntimeError("Cloudflare challenge page (blocked, even via browser)")
    return html


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


_UMLAUT_RULES = (("ss", "ß"), ("ae", "ä"), ("oe", "ö"), ("ue", "ü"))


def _german_umlaut_variants(word: str) -> list[str]:
    """ASCII-transliteration fallback spellings: ss/ae/oe/ue -> ß/ä/ö/ü.

    Many people type German words without special characters (Strasse,
    Maedchen, koennen, fuer). Plain substring replacement is enough — these
    patterns essentially never appear except as the umlaut/eszett fallback.
    """
    variants: list[str] = []
    for pattern, repl in _UMLAUT_RULES:
        if pattern in word:
            candidate = word.replace(pattern, repl)
            if candidate != word and candidate not in variants:
                variants.append(candidate)
    if len(variants) > 1:
        combined = word
        for pattern, repl in _UMLAUT_RULES:
            combined = combined.replace(pattern, repl)
        if combined != word and combined not in variants:
            variants.append(combined)
    return variants


def lookup(word: str, lp: str = "esde", max_results: int = 3) -> dict:
    """Look up `word`, plus — for German ASCII-spelling variants (ss/ae/oe/ue
    vs ß/ä/ö/ü) — the alternate spellings as additional searches, merging
    whatever LEO finds (deduplicated by entry id).
    """
    queries = [word] + _german_umlaut_variants(word)
    merged_entries: list[dict] = []
    seen_aiids: set[str] = set()
    any_reached_leo = False
    last_exc: Exception | None = None
    lang_labels: dict | None = None

    for q in queries:
        try:
            result = _lookup_word(q, lp, max_results)
        except ValueError:
            any_reached_leo = True  # reached LEO fine, just no match for this spelling
            continue
        except LeoLookupError as exc:
            last_exc = exc
            continue
        any_reached_leo = True
        lang_labels = result["lang_labels"]
        for entry in result["entries"]:
            if entry["aiid"] not in seen_aiids:
                seen_aiids.add(entry["aiid"])
                merged_entries.append(entry)
        if len(merged_entries) >= max_results:
            break

    if not any_reached_leo:
        raise LeoLookupError(
            f"LEO unreachable for {word!r} and its spelling variants: {last_exc}"
        ) from last_exc

    if not merged_entries:
        # Every reachable query came back empty — genuinely not found.
        raise ValueError("No entries found for word or its spelling variants.")

    _, default_labels = LANG_PAIRS[lp]
    entries = merged_entries[:max_results]
    return {
        "word": word,
        "lang_pair": lp,
        "total_results": len(entries),
        "lang_labels": lang_labels or default_labels,
        "entries": entries,
    }


def _lookup_word(word: str, lp: str, max_results: int) -> dict:
    """Fetch LEO entries for one exact spelling, failing over proxies, direct
    access, and finally a real headless browser, before surfacing an access
    error.

    Getting *through* to LEO (a real, non-challenge page) and getting a
    *match* are separate questions:
    - Network errors, HTTP errors, and Cloudflare challenge pages mean this
      candidate is blocked — try the next one, escalating from the fast
      curl_cffi tier to a headless browser only once that tier is exhausted,
      then give up with an access error (LeoLookupError).
    - Once a real LEO page comes through, a missing results block means the
      word genuinely isn't in the dictionary — that's a ValueError, raised
      immediately (no point retrying other candidates for LEO's own answer),
      which the router turns into a 404 "not found," not an access error.
    """
    path, _ = LANG_PAIRS[lp]
    encoded = urllib.parse.quote(word, safe="")
    url = f"https://dict.leo.org/{path}/{encoded}"
    _, lang_labels = LANG_PAIRS[lp]
    last_exc: Exception | None = None
    attempts = 0

    def finish(html: str, proxy: str | None) -> dict:
        # ValueError from a missing results block propagates out of finish()
        # (and lookup()) as-is — "not found," not a retry.
        xml_str = _extract_xml(html)
        entries = _parse_entries(xml_str, max_results)
        if proxy:
            try:
                set_leo_last_working_proxy(proxy)
            except Exception:
                # A successful lookup must not become a client-visible
                # failure merely because the preference could not be saved.
                logger.exception("Unable to persist the successful LEO proxy")
        return {
            "word": word,
            "lang_pair": lp,
            "total_results": len(entries),
            "lang_labels": lang_labels,
            "entries": entries,
        }

    # Tier 1 — fast TLS-impersonation fetch, rotating through proxies + direct.
    # Skipped entirely while on cooldown from a recent full block, so lookups
    # go straight to the (slower but working) browser tier instead of paying
    # for doomed attempts every time.
    if _is_fast_tier_down():
        logger.info(
            "LEO: fast tier on cooldown until %s, skipping straight to headless browser",
            get_leo_fast_tier_down_until(),
        )
    else:
        candidates = list(_proxy_candidates())
        if None not in candidates:
            candidates.append(None)  # always try direct access too, at least once

        while candidates:
            proxy = candidates.pop(0)
            attempts += 1
            try:
                html = _fetch_html(url, proxy)
            except Exception as exc:  # candidate blocked — try the next one
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
                    if None not in candidates:
                        candidates.append(None)
                continue
            _clear_fast_tier_down()
            return finish(html, proxy)

        # Every fast candidate was blocked — pause this tier for a while
        # instead of re-testing it (and paying its full cost) on every lookup.
        _mark_fast_tier_down()

    # Tier 2 — the fast tier is blocked or on cooldown. A real headless browser
    # executes Cloudflare's JS challenge, which curl_cffi's fingerprint
    # impersonation alone cannot solve. Expensive, so only a few candidates.
    for proxy in _playwright_candidates():
        attempts += 1
        try:
            html = _fetch_html_playwright(url, proxy)
        except Exception as exc:
            last_exc = exc
            continue
        return finish(html, proxy)

    raise LeoLookupError(
        f"LEO unreachable after {attempts} attempts (direct + proxies + browser): {last_exc}"
    ) from last_exc
