"""
leo_service.py — LEO Dictionary lookup (Alemán ↔ Español/Inglés/etc.)

Ported from test/leo_lookup.py — only the lookup logic, no HTML generation.
"""

import re
import urllib.parse
import urllib.request
from xml.etree import ElementTree as ET

AUDIO_BASE = "https://dict.leo.org/media/audio/{file_id}.mp3"

LANG_PAIRS = {
    "esde": ("alem%C3%A1n-espa%C3%B1ol", {"es": "Español", "de": "Alemán"}),
    "ende": ("englisch-deutsch",           {"en": "Inglés",  "de": "Alemán"}),
    "frde": ("franz%C3%B6sisch-deutsch",   {"fr": "Francés", "de": "Alemán"}),
    "itde": ("italienisch-deutsch",        {"it": "Italiano","de": "Alemán"}),
    "ptde": ("portugiesisch-deutsch",      {"pt": "Portugués","de":"Alemán"}),
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9",
}


def _fetch_html(word: str, lp: str) -> str:
    path, _ = LANG_PAIRS[lp]
    encoded = urllib.parse.quote(word, safe="")
    url = f"https://dict.leo.org/{path}/{encoded}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


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
    """Fetch up to max_results entries from LEO for the given word."""
    html = _fetch_html(word, lp)
    xml_str = _extract_xml(html)
    entries = _parse_entries(xml_str, max_results)
    _, lang_labels = LANG_PAIRS[lp]
    return {
        "word":          word,
        "lang_pair":     lp,
        "total_results": len(entries),
        "lang_labels":   lang_labels,
        "entries":       entries,
    }
