"""
verbformen_service.py — Scrape verbformen.de for German verb info.

Returns lemma, conjugation triplet (presente - praeteritum - perfekt),
mp3 audio URL of infinitive, and example sentences (rLst rLstGt blocks).

No external deps — stdlib only (urllib + re).
"""

from __future__ import annotations

import re
import urllib.parse
import urllib.request
from typing import List, Optional, TypedDict

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
}

_INFINITIVE_MP3_RE = re.compile(
    r'href="(https://www\.verbformen\.de/konjugation/infinitiv/[^"]+\.mp3)"'
)
_STAMMFORMEN_RE = re.compile(
    r"Die Stammformen von „([^“]+)“ sind „([^“]+)“, „([^“]+)“ und „([^“]+)“"
)
_GRUNDFORM_RE = re.compile(
    r'id="grundform"[^>]*><b>([^<]*(?:<i>[^<]*</i>)?[^<]*)</b>'
)
_EXAMPLES_BLOCK_RE = re.compile(
    r'<ul class="[^"]*rLstGt[^"]*">(.*?)</ul>', re.DOTALL
)
_LI_RE = re.compile(r"<li[^>]*>(.*?)</li>", re.DOTALL)
_SATZAPP_RE = re.compile(
    r'<a class="rInf"[^>]*satzapp[^>]*>.*?</a>', re.DOTALL
)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


class VerbformenExample(TypedDict, total=False):
    texto: str
    traduccion: Optional[str]


class VerbformenResult(TypedDict, total=False):
    lemma: str
    palabra_formatted: str
    presente: str
    praeteritum: str
    perfekt: str
    audio_url: Optional[str]
    examples: List[str]
    examples_full: List[VerbformenExample]
    source_url: str


def _fetch_html(word: str) -> str:
    url = f"https://www.verbformen.de/?w={urllib.parse.quote(word, safe='')}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _clean_text(html_fragment: str) -> str:
    text = _SATZAPP_RE.sub("", html_fragment)
    text = _TAG_RE.sub("", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    text = _WS_RE.sub(" ", text).strip()
    text = text.strip(" .")
    return text.strip()


def _extract_lemma(html: str) -> Optional[str]:
    m = _GRUNDFORM_RE.search(html)
    if not m:
        return None
    return _clean_text(m.group(1))


def _extract_stammformen(html: str) -> Optional[tuple[str, str, str, str]]:
    m = _STAMMFORMEN_RE.search(html)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3), m.group(4)


def _extract_audio_url(html: str) -> Optional[str]:
    m = _INFINITIVE_MP3_RE.search(html)
    return m.group(1) if m else None


def _extract_examples(html: str, limit: int = 12) -> List[VerbformenExample]:
    by_texto: dict[str, VerbformenExample] = {}
    order: List[str] = []
    for block in _EXAMPLES_BLOCK_RE.findall(html):
        for li in _LI_RE.findall(block):
            parts = re.split(r"<br\s*/?>", li, maxsplit=1)
            texto = _clean_text(parts[0])
            traduccion = _clean_text(parts[1]) if len(parts) == 2 else None
            if not texto or len(texto) < 3:
                continue
            if texto not in by_texto:
                order.append(texto)
                by_texto[texto] = {"texto": texto, "traduccion": traduccion}
            elif traduccion and not by_texto[texto].get("traduccion"):
                by_texto[texto]["traduccion"] = traduccion
            if len(order) >= limit:
                break
        if len(order) >= limit:
            break
    return [by_texto[t] for t in order]


def lookup(word: str, example_limit: int = 12) -> VerbformenResult:
    """
    Look up a German verb on verbformen.de. Returns lemma, conjugation triplet,
    audio URL and example sentences. Raises ValueError on parse failure.
    """
    word = word.strip()
    if not word:
        raise ValueError("Empty word")

    html = _fetch_html(word)

    stamm = _extract_stammformen(html)
    lemma = _extract_lemma(html) or (stamm[0] if stamm else word)

    if not stamm:
        # Page exists but isn't a verb conjugation page
        raise ValueError(f"No conjugation data for '{word}'")

    _, presente, praeteritum, perfekt = stamm
    palabra_formatted = f"{lemma} | {presente} - {praeteritum} - {perfekt}"

    examples_full = _extract_examples(html, limit=example_limit)
    return VerbformenResult(
        lemma=lemma,
        palabra_formatted=palabra_formatted,
        presente=presente,
        praeteritum=praeteritum,
        perfekt=perfekt,
        audio_url=_extract_audio_url(html),
        examples=[e["texto"] for e in examples_full],
        examples_full=examples_full,
        source_url=f"https://www.verbformen.de/?w={urllib.parse.quote(word, safe='')}",
    )
