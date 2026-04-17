"""
grammar_service.py — Ollama-powered German grammar exercise generation.

Generates fill-in-the-blank exercises with JSON segment format.
Response contract (exact structure the LLM must return):

{
  "title": "Im Café",
  "topic": "café and drinks",
  "segments": [
    {"t": "text", "v": "Ich bestelle "},
    {"t": "blank", "id": 1, "options": ["einen", "ein", "eine"], "correct": 0,
     "rule": "Akkusativ maskulin → einen"},
    {"t": "text", "v": " Kaffee."}
  ],
  "grammar_notes": ["Dativ vor Akkusativ: ..."],
  "vocabulary_used": ["Kaffee", "Kellner"]
}
"""

import json
import logging
import urllib.request
import urllib.error
from typing import Optional

from .ai_client import AIClient, OllamaClient

logger = logging.getLogger(__name__)

OLLAMA_BASE = "http://localhost:11434"

LANG_NAMES = {
    "de": "German", "es": "Spanish", "en": "English", "fr": "French",
    "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "ru": "Russian",
}

INTERFACE_LANG_NAMES = {
    "es": "Spanish", "en": "English", "de": "German", "fr": "French",
}

DEFAULT_PROMPT_GRAMMAR = """\
You are an expert German language teacher creating grammar exercises for learners.

Generate a fill-in-the-blank exercise in German on the topic: {topic}
Explanations and rules should be written in: {interface_lang}
Grammar focus areas to emphasize: {grammar_focus}
{vocabulary_line}

Return ONLY a valid JSON object — no markdown, no code blocks, no extra text. Use this exact structure:
{{
  "title": "Short descriptive title in German (3-6 words)",
  "topic": "{topic}",
  "segments": [
    {{"t": "text", "v": "German text before a blank"}},
    {{"t": "blank", "id": 1, "options": ["option1", "option2", "option3"], "correct": 0, "rule": "Brief grammar rule in {interface_lang}"}},
    {{"t": "text", "v": "German text after the blank"}}
  ],
  "grammar_notes": ["Grammar note 1 in {interface_lang}", "Grammar note 2"],
  "vocabulary_used": ["word1", "word2"]
}}

Segment rules:
- "t": "text" means literal German text. "v" is the text string.
- "t": "blank" means a fill-in-the-blank. "correct" is the 0-based index of the correct answer in "options".
- Each blank must have exactly 2-4 options (including the correct one). Shuffle them (correct is not always index 0).
- Create 6-12 blanks total across the exercise text.
- Make the text natural, coherent German prose or dialogue on the requested topic.
- "rule" field: short, clear explanation of the specific grammar rule in {interface_lang}.

Grammar areas to cover (include as many as possible):
- Declined articles: nominative/accusative/dative/genitive (der/die/das/den/dem/des/einem/einer...)
- Prepositions with fixed cases: mit+Dat, für+Akk, seit+Dat, wegen+Gen, trotz+Gen...
- Wechselpräpositionen (an/auf/in/über/unter/vor/hinter/neben/zwischen): Akk for direction, Dat for location
- Verb-preposition pairs: warten auf+Akk, denken an+Akk, fragen nach+Dat, sich freuen auf+Akk...
- Adjective endings (strong/weak/mixed declension)
- Hauptsatz word order: Subject-Verb-Object, Time-Manner-Place
- Nebensatz: subordinate clause with verb at end, after: weil, dass, wenn, obwohl, damit...
- Dativ vor Akkusativ rule (indirect object before direct when both are nouns)
- Common verbs with specific cases: helfen+Dat, danken+Dat, gefallen+Dat, kaufen+Akk...
"""

PROMPT_SUGGEST_TOPICS = """\
You are a German language teacher. Suggest 7 varied topics for German grammar exercises suitable for intermediate learners (A2-B2 level).

Return ONLY a valid JSON array of strings in {interface_lang}. No markdown, no extra text. Example:
["Im Restaurant", "Eine Reise planen", "Beim Arzt", "Die Wohnung beschreiben"]

Make them practical, everyday topics that naturally require using articles, prepositions, and different grammatical cases.
"""


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _call_ollama(prompt: str, model: str, timeout: int, num_predict: int = 2000) -> str | None:
    """Send a prompt to Ollama /api/generate, return raw response string."""
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.4,
            "top_p": 0.9,
            "num_predict": num_predict,
        },
    }).encode()

    try:
        req = urllib.request.Request(
            f"{OLLAMA_BASE}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            return data.get("response", "").strip()
    except Exception as exc:
        logger.warning("Ollama grammar call failed: %s", exc)
        return None


def _extract_json(text: str) -> str:
    """Extract JSON object/array from text that may have surrounding markdown."""
    # Strip markdown code blocks if present
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # Remove first and last ``` lines
        inner = []
        in_block = False
        for line in lines:
            if line.startswith("```"):
                in_block = not in_block
                continue
            if in_block or not text.startswith("```"):
                inner.append(line)
        text = "\n".join(inner).strip()

    # Find first { or [
    start = -1
    for i, ch in enumerate(text):
        if ch in ('{', '['):
            start = i
            break
    if start == -1:
        return text

    # Find matching end bracket
    opener = text[start]
    closer = '}' if opener == '{' else ']'
    depth = 0
    end = -1
    for i in range(start, len(text)):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                end = i
                break

    if end == -1:
        return text[start:]
    return text[start:end + 1]


def _validate_exercise(data: dict) -> None:
    """Raise ValueError if exercise JSON is missing required fields."""
    if not isinstance(data, dict):
        raise ValueError("Exercise must be a JSON object")
    if "segments" not in data or not isinstance(data["segments"], list):
        raise ValueError("Exercise missing 'segments' array")
    if not data.get("title"):
        raise ValueError("Exercise missing 'title'")

    blanks_seen = 0
    for i, seg in enumerate(data["segments"]):
        if seg.get("t") == "blank":
            blanks_seen += 1
            if "options" not in seg or not isinstance(seg["options"], list) or len(seg["options"]) < 2:
                raise ValueError(f"Blank {i} must have at least 2 options")
            if "correct" not in seg or not isinstance(seg["correct"], int):
                raise ValueError(f"Blank {i} missing 'correct' integer index")
            if seg["correct"] >= len(seg["options"]):
                raise ValueError(f"Blank {i} correct index out of range")

    if blanks_seen == 0:
        raise ValueError("Exercise has no blanks")


def generate_exercise(
    topic: str,
    interface_lang: str,
    grammar_focus: list[str],
    vocabulary: list[str],
    model: str,
    timeout: int,
    custom_prompt: str = "",
    ai_client: Optional[AIClient] = None,
) -> dict:
    """
    Call Ollama to generate a fill-in-the-blank grammar exercise.
    Returns parsed and validated exercise dict.
    Raises ValueError on failure.
    """
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")
    focus_str = ", ".join(grammar_focus) if grammar_focus else "articles, prepositions, word order"
    vocab_line = (
        f"Try to incorporate these vocabulary words naturally if they fit: {', '.join(vocabulary[:20])}"
        if vocabulary else ""
    )

    template = custom_prompt if custom_prompt.strip() else DEFAULT_PROMPT_GRAMMAR
    prompt = template.format_map(_SafeDict(
        topic=topic,
        interface_lang=interface_lang_name,
        grammar_focus=focus_str,
        vocabulary_line=vocab_line,
    ))

    client = ai_client or OllamaClient(OLLAMA_BASE)
    try:
        raw = client.complete(prompt, model, timeout)
    except Exception as exc:
        logger.warning("AI grammar call failed: %s", exc)
        raw = None
    if not raw:
        raise ValueError("AI provider did not return a response")

    json_str = _extract_json(raw)
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as exc:
        logger.warning("Grammar exercise JSON parse error: %s\nRaw: %s", exc, raw[:500])
        raise ValueError(f"Invalid JSON from Ollama: {exc}")

    _validate_exercise(data)

    # Normalise optional fields
    data.setdefault("grammar_notes", [])
    data.setdefault("vocabulary_used", [])
    data.setdefault("topic", topic)

    return data


def suggest_topics(
    interface_lang: str, model: str, timeout: int,
    ai_client: Optional[AIClient] = None,
) -> list[str]:
    """
    Ask Ollama for 7 grammar exercise topic suggestions.
    Returns list of topic strings (may be empty on failure).
    """
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")
    prompt = PROMPT_SUGGEST_TOPICS.format_map(_SafeDict(interface_lang=interface_lang_name))

    client = ai_client or OllamaClient(OLLAMA_BASE)
    try:
        raw = client.complete(prompt, model, timeout)
    except Exception:
        return []
    if not raw:
        return []

    json_str = _extract_json(raw)
    try:
        topics = json.loads(json_str)
        if isinstance(topics, list):
            return [str(t) for t in topics if t]
    except Exception:
        pass
    return []


def get_default_grammar_prompt() -> str:
    return DEFAULT_PROMPT_GRAMMAR
