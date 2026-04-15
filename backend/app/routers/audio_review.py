"""
audio_review.py — Generate review audio from stored word MP3 files.
Downloads individual word+translation MP3s and concatenates them with ffmpeg.
Generates a .srt subtitle file synchronized with the MP3.

Key design notes:
- ffmpeg runs via asyncio.create_subprocess_exec (non-blocking)
- Downloads run in a thread-pool executor (non-blocking)
- TTS fallback via gTTS when a clip URL is missing and use_tts=True
- order='both' produces: [A→B, gap, B→A, gap] per word
- SRT entries are generated per-clip using cumulative timing
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
from datetime import datetime
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
from ..models.word_translation import WordTranslation
from ..services.auth import decode_token
from ..services.ollama_service import translate as ollama_translate

# ── Logger ────────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)

# ── Storage ───────────────────────────────────────────────────────────────────
_DATA_DIR = Path(os.environ.get("VOCABOX_DATA_DIR", str(Path(__file__).parent.parent.parent)))
AUDIO_DIR = _DATA_DIR / "audio_reviews"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ── In-memory job store ───────────────────────────────────────────────────────
_jobs: Dict[str, dict] = {}

# ── TTS filter file paths ─────────────────────────────────────────────────────
_TTS_FILTERS_DIR = _DATA_DIR / "tts_filters"

_BASE_FILTER_CONTENT = """\
# TTS text filters — one regex per line, # for comments, blank lines ignored.
# These patterns are stripped from text before speech synthesis.
# VERSION: 2

# Pipe separator (LEO-style alternates: "laufen | rennen")
\\s*\\|\\s*

# Abbreviations: short words (1-5 chars) followed by a period, then space or end-of-string.
# Matches: Pl., Sg., Adj., Konj., Nom., Gen., Dat., Akk., Inf., etw., jdn., adv., n., v., etc.
# Does NOT match full words like "Sprechblase." at end of sentence (too long or not followed by space).
\\b\\w{1,5}\\.(?=\\s|$)

# Text in parentheses, brackets, braces
\\(.*?\\)
\\[.*?\\]
\\{.*?\\}

# Dash + qualifier (e.g. "- indefinido", "- weak")
\\s*[-–]\\s+\\w+

# Trailing commas, semicolons
[,;]\\s*$
"""

# Version marker extracted from content — used to auto-update stale base files.
_BASE_FILTER_VERSION = next(
    (l.split("VERSION:")[-1].strip() for l in _BASE_FILTER_CONTENT.splitlines() if "VERSION:" in l),
    "1",
)

router = APIRouter(prefix="/audio-review", tags=["audio-review"])


def _user_dir(user_id: int) -> Path:
    d = AUDIO_DIR / str(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _build_output_name(words_data: List[dict], order: str, extra_languages: List[str], jid: str) -> str:
    """Build a human-readable MP3 filename: DE_to_ES_EN_20260415_1430_ab12.mp3"""
    if words_data:
        la = words_data[0]["idioma_origen"][:2].upper()
        lb = words_data[0]["idioma_destino"][:2].upper()
    else:
        la, lb = "XX", "XX"

    if order == "word_first":
        lang_part = f"{la}_to_{lb}"
    elif order == "translation_first":
        lang_part = f"{lb}_to_{la}"
    else:  # both
        lang_part = f"{la}_{lb}_both"

    if extra_languages:
        extras_part = "_" + "_".join(l[:2].upper() for l in extra_languages)
    else:
        extras_part = ""

    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return f"{lang_part}{extras_part}_{ts}_{jid[:4]}.mp3"


# ── TTS filter helpers ────────────────────────────────────────────────────────

import re as _re

def _get_tts_filter_path(user_id: int, lang: str) -> tuple[Path, bool]:
    """Return (path, is_user_override). User file takes precedence over base."""
    user_file = _TTS_FILTERS_DIR / "users" / str(user_id) / f"{lang}.txt"
    if user_file.exists():
        return user_file, True
    base_file = _TTS_FILTERS_DIR / "base" / f"{lang}.txt"
    return base_file, False


def _ensure_base_filter_file(lang: str) -> None:
    """Create or update the base filter file for lang.
    If the file exists but has an older VERSION marker, overwrite it.
    User override files are never touched here.
    """
    base_file = _TTS_FILTERS_DIR / "base" / f"{lang}.txt"
    base_file.parent.mkdir(parents=True, exist_ok=True)
    if base_file.exists():
        existing = base_file.read_text(encoding="utf-8")
        existing_ver = next(
            (l.split("VERSION:")[-1].strip() for l in existing.splitlines() if "VERSION:" in l),
            "1",
        )
        if existing_ver == _BASE_FILTER_VERSION:
            return  # already up to date
    base_file.write_text(_BASE_FILTER_CONTENT, encoding="utf-8")


def _load_tts_filters(user_id: int, lang: str) -> list:
    """Load and compile regex patterns for given lang. Returns list[re.Pattern]."""
    _ensure_base_filter_file(lang)
    path, _ = _get_tts_filter_path(user_id, lang)
    if not path.exists():
        return []
    patterns = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            patterns.append(_re.compile(line, _re.IGNORECASE))
        except _re.error as exc:
            logger.warning("TTS filter invalid regex %r: %s", line, exc)
    return patterns


def _apply_tts_filters(text: str, patterns: list) -> str:
    """Apply compiled regex patterns to text, stripping matches."""
    for p in patterns:
        text = p.sub("", text)
    # Collapse multiple spaces
    return _re.sub(r"\s{2,}", " ", text).strip()


def _get_missing_tts_text(current_text: str, recorded_text: Optional[str], patterns: list) -> str:
    """
    Return tokens from current_text (after filtering) that are NOT in recorded_text (after filtering).
    Used to detect text that needs a TTS complement appended to the existing MP3.
    Returns empty string if nothing is missing or recorded_text is absent.
    """
    if not recorded_text:
        return ""
    filtered_current = _apply_tts_filters(current_text, patterns)
    filtered_recorded = _apply_tts_filters(recorded_text, patterns)

    def _tokenize(s: str) -> list[str]:
        # Lowercase, strip punctuation, split on whitespace
        s = _re.sub(r"[^\w\s]", "", s.lower())
        return [t for t in s.split() if t]

    tokens_current = _tokenize(filtered_current)
    tokens_recorded = set(_tokenize(filtered_recorded))

    missing = [t for t in tokens_current if t not in tokens_recorded]
    # Return them in original text order, joined
    return " ".join(missing)


# ── Schema ────────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    word_ids: List[int]
    order: str = "word_first"      # "word_first" | "translation_first" | "both"
    gap_seconds: float = 2.0
    beep: bool = False
    use_tts: bool = False          # use TTS for missing clips + append TTS-only words
    include_tts_words: bool = False  # append words that have NO mp3 at all (TTS only)
    # TTS voice preferences: {lang_code: voice_name}, e.g. {"de": "Anna", "es": "Monica"}
    tts_voices: dict[str, str] = {}
    tts_rate: float = 1.0          # speech rate multiplier (0.5 = slow, 1.0 = normal, 1.5 = fast)
    # Extra languages to include after each word pair (uses word_translations table)
    extra_languages: List[str] = []   # e.g. ["en", "fr"]
    # Ollama model for auto-translating missing extra-language entries (empty = disabled)
    ollama_model: str = ""
    # Complete existing MP3 with TTS for text not covered by audio_text
    complete_with_tts: bool = True


# ── SRT helpers ───────────────────────────────────────────────────────────────

def _srt_time(seconds: float) -> str:
    """Format seconds as SRT timestamp: HH:MM:SS,mmm"""
    ms = int(round(seconds * 1000))
    h = ms // 3_600_000;  ms %= 3_600_000
    m = ms // 60_000;     ms %= 60_000
    s = ms // 1_000;      ms %= 1_000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _write_srt(entries: list[dict], path: str) -> None:
    """Write SRT file from list of {index, start, end, text, lang?}.
    Lang is embedded as a metadata comment line after the text:
      [lang:de]
    This lets the frontend parse language per entry for color coding.
    """
    lines = []
    for e in entries:
        lines.append(str(e["index"]))
        lines.append(f"{_srt_time(e['start'])} --> {_srt_time(e['end'])}")
        lines.append(e["text"])
        if e.get("lang"):
            lines.append(f"[lang:{e['lang']}]")
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate")
async def start_generation(
    req: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info(
        "Audio review request — user=%d, words=%d, order=%s, gap=%.1fs, beep=%s, tts=%s",
        current_user.id, len(req.word_ids), req.order, req.gap_seconds, req.beep, req.use_tts,
    )

    if not req.word_ids:
        raise HTTPException(status_code=400, detail="No words selected")

    owned = {
        row.word_id
        for row in db.query(UserWord.word_id)
        .filter(UserWord.user_id == current_user.id)
        .all()
    }

    words_data: List[dict] = []
    for wid in req.word_ids:
        if wid not in owned:
            continue
        w = db.query(Word).filter(Word.id == wid).first()
        if not w:
            continue

        has_word_audio = bool(w.audio_url)
        has_trans_audio = bool(w.audio_url_translation)

        # Include if: both mp3s exist, OR tts can fill in the gaps
        def _base_entry(word_obj, tts_a=False, tts_b=False) -> dict:
            # Load extra translations from DB for the requested languages
            extras = []
            if req.extra_languages:
                trs = (
                    db.query(WordTranslation)
                    .filter(
                        WordTranslation.word_id == word_obj.id,
                        WordTranslation.idioma.in_(req.extra_languages),
                    )
                    .all()
                )
                tr_map = {t.idioma: t for t in trs}
                for lang in req.extra_languages:
                    tr = tr_map.get(lang)
                    extras.append({
                        "idioma": lang,
                        "texto": tr.texto if tr else None,
                        "audio_url": tr.audio_url if tr else None,
                        "audio_text": tr.audio_text if tr else None,
                        "exists_in_db": tr is not None,
                    })
            return {
                "id": word_obj.id,
                "palabra": word_obj.palabra,
                "significado": word_obj.significado,
                "idioma_origen": word_obj.idioma_origen,
                "idioma_destino": word_obj.idioma_destino,
                "audio_url": word_obj.audio_url,
                "audio_url_translation": word_obj.audio_url_translation,
                "audio_text": word_obj.audio_text,
                "audio_text_translation": word_obj.audio_text_translation,
                "tts_fallback_a": tts_a,
                "tts_fallback_b": tts_b,
                "extras": extras,
            }

        if has_word_audio and has_trans_audio:
            words_data.append(_base_entry(w))
        elif req.use_tts:
            if has_word_audio and not has_trans_audio:
                words_data.append(_base_entry(w, tts_b=True))
            elif not has_word_audio and has_trans_audio:
                words_data.append(_base_entry(w, tts_a=True))
            elif req.include_tts_words:
                words_data.append(_base_entry(w, tts_a=True, tts_b=True))

    if not words_data:
        raise HTTPException(status_code=400, detail="No words with audio found in selection")

    job_id = str(uuid.uuid4())
    _total = len(words_data) * 2 if req.order == "both" else len(words_data)
    _jobs[job_id] = {
        "status": "pending",
        "progress": 0,
        "total": _total,
        "filename": None,
        "srt_filename": None,
        "error": None,
        "user_id": current_user.id,
    }

    asyncio.create_task(
        _run_generation(
            job_id, words_data, req.order, req.gap_seconds, req.beep, req.use_tts,
            current_user.id, req.tts_voices, req.tts_rate,
            req.extra_languages, req.ollama_model, req.complete_with_tts,
        )
    )
    return {"job_id": job_id, "total": _total}


# ── Background generation ─────────────────────────────────────────────────────

def _persist_ollama_translations(word_id: int, extras: list) -> None:
    """Save Ollama-generated translations to word_translations table (sync, best-effort)."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        for ex in extras:
            existing = (
                db.query(WordTranslation)
                .filter(WordTranslation.word_id == word_id, WordTranslation.idioma == ex["idioma"])
                .first()
            )
            if existing:
                existing.texto = ex["texto"]
                existing.source = "ollama"
            else:
                db.add(WordTranslation(
                    word_id=word_id,
                    idioma=ex["idioma"],
                    texto=ex["texto"],
                    audio_url=None,
                    audio_text=None,
                    source="ollama",
                ))
        db.commit()
    except Exception as exc:
        logger.warning("Failed to persist Ollama translations for word %d: %s", word_id, exc)
    finally:
        db.close()


async def _run_ffmpeg(*args: str, label: str = "ffmpeg") -> None:
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
        raise RuntimeError(f"ffmpeg exit {proc.returncode}: {err_text[-400:]}")


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



# ── TTS voice mapping (macOS `say` command) ───────────────────────────────────
# Maps language prefix → macOS voice name.
# Run `say -v '?'` to see all installed voices.
# Default voice per language (used when user hasn't configured a preference)
_MACOS_VOICE_DEFAULTS: dict[str, str] = {
    "de": "Anna",
    "en": "Daniel",
    "es": "Monica",
    "fr": "Amelie",
    "it": "Alice",
    "pt": "Luciana",
    "ja": "Kyoko",
    "zh": "Ting-Ting",
    "ko": "Yuna",
    "ru": "Milena",
    "nl": "Xander",
    "pl": "Zosia",
    "sv": "Alva",
    "tr": "Yelda",
    "ar": "Maged",
}

# Keep alias for backwards compat
_MACOS_VOICE_MAP = _MACOS_VOICE_DEFAULTS


# ── Voice discovery ────────────────────────────────────────────────────────────

def _list_macos_voices() -> list[dict]:
    """Return list of {name, lang_code} for all installed macOS voices."""
    import re
    # Format: "Alice (Enhanced)    it_IT    # Ciao!..."
    # The locale is always a xx_XX pattern preceded by spaces.
    _LINE_RE = re.compile(r"^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s")
    try:
        result = subprocess.run(
            ["say", "-v", "?"],
            capture_output=True, text=True, timeout=10,
        )
        voices = []
        for line in result.stdout.splitlines():
            m = _LINE_RE.match(line)
            if not m:
                continue
            name = m.group(1).strip()
            locale = m.group(2)
            lang_code = locale.split("_")[0].lower()
            voices.append({"name": name, "lang_code": lang_code, "locale": locale})
        return voices
    except Exception:
        return []


def _list_sapi_voices() -> list[dict]:
    """Return list of {name, lang_code} for Windows SAPI voices."""
    try:
        script = (
            "import pyttsx3; e = pyttsx3.init(); "
            "voices = e.getProperty('voices'); "
            "[print(f\"{v.name}|{v.languages}\") for v in voices]"
        )
        result = subprocess.run(
            ["python", "-c", script],
            capture_output=True, text=True, timeout=15,
        )
        voices = []
        for line in result.stdout.splitlines():
            if "|" not in line:
                continue
            name, langs_raw = line.split("|", 1)
            # langs_raw is something like "['en_US']" or "[]"
            import re
            codes = re.findall(r"'([a-z]{2})[_-]", langs_raw)
            lang_code = codes[0] if codes else "en"
            voices.append({"name": name.strip(), "lang_code": lang_code, "locale": lang_code})
        return voices
    except Exception:
        return []


def _list_espeak_voices() -> list[dict]:
    """Return list of {name, lang_code} for espeak-ng (Linux)."""
    try:
        result = subprocess.run(
            ["espeak-ng", "--voices"],
            capture_output=True, text=True, timeout=10,
        )
        voices = []
        for line in result.stdout.splitlines()[1:]:  # skip header
            parts = line.split()
            if len(parts) < 4:
                continue
            lang_field = parts[1]  # e.g. "de", "en/en-us"
            lang_code = lang_field.split("/")[0].split("-")[0].lower()
            name = parts[3]
            voices.append({"name": name, "lang_code": lang_code, "locale": lang_field})
        return voices
    except Exception:
        return []


def _get_tts_voices() -> tuple[str, list[dict]]:
    """Detect platform and return (platform, voices_list)."""
    import platform
    system = platform.system()
    if system == "Darwin":
        return "macos", _list_macos_voices()
    elif system == "Windows":
        return "windows", _list_sapi_voices()
    else:
        return "linux", _list_espeak_voices()


# ── Sample sentences per language (for voice preview) ─────────────────────────
_PREVIEW_TEXTS: dict[str, str] = {
    "de": "Guten Tag, wie geht es Ihnen?",
    "en": "Hello, how are you today?",
    "es": "Hola, ¿cómo estás hoy?",
    "fr": "Bonjour, comment allez-vous?",
    "it": "Ciao, come stai oggi?",
    "pt": "Olá, como vai você hoje?",
    "ja": "こんにちは、お元気ですか？",
    "zh": "你好，你今天好吗？",
    "ko": "안녕하세요, 오늘 어떠세요?",
    "ru": "Привет, как дела сегодня?",
    "nl": "Hallo, hoe gaat het vandaag?",
    "pl": "Cześć, jak się masz dzisiaj?",
    "sv": "Hej, hur mår du idag?",
    "tr": "Merhaba, bugün nasılsın?",
    "ar": "مرحباً، كيف حالك اليوم؟",
}


def _tts_macos(text: str, lang: str, dest: str, voice: Optional[str] = None, rate: float = 1.0) -> None:
    """Generate TTS using macOS `say` command → AIFF → MP3 via ffmpeg."""
    lang_code = lang[:2].lower()
    chosen_voice = voice or _MACOS_VOICE_DEFAULTS.get(lang_code, "Daniel")

    with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tmp_aiff:
        aiff_path = tmp_aiff.name

    try:
        cmd = ["say", "-v", chosen_voice, "-o", aiff_path]
        # macOS `say` uses --rate in words-per-minute (default ~180)
        # rate=1.0 → 180 wpm, rate=0.5 → 90 wpm, rate=1.5 → 270 wpm
        if rate != 1.0:
            wpm = max(50, min(500, int(180 * rate)))
            cmd += ["--rate", str(wpm)]
        cmd.append(text)

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(f"say failed (exit {result.returncode}): {result.stderr.strip()}")

        if not os.path.exists(aiff_path) or os.path.getsize(aiff_path) == 0:
            raise RuntimeError(f"say produced empty file for {chosen_voice!r}: {text!r}")

        result2 = subprocess.run(
            ["ffmpeg", "-y", "-i", aiff_path, "-ar", "44100", "-ac", "2", "-q:a", "4", dest],
            capture_output=True, text=True, timeout=30,
        )
        if result2.returncode != 0:
            raise RuntimeError(f"ffmpeg AIFF→MP3 failed: {result2.stderr[-300:]}")

        if not os.path.exists(dest) or os.path.getsize(dest) == 0:
            raise RuntimeError(f"ffmpeg produced empty MP3 for {text!r}")

        logger.info("TTS ok: voice=%s, rate=%.2f, text=%r → %s", chosen_voice, rate, text, dest)

    finally:
        try:
            os.unlink(aiff_path)
        except Exception:
            pass


def _tts_espeak(text: str, lang: str, dest: str, voice: Optional[str] = None, rate: float = 1.0) -> None:
    """Generate TTS using espeak-ng (Linux) → WAV → MP3 via ffmpeg."""
    lang_code = lang[:2].lower()
    chosen_voice = voice or lang_code
    # espeak-ng speed in words-per-minute (default 175)
    speed = max(50, min(500, int(175 * rate)))

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
        wav_path = tmp_wav.name

    try:
        result = subprocess.run(
            ["espeak-ng", "-v", chosen_voice, "-s", str(speed), "-w", wav_path, text],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"espeak-ng failed: {result.stderr.strip()}")
        if not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
            raise RuntimeError(f"espeak-ng produced empty file for {chosen_voice!r}: {text!r}")

        result2 = subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-ar", "44100", "-ac", "2", "-q:a", "4", dest],
            capture_output=True, text=True, timeout=30,
        )
        if result2.returncode != 0:
            raise RuntimeError(f"ffmpeg WAV→MP3 failed: {result2.stderr[-300:]}")
        if not os.path.exists(dest) or os.path.getsize(dest) == 0:
            raise RuntimeError(f"ffmpeg produced empty MP3 for {text!r}")
    finally:
        try:
            os.unlink(wav_path)
        except Exception:
            pass


def _tts_to_file(
    text: str,
    lang: str,
    dest: str,
    voice: Optional[str] = None,
    rate: float = 1.0,
) -> None:
    """Generate TTS mp3. Dispatches by platform."""
    import platform
    system = platform.system()
    if system == "Darwin":
        _tts_macos(text, lang, dest, voice=voice, rate=rate)
    elif system == "Linux":
        _tts_espeak(text, lang, dest, voice=voice, rate=rate)
    else:
        # Windows / fallback: try gTTS
        try:
            from gtts import gTTS
            tts = gTTS(text=text, lang=lang[:2], slow=(rate < 0.8))
            tts.save(dest)
            if not os.path.exists(dest) or os.path.getsize(dest) == 0:
                raise RuntimeError("gTTS produced empty file")
        except ImportError:
            raise RuntimeError(
                "No TTS engine available. On Windows install pyttsx3 or gTTS."
            )


def _get_clip_duration_sync(path: str) -> float:
    """Return duration in seconds using ffprobe (sync)."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
            capture_output=True, text=True, timeout=10,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return 0.0


async def _get_clip_duration(path: str, loop: asyncio.AbstractEventLoop) -> float:
    return await loop.run_in_executor(None, _get_clip_duration_sync, path)


async def _ensure_clip(
    url: Optional[str],
    text: str,
    lang: str,
    dest: str,
    use_tts: bool,
    is_tts_fallback: bool,
    tmp_path: Path,
    loop: asyncio.AbstractEventLoop,
    jid: str,
    label: str,
    tts_voices: Optional[dict] = None,
    tts_rate: float = 1.0,
    audio_text: Optional[str] = None,
    tts_filters: Optional[list] = None,
) -> None:
    """Download URL or generate TTS into dest (.mp3).

    If use_tts=True and the clip has an existing audio_url, also checks whether
    the current text has tokens not covered by audio_text (the original recorded text).
    If there are missing tokens, generates a TTS complement and appends it.
    """
    filters = tts_filters or []
    lang_code = lang[:2].lower()
    voice = (tts_voices or {}).get(lang_code)

    if url and not is_tts_fallback:
        await loop.run_in_executor(None, _download_file, url, dest)
        # Complement: append TTS for any text not covered by the original recording
        if use_tts and audio_text:
            missing = _get_missing_tts_text(text, audio_text, filters)
            if missing:
                logger.info("[%s]   complement %s: missing tokens %r → TTS", jid, label, missing)
                dest_base = dest + ".base.mp3"
                dest_comp = dest + ".comp.mp3"
                os.rename(dest, dest_base)
                try:
                    filtered_missing = _apply_tts_filters(missing, filters)
                    if filtered_missing:
                        await loop.run_in_executor(None, _tts_to_file, filtered_missing, lang, dest_comp, voice, tts_rate)
                        comp_list = str(tmp_path / f"comp_{label}.txt")
                        with open(comp_list, "w") as f:
                            f.write(f"file '{dest_base}'\n")
                            f.write(f"file '{dest_comp}'\n")
                        await _run_ffmpeg(
                            "-f", "concat", "-safe", "0", "-i", comp_list,
                            "-c", "copy", dest,
                            label=f"{jid}/complement-{label}",
                        )
                    else:
                        os.rename(dest_base, dest)
                except Exception as exc:
                    logger.warning("[%s] complement TTS failed for %s: %s — using base only", jid, label, exc)
                    if os.path.exists(dest_base) and not os.path.exists(dest):
                        os.rename(dest_base, dest)
                finally:
                    for f in (dest_base, dest_comp):
                        try:
                            os.unlink(f)
                        except FileNotFoundError:
                            pass
    elif use_tts:
        tts_text = _apply_tts_filters(text, filters) or text
        logger.info("[%s]   TTS %s: %r voice=%s rate=%.2f → %s", jid, label, tts_text, voice, tts_rate, dest)
        try:
            await loop.run_in_executor(None, _tts_to_file, tts_text, lang, dest, voice, tts_rate)
        except Exception:
            # Fallback: generate silence via ffmpeg
            await _run_ffmpeg(
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-t", "1.0", dest,
                label=f"{jid}/tts-silence",
            )
    else:
        # Should not happen — generate silence
        await _run_ffmpeg(
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", "0.5", dest,
            label=f"{jid}/fallback-silence",
        )


async def _run_generation(
    job_id: str,
    words_data: List[dict],
    order: str,
    gap_seconds: float,
    beep: bool,
    use_tts: bool,
    user_id: int,
    tts_voices: Optional[dict] = None,
    tts_rate: float = 1.0,
    extra_languages: Optional[List[str]] = None,
    ollama_model: str = "",
    complete_with_tts: bool = True,
) -> None:
    jid = job_id[:8]
    out_dir = _user_dir(user_id)
    loop = asyncio.get_running_loop()
    _jobs[job_id]["status"] = "running"

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            # ── Load TTS filters for all involved languages ────────────────────
            langs_needed: set[str] = set()
            for w in words_data:
                langs_needed.add(w["idioma_origen"][:2].lower())
                langs_needed.add(w["idioma_destino"][:2].lower())
            for el in (extra_languages or []):
                langs_needed.add(el[:2].lower())
            tts_filter_map: dict[str, list] = {
                lang: _load_tts_filters(user_id, lang) for lang in langs_needed
            }

            # ── Shared clips ──────────────────────────────────────────────────
            gap_s = max(0.1, float(gap_seconds))
            silence_path = str(tmp_path / "silence.mp3")
            await _run_ffmpeg(
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-t", str(gap_s), silence_path,
                label=f"{jid}/silence",
            )
            silence_dur = await _get_clip_duration(silence_path, loop)

            beep_path: Optional[str] = None
            beep_dur: float = 0.0
            if beep:
                beep_path = str(tmp_path / "beep.mp3")
                await _run_ffmpeg(
                    "-f", "lavfi", "-i", "sine=frequency=880:duration=0.3",
                    "-ar", "44100", "-ac", "2", beep_path,
                    label=f"{jid}/beep",
                )
                beep_dur = await _get_clip_duration(beep_path, loop)

            # ── Build the list of (word, direction) items to process ─────────
            # For 'both': ALL words in direction 1 first, then ALL words in dir 2.
            # For single direction: one pass over all words.
            if order == "both":
                work_items = (
                    [(word, "word_first", i) for i, word in enumerate(words_data)] +
                    [(word, "translation_first", i) for i, word in enumerate(words_data)]
                )
            else:
                work_items = [(word, order, i) for i, word in enumerate(words_data)]

            # ── Per-segment loop + SRT entries ────────────────────────────────
            word_segments: List[str] = []
            srt_entries: list[dict] = []
            srt_index = 1
            cursor: float = 0.0  # current time position in seconds

            for seg_idx, (word, seg_order, word_idx) in enumerate(work_items):
                logger.info("[%s] [%d/%d] «%s» (%s)", jid, seg_idx + 1, len(work_items), word["palabra"], seg_order)

                if seg_order == "word_first":
                    first_role, second_role = "word", "trans"
                else:
                    first_role, second_role = "trans", "word"

                raw_a = str(tmp_path / f"seg{seg_idx}_a.mp3")
                raw_b = str(tmp_path / f"seg{seg_idx}_b.mp3")

                if first_role == "word":
                    text_a, lang_a = word["palabra"], word["idioma_origen"]
                    url_a, tts_a = word["audio_url"], word["tts_fallback_a"]
                    audio_text_a = word.get("audio_text")
                    text_b, lang_b = word["significado"], word["idioma_destino"]
                    url_b, tts_b = word["audio_url_translation"], word["tts_fallback_b"]
                    audio_text_b = word.get("audio_text_translation")
                else:
                    text_a, lang_a = word["significado"], word["idioma_destino"]
                    url_a, tts_a = word["audio_url_translation"], word["tts_fallback_b"]
                    audio_text_a = word.get("audio_text_translation")
                    text_b, lang_b = word["palabra"], word["idioma_origen"]
                    url_b, tts_b = word["audio_url"], word["tts_fallback_a"]
                    audio_text_b = word.get("audio_text")

                filters_a = tts_filter_map.get(lang_a[:2].lower(), [])
                filters_b = tts_filter_map.get(lang_b[:2].lower(), [])

                await _ensure_clip(url_a, text_a, lang_a, raw_a, use_tts, tts_a, tmp_path, loop, jid, "A", tts_voices, tts_rate, audio_text=audio_text_a if complete_with_tts else None, tts_filters=filters_a)
                await _ensure_clip(url_b, text_b, lang_b, raw_b, use_tts, tts_b, tmp_path, loop, jid, "B", tts_voices, tts_rate, audio_text=audio_text_b if complete_with_tts else None, tts_filters=filters_b)

                dur_a = await _get_clip_duration(raw_a, loop)
                dur_b = await _get_clip_duration(raw_b, loop)

                lang_a_code = word["idioma_origen"][:2] if first_role == "word" else word["idioma_destino"][:2]
                lang_b_code = word["idioma_destino"][:2] if first_role == "word" else word["idioma_origen"][:2]

                # ── Extra-language clips ──────────────────────────────────────
                extra_clip_paths: List[str] = []
                # List of (text, lang_code, dur) for SRT entries — filled after duration is known
                extra_srt_pending: list[tuple[str, str, float]] = []

                if extra_languages and seg_order == "word_first":
                    # Only inject extras on the word_first pass (avoid duplicates in "both")
                    for ex in word.get("extras", []):
                        ex_lang = ex["idioma"]
                        ex_text = ex.get("texto")

                        # If no translation exists and Ollama is configured → auto-translate
                        if not ex_text and ollama_model:
                            logger.info("[%s] Ollama translate %r → %s", jid, word["palabra"], ex_lang)
                            ex_text = await loop.run_in_executor(
                                None,
                                ollama_translate,
                                word["palabra"],
                                word["idioma_origen"][:2],
                                word["significado"],
                                word["idioma_destino"][:2],
                                ex_lang,
                                ollama_model,
                            )
                            if ex_text:
                                ex["texto"] = ex_text
                                ex["ollama_generated"] = True

                        if not ex_text:
                            continue

                        ex_clip = str(tmp_path / f"seg{seg_idx}_ex_{ex_lang}.mp3")
                        ex_url = ex.get("audio_url")
                        use_ex_tts = not bool(ex_url)
                        await _ensure_clip(
                            ex_url, ex_text, ex_lang, ex_clip,
                            use_tts=True,
                            is_tts_fallback=use_ex_tts,
                            tmp_path=tmp_path, loop=loop, jid=jid,
                            label=f"extra-{ex_lang}",
                            tts_voices=tts_voices, tts_rate=tts_rate,
                            tts_filters=tts_filter_map.get(ex_lang[:2].lower(), []),
                        )
                        dur_ex = await _get_clip_duration(ex_clip, loop)
                        extra_clip_paths.append(ex_clip)
                        extra_srt_pending.append((ex_text, ex_lang, dur_ex))

                # ── Build segment file (A + optional beep + B + extras + silence) ──
                mini_list_path = str(tmp_path / f"seg{seg_idx}_list.txt")
                with open(mini_list_path, "w") as f:
                    f.write(f"file '{raw_a}'\n")
                    if beep and beep_path:
                        f.write(f"file '{beep_path}'\n")
                    f.write(f"file '{raw_b}'\n")
                    for ex_clip in extra_clip_paths:
                        f.write(f"file '{ex_clip}'\n")
                    f.write(f"file '{silence_path}'\n")

                seg_path = str(tmp_path / f"seg_{seg_idx:05d}.mp3")
                await _run_ffmpeg(
                    "-f", "concat", "-safe", "0",
                    "-i", mini_list_path,
                    "-ar", "44100", "-ac", "2",
                    seg_path,
                    label=f"{jid}/seg{seg_idx}",
                )
                word_segments.append(seg_path)

                # ── Measure real seg duration → use as ground truth for cursor ──
                # This eliminates cumulative drift from ffmpeg concat operations.
                dur_seg_real = await _get_clip_duration(seg_path, loop)
                # Individual clip durations are still used for relative SRT offsets
                # within the segment. If real seg duration differs, the last entry
                # (silence) absorbs the delta — subtitles remain accurate.

                # ── SRT entries (using cursor + relative offsets within seg) ──
                rel = 0.0
                srt_entries.append({
                    "index": srt_index, "start": cursor + rel,
                    "end": cursor + rel + dur_a,
                    "text": text_a, "lang": lang_a_code,
                })
                srt_index += 1
                rel += dur_a
                if beep and beep_path:
                    rel += beep_dur

                srt_entries.append({
                    "index": srt_index, "start": cursor + rel,
                    "end": cursor + rel + dur_b,
                    "text": text_b, "lang": lang_b_code,
                })
                srt_index += 1
                rel += dur_b

                for ex_text_entry, ex_lang_code, dur_ex in extra_srt_pending:
                    srt_entries.append({
                        "index": srt_index, "start": cursor + rel,
                        "end": cursor + rel + dur_ex,
                        "text": ex_text_entry, "lang": ex_lang_code,
                    })
                    srt_index += 1
                    rel += dur_ex

                # Advance cursor by real measured duration of the full segment
                cursor += dur_seg_real if dur_seg_real > 0 else (rel + silence_dur)

                # Update progress: count segments processed (not unique words, to handle "both" mode)
                _jobs[job_id]["progress"] = seg_idx + 1

                # Persist Ollama-generated translations to DB (best-effort, sync)
                if ollama_model and word.get("extras"):
                    ollama_extras = [
                        e for e in word["extras"]
                        if e.get("ollama_generated") and e.get("texto")
                    ]
                    if ollama_extras:
                        await loop.run_in_executor(
                            None, _persist_ollama_translations, word["id"], ollama_extras
                        )

            # ── Final concat ──────────────────────────────────────────────────
            final_list_path = str(tmp_path / "final_list.txt")
            with open(final_list_path, "w") as f:
                for seg in word_segments:
                    f.write(f"file '{seg}'\n")

            out_name = _build_output_name(words_data, order, extra_languages or [], jid)
            srt_name = out_name.replace(".mp3", ".srt")
            out_path = str(out_dir / out_name)
            srt_path = str(out_dir / srt_name)

            await _run_ffmpeg(
                "-f", "concat", "-safe", "0",
                "-i", final_list_path,
                "-c", "copy",
                out_path,
                label=f"{jid}/final",
            )

            _write_srt(srt_entries, srt_path)
            logger.info("[%s] SRT written: %s (%d entries)", jid, srt_path, len(srt_entries))

            _jobs[job_id].update({
                "status": "done",
                "progress": _jobs[job_id]["total"],
                "filename": out_name,
                "srt_filename": srt_name,
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
            msg = {
                "status":       job.get("status"),
                "progress":     job.get("progress", 0),
                "total":        job.get("total", 0),
                "filename":     job.get("filename"),
                "srt_filename": job.get("srt_filename"),
                "error":        job.get("error"),
            }
            await websocket.send_json(msg)
            if msg["status"] in ("done", "error"):
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── File management ───────────────────────────────────────────────────────────

def _get_duration(path: Path) -> Optional[float]:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True, text=True, timeout=5,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None


# ── TTS filter endpoints ──────────────────────────────────────────────────────

class TtsFilterBody(BaseModel):
    content: str


@router.get("/tts-filters/{lang}")
def get_tts_filters(lang: str, current_user: User = Depends(get_current_user)):
    _ensure_base_filter_file(lang)
    path, is_user_override = _get_tts_filter_path(current_user.id, lang)
    content = path.read_text(encoding="utf-8") if path.exists() else ""
    return {"lang": lang, "content": content, "is_user_override": is_user_override}


@router.put("/tts-filters/{lang}")
def put_tts_filters(lang: str, body: TtsFilterBody, current_user: User = Depends(get_current_user)):
    user_dir = _TTS_FILTERS_DIR / "users" / str(current_user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / f"{lang}.txt").write_text(body.content, encoding="utf-8")
    return {"ok": True}


@router.delete("/tts-filters/{lang}", status_code=200)
def delete_tts_filters(lang: str, current_user: User = Depends(get_current_user)):
    user_file = _TTS_FILTERS_DIR / "users" / str(current_user.id) / f"{lang}.txt"
    if user_file.exists():
        user_file.unlink()
    return {"ok": True}


# ── Voice endpoints ───────────────────────────────────────────────────────────

@router.get("/voices")
def get_voices(
    current_user: User = Depends(get_current_user),
):
    """
    Return available TTS voices grouped by language (all languages, not filtered by user words).
    """
    platform_name, all_voices = _get_tts_voices()

    # Group all voices by lang_code
    by_lang: dict[str, list[dict]] = {}
    for v in all_voices:
        lc = v["lang_code"]
        by_lang.setdefault(lc, [])
        # Avoid duplicates by name
        if not any(x["name"] == v["name"] for x in by_lang[lc]):
            by_lang[lc].append({"name": v["name"], "locale": v["locale"]})

    # For each lang, mark the default voice
    result = {}
    for lc, voices in by_lang.items():
        default_voice = _MACOS_VOICE_DEFAULTS.get(lc) if platform_name == "macos" else (voices[0]["name"] if voices else None)
        result[lc] = {
            "voices": voices,
            "default": default_voice,
            "preview_text": _PREVIEW_TEXTS.get(lc, "Hello"),
        }

    return {"platform": platform_name, "languages": result}


@router.post("/voices/preview")
async def preview_voice(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    """
    Generate a short preview MP3 for a given voice + language.
    Body: {lang: str, voice: str, rate: float, text?: str}
    Returns: MP3 audio file.
    """
    lang = str(body.get("lang", "en"))[:10]
    voice = str(body.get("voice", "")) or None
    rate = float(body.get("rate", 1.0))
    rate = max(0.3, min(3.0, rate))
    text = str(body.get("text", "")) or _PREVIEW_TEXTS.get(lang[:2].lower(), "Hello")

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        dest = tmp.name

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _tts_to_file, text, lang, dest, voice, rate)
        return FileResponse(dest, media_type="audio/mpeg", filename="preview.mp3")
    except Exception as exc:
        if os.path.exists(dest):
            os.unlink(dest)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/list")
def list_audios(current_user: User = Depends(get_current_user)):
    d = _user_dir(current_user.id)
    files = []
    for f in sorted(d.glob("*.mp3"), key=lambda p: p.stat().st_mtime, reverse=True):
        s = f.stat()
        srt_path = f.with_suffix(".srt")
        files.append({
            "filename":         f.name,
            "size_kb":          round(s.st_size / 1024, 1),
            "created_at":       int(s.st_mtime),
            "duration_seconds": _get_duration(f),
            "has_srt":          srt_path.exists(),
            "srt_filename":     srt_path.name if srt_path.exists() else None,
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


@router.get("/srt/{filename}")
def get_srt_file(filename: str, current_user: User = Depends(get_current_user)):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not filename.endswith(".srt"):
        raise HTTPException(status_code=400, detail="Not an SRT file")
    f = _user_dir(current_user.id) / filename
    if not f.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(f), media_type="text/plain", filename=filename)


@router.delete("/file/{filename}", status_code=204)
def delete_audio_file(filename: str, current_user: User = Depends(get_current_user)):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    f = _user_dir(current_user.id) / filename
    if not f.exists():
        raise HTTPException(status_code=404, detail="Not found")
    f.unlink()
    # Also delete associated SRT if exists
    srt = f.with_suffix(".srt")
    if srt.exists():
        srt.unlink()
    logger.info("Deleted audio: %s (user=%d)", filename, current_user.id)
