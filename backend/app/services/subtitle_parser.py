import re
from typing import NamedTuple


class Segment(NamedTuple):
    start_ms: int
    end_ms: int
    text: str


_TS_RE = re.compile(
    r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})"
)
_HTML_RE = re.compile(r"<[^>]+>")
_DIGITS_RE = re.compile(r"^\d+$")


def _time_to_ms(s: str) -> int:
    s = s.strip().replace(",", ".")
    parts = s.split(":")
    h = int(parts[0]) if len(parts) == 3 else 0
    m = int(parts[-2])
    sec_str, *ms_parts = parts[-1].split(".")
    ms_str = (ms_parts[0] if ms_parts else "0").ljust(3, "0")[:3]
    return h * 3_600_000 + m * 60_000 + int(sec_str) * 1_000 + int(ms_str)


def _clean(text: str) -> str:
    text = _HTML_RE.sub("", text)
    text = re.sub(r"<\d+:\d+:\d+\.\d+>", "", text)  # VTT inline timestamps
    return " ".join(text.split())


def parse_subtitle(content: str) -> list[Segment]:
    """Parse VTT or SRT content into a list of Segments."""
    segments: list[Segment] = []
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = _TS_RE.match(line)
        if m:
            start_ms = _time_to_ms(m.group(1))
            end_ms = _time_to_ms(m.group(2))
            parts: list[str] = []
            i += 1
            while i < len(lines):
                nl = lines[i].strip()
                if not nl or _TS_RE.match(nl):
                    break
                if _DIGITS_RE.match(nl):
                    i += 1
                    break
                parts.append(nl)
                i += 1
            text = _clean(" ".join(parts))
            if text and start_ms < end_ms:
                segments.append(Segment(start_ms=start_ms, end_ms=end_ms, text=text))
        else:
            i += 1
    return segments


def detect_youtube_id(filename: str) -> str | None:
    """Try to extract YouTube 11-char video ID from filename.
    Supports: 'My Video [dQw4w9WgXcQ].en.vtt'  →  'dQw4w9WgXcQ'
              'dQw4w9WgXcQ.vtt'                 →  'dQw4w9WgXcQ'
    """
    # Pattern: [ID] anywhere in name
    m = re.search(r"\[([A-Za-z0-9_-]{11})\]", filename)
    if m:
        return m.group(1)
    # Strip all extensions (.en.vtt, .srt, …)
    name = re.sub(r"(\.[a-z]{2})?(\.(vtt|srt|xml|srv\d?))$", "", filename, flags=re.IGNORECASE)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", name):
        return name
    return None
