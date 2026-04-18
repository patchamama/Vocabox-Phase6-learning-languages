"""
grammar_service.py — Ollama-powered German grammar exercise generation.

Three generation modes:
  two_phase  (default) — Phase 1: generate coherent prose; Phase 2: analyze prose → JSON exercise
  rolling              — Iterative sentence-by-sentence with accumulated context
  custom               — User-supplied prompt (original behavior)

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
import random
import re
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

# ── Prompts ───────────────────────────────────────────────────────────────────

# Legacy / custom-mode prompt (kept as default for custom mode)
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

# Two-phase mode — Phase 1: generate prose only
PROMPT_GENERATE_PROSE = """\
You are a German language teacher writing a grammar exercise text.

Topic: {topic}

GRAMMAR FOCUS — you MUST use these structures multiple times in the text:
{grammar_focus}

How to apply the grammar focus:
- Articles & declension: use declined articles (der/die/das/dem/den/ein/einen/einem/einer) in different cases. Example: "Ich kaufe einen Kaffee" (Akk), "mit dem Zug" (Dat), "der Mann" (Nom).
- Prepositions: use prepositions that govern specific cases (mit+Dat, für+Akk, in+Dat/Akk, auf+Dat/Akk, nach+Dat, bei+Dat, von+Dat, zu+Dat).
- Word order: include at least one subordinate clause (weil, dass, damit, wenn, obwohl) with verb at the end.
- Adjective endings: use adjectives before nouns with correct endings (ein schönes Hotel, dem netten Kellner).
- Modal verbs: use können, müssen, wollen, möchten, dürfen, sollen.
- Verb+preposition: use fixed verb-preposition pairs (warten auf, sich freuen auf, denken an, fragen nach).

Requirements:
- 5-7 sentences, natural and coherent German prose or dialogue
- EVERY sentence must contain at least one structure from the grammar focus above
- Intermediate level (A2-B2): avoid very rare vocabulary
- Write ONLY the German text — no explanations, no JSON, no markdown, no translation

German text:
"""

# Two-phase mode — Phase 2: analyze prose → blank list (Python builds segments)
PROMPT_ANALYZE_TO_EXERCISE = """\
You are a German grammar teacher. Your task: find words in the text that belong to the grammar focus areas and turn them into fill-in-the-blank questions. Generate between 8 and {max_blanks} blanks — pick the most interesting and varied ones, covering different grammatical categories.

TEXT:
{prose}

Grammar areas to focus on: {grammar_focus}

STEP 1 — Scan the text and list ALL words that match the grammar focus:
- "Articles & declension": find EVERY article and declined form — der/die/das/dem/den/ein/eine/einen/einem/einer. List every single one, even if the same form appears multiple times. Each occurrence = one blank.
- "Prepositions": find EVERY preposition — mit/nach/auf/für/in/an/zu/bei/von/durch/über/unter. Each one = one blank.
- "Adjective endings": find EVERY adjective before a noun. Each one = one blank (blank only the ending or the full adjective).
- "Modal verbs": find EVERY modal verb — kann/muss/will/möchte/darf/soll. Each one = one blank.
- "Word order": identify subordinate clauses (weil/dass/wenn/damit/obwohl) — blank the conjunction.
- "Verb+preposition": find verb+preposition pairs (freue mich auf, warte auf, denke an). Blank the preposition.

STEP 2 — For each word found, create a blank:
- "word": exact word as it appears in the text (case-sensitive, single word only)
- "options": exactly 3 DISTINCT words of the SAME TYPE. CRITICAL: "word" MUST be one of the 3 options. The other 2 must be plausible wrong alternatives of the same grammatical category. Never mix types. Never repeat values.

  Option sets by type — use ONLY words from the matching set:

  DEFINITE ARTICLES (der/die/das and their cases):
    → options from: der, die, das, dem, den, des
    Examples: "dem" → [dem, der, den] | "des" → [des, der, dem]

  INDEFINITE ARTICLES (ein and its cases):
    → options from: ein, eine, einen, einem, einer, eines
    Examples: "einen" → [einen, ein, eine] | "einem" → [einem, einen, einer]

  POSSESSIVE PRONOUNS (mein/dein/sein/ihr/unser/euer — all declined forms):
    → options: other declined forms of pronouns
    Examples: "meinem" → [meinem, meinen, meine] | "seiner" → [seiner, seinem, seine]
    "mein" → [mein, dein, sein] | "meine" → [meine, seine, deine]

  REFLEXIVE PRONOUNS (mich/dich/sich/uns/euch/mir/dir):
    → options from: mich, dich, sich, uns, euch, mir, dir
    Examples: "mich" → [mich, dich, sich] | "mir" → [mir, dir, sich]

  PREPOSITIONS (simple):
    → options from: mit, nach, auf, für, in, an, zu, bei, von, durch, über, unter, vor, hinter, neben, zwischen, seit, wegen, trotz, außer, gegenüber
    Examples: "mit" → [mit, nach, bei] | "für" → [für, mit, durch]

  PREPOSITION CONTRACTIONS (zu+dem=zum, zu+der=zur, in+das=ins, an+das=ans, bei+dem=beim, in+dem=im, an+dem=am, auf+das=aufs, von+dem=vom):
    → options from the same contraction family:
    "zum" → [zum, zur, beim] | "ins" → [ins, ans, aufs] | "im" → [im, am, beim] | "am" → [am, im, vom]

  DA-COMPOUNDS (darauf/darüber/daran/damit/dafür/davon/dabei/danach/darin/davor):
    → options from: darauf, darüber, daran, damit, dafür, davon, dabei, danach, darin, davor
    Examples: "darauf" → [darauf, daran, damit]

  MODAL VERBS (conjugated forms — keep same subject/tense):
    → options: other modals conjugated for the same subject
    "muss" (ich) → [muss, kann, darf] | "musst" (du) → [musst, kannst, darfst]
    "soll" → [soll, kann, will] | "darf" → [darf, muss, soll]

  ADJECTIVE ENDINGS (only the full adjective, not just the ending):
    → options: same adjective with different endings for wrong case/gender
    "wichtiges" → [wichtiges, wichtigen, wichtige] | "guten" → [guten, gute, gutem]

  SUBORDINATING CONJUNCTIONS (weil/dass/wenn/obwohl/damit/obwohl/nachdem/bevor/während):
    → options from: weil, dass, wenn, obwohl, damit, nachdem, bevor, während, falls
    Examples: "obwohl" → [obwohl, weil, wenn]

- "correct": 0-based index of the correct answer in options (shuffle — not always 0)
- "rule": ONE sentence in {interface_lang} — state the grammatical case/category, gender if applicable, and why this form is correct

STEP 3 — grammar_notes: write 2-3 summary notes in {interface_lang} about the main grammar patterns in this text.

Return ONLY valid JSON — no markdown, no backticks, no explanation:
{{"title":"Short German title (3-5 words)","topic":"{topic}","blanks":[{{"word":"einen","options":["ein","eine","einen","einem"],"correct":2,"rule":"Akkusativ maskulin: direktes Objekt, maskulin → einen"}},{{"word":"die","options":["der","die","das","dem"],"correct":1,"rule":"Nominativ feminin: Subjekt, feminin → die"}}],"grammar_notes":["note1 in {interface_lang}","note2"],"vocabulary_used":["word1","word2"]}}
"""

# Rolling mode — Phase 1: generate all sentences as plain prose
PROMPT_ROLLING_PROSE = """\
You are a German language teacher writing a grammar exercise text.

Topic: {topic}

GRAMMAR FOCUS — you MUST use these structures in the text:
{grammar_focus}

Write exactly {num_sentences} short, natural German sentences on this topic.
Requirements:
- Each sentence must be grammatically correct and naturally spelled (check umlauts: ä, ö, ü, ß).
- Each sentence introduces a NEW aspect or situation related to the topic — avoid repeating ideas.
- Every sentence must use at least one structure from the grammar focus above.
- Intermediate level (A2-B2): natural everyday German, no rare vocabulary.
- Write ONLY the {num_sentences} sentences separated by newlines — no numbering, no explanations, no JSON.

German sentences:
"""

# Rolling mode — Phase 2: for each sentence, choose ONE word to blank
PROMPT_ROLLING_BLANK = """\
You are creating a German fill-in-the-blank exercise.

German sentence: {sentence}
Grammar focus: {grammar_focus}

Choose ONE word from this sentence to turn into a blank. Prefer: articles, prepositions, pronouns, adjective endings, modal verbs.

Return ONLY valid JSON — no markdown, no backticks:
{{"answer":"<exact word from sentence>","wrong":["<wrong1>","<wrong2>"],"rule":"<grammar rule in {interface_lang}>"}}

Rules:
- "answer" must be exactly one word as it appears in the sentence (same spelling, same case).
- "wrong" = exactly 2 alternatives of the SAME word type (all definite articles, OR all prepositions, etc. — never mix).
- "rule" = one sentence explaining the grammatical rule in {interface_lang}.

EXAMPLE — sentence "Ich kaufe einen roten Pullover.":
{{"answer":"einen","wrong":["ein","eine"],"rule":"Akkusativ maskulin → einen"}}
"""

# Auto-correct pass after Phase 1 prose generation (used twice)
PROMPT_AUTO_CORRECT_PROSE = """\
Correct the following German text so it sounds like natural, fluent German with no spelling or grammar errors.
If the text is already correct, return it unchanged.
Return ONLY the plain corrected text — no comments, no explanations, no markdown, no labels.

{prose}
"""

# Prose correction prompt
PROMPT_CHECK_PROSE = """\
You are a German language teacher. Review this German text for grammatical errors, unnatural phrasing, or spelling mistakes:

---
{text}
---

Your response must have TWO sections:

SECTION 1 — CORRECTED TEXT:
Write the complete corrected version of the text. If the text is already correct, copy it unchanged.
Label this section clearly as "Texto corregido:" (or "Corrected text:" in English).

SECTION 2 — COMMENTS:
For each error found, explain:
1. The incorrect part (quote it)
2. The grammar rule and why it is wrong (in {interface_lang})
3. The correction

If the text is correct, write a brief confirmation.

Write the entire response in {interface_lang}.
"""

PROMPT_SUGGEST_TOPICS = """\
You are a German language teacher. Suggest 7 varied topics for German grammar exercises suitable for intermediate learners (A2-B2 level).

Return ONLY a valid JSON array of strings in {interface_lang}. No markdown, no extra text. Example:
["Im Restaurant", "Eine Reise planen", "Beim Arzt", "Die Wohnung beschreiben"]

Make them practical, everyday topics that naturally require using articles, prepositions, and different grammatical cases.
"""


# ── Utilities ─────────────────────────────────────────────────────────────────

class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _call_ollama(prompt: str, model: str, timeout: int, num_predict: int = 4096) -> str | None:
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
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        inner = []
        in_block = False
        for line in lines:
            if line.startswith("```"):
                in_block = not in_block
                continue
            if in_block or not text.startswith("```"):
                inner.append(line)
        text = "\n".join(inner).strip()

    start = -1
    for i, ch in enumerate(text):
        if ch in ('{', '['):
            start = i
            break
    if start == -1:
        return text

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
        partial = text[start:]
        return _repair_truncated_json(partial)
    return text[start:end + 1]


def _fix_common_model_errors(text: str) -> str:
    """Fix known JSON errors produced by small models."""
    # {"t": "text": "value"} → {"t": "text", "v": "value"}
    text = re.sub(
        r'"t"\s*:\s*"text"\s*:\s*"',
        '"t": "text", "v": "',
        text,
    )
    return text


def _repair_truncated_json(text: str) -> str:
    """Attempt to repair truncated JSON by closing open brackets/braces."""
    for i in range(len(text) - 1, -1, -1):
        if text[i] in (',', ']', '}'):
            text = text[:i + 1]
            break

    stack = []
    in_string = False
    escape = False
    for ch in text:
        if escape:
            escape = False
            continue
        if ch == '\\' and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            stack.append('}' if ch == '{' else ']')
        elif ch in ('}', ']'):
            if stack:
                stack.pop()

    text = text.rstrip()
    if text.endswith(','):
        text = text[:-1]

    while stack:
        text += stack.pop()

    return text


def _normalize_segments(segments: list) -> list:
    """
    Normalize segments that small models produce with wrong structure.

    Known patterns:
    1. {"t": "Ich plane __ Urlaub", "v": ""} — model puts text in 't', v is empty/absent
       → treat 't' value as the text, strip __ placeholder
    2. {"t": "text"} without "v" — find text in other fields
    3. Remove duplicate leading text segment that equals ≥60% of total text
       (model sometimes prepends full prose before real segments)
    """
    _BLANK_PLACEHOLDER = re.compile(r'_+\s*$')  # trailing __ at end of text (model placeholder)

    normalized = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        t_val = seg.get("t", "")

        if t_val == "blank":
            normalized.append(seg)
            continue

        if t_val == "text":
            v = seg.get("v", "")
            if not v:
                # v is empty — check other fields for actual text content
                for k, val in seg.items():
                    if k not in ("t", "v") and isinstance(val, str) and val.strip():
                        v = val
                        break
            # Strip trailing blank placeholder (e.g. "Ich plane gerade __")
            v = _BLANK_PLACEHOLDER.sub("", v)
            normalized.append({"t": "text", "v": v})
            continue

        # t value IS the text content (model wrote {"t": "Ich plane __ Urlaub", "v": ""})
        if isinstance(t_val, str) and len(t_val) > 2:
            text_content = _BLANK_PLACEHOLDER.sub("", t_val)
            normalized.append({"t": "text", "v": text_content})
            continue

    # Remove a leading text segment that is ≥60% of total text length
    # (model sometimes prepends the full prose before the real segments)
    if len(normalized) >= 2:
        total_text = "".join(s.get("v", "") for s in normalized if s.get("t") == "text")
        first = normalized[0]
        first_v = first.get("v", "")
        if (
            first.get("t") == "text"
            and len(first_v) > 50
            and len(total_text) > 0
            and len(first_v) >= 0.6 * len(total_text)
        ):
            normalized = normalized[1:]

    # Ensure text segments after a blank start with a space (model often omits it)
    # e.g. blank["einen"] + text["schönes Hotel"] → text[" schönes Hotel"]
    _PUNCT_START = re.compile(r'^[.,!?;:\)»"\']')
    for i in range(1, len(normalized)):
        seg = normalized[i]
        prev = normalized[i - 1]
        if (
            prev.get("t") == "blank"
            and seg.get("t") == "text"
        ):
            v = seg.get("v", "")
            if v and not v[0].isspace() and not _PUNCT_START.match(v):
                normalized[i] = {"t": "text", "v": " " + v}

    return normalized


def _find_word_in_text(word: str, text: str) -> re.Match | None:
    """
    Find `word` in `text` as a whole token.
    Strategy (each tried in order until a match is found):
      1. Exact case, word-boundary
      2. Case-insensitive, word-boundary
      3. Exact case, no word-boundary (handles punctuation-adjacent words)
      4. Case-insensitive, no word-boundary
    Returns the first match object or None.
    """
    escaped = re.escape(word)
    patterns = [
        re.compile(r'(?<!\w)' + escaped + r'(?!\w)'),
        re.compile(r'(?<!\w)' + escaped + r'(?!\w)', re.IGNORECASE),
        re.compile(escaped),
        re.compile(escaped, re.IGNORECASE),
    ]
    for pat in patterns:
        m = pat.search(text)
        if m:
            return m
    return None


def _build_segments_from_blanks(prose: str, blanks: list[dict]) -> list[dict]:
    """
    Build segments array from prose text + list of blanks.
    Each blank: {"word": "einen", "options": [...], "rule": "..."}
    Finds each word in the prose (left to right) and splits text around it.

    Matching uses _find_word_in_text with 4 fallback strategies so capitalisation
    differences (e.g. model returns "ein" but prose has "Ein" at sentence start)
    and punctuation-adjacent words are handled correctly.
    The actual text slice from prose is kept as the correct option anchor so
    options always reflect the real word form in context.
    """
    # Pre-count occurrences with the most lenient strategy (case-insensitive)
    word_counts: dict[str, int] = {}
    word_used: dict[str, int] = {}
    for blank in blanks:
        w = blank.get("word", "")
        if w and w not in word_counts:
            pat = re.compile(re.escape(w), re.IGNORECASE)
            word_counts[w] = len(pat.findall(prose))
            word_used[w] = 0

    # Sort blanks by their first appearance in the full prose (case-insensitive)
    def _first_pos(blank: dict) -> int:
        w = blank.get("word", "")
        if not w:
            return len(prose)
        m = _find_word_in_text(w, prose)
        return m.start() if m else len(prose)

    blanks = sorted(blanks, key=_first_pos)

    segments: list[dict] = []
    remaining = prose
    blank_id = 1

    for blank in blanks:
        word = blank.get("word", "")
        if not word:
            continue

        # Skip if we've already consumed all occurrences of this word
        if word_used.get(word, 0) >= word_counts.get(word, 0):
            logger.warning("Blank word %r exhausted in text (used %d/%d), skipping", word, word_used.get(word, 0), word_counts.get(word, 0))
            continue

        m = _find_word_in_text(word, remaining)
        if not m:
            logger.warning("Blank word %r not found in remaining text, skipping", word)
            continue

        start, end = m.start(), m.end()
        # Use the actual slice from prose — preserves the real capitalisation
        actual_word = remaining[start:end]
        word_used[word] = word_used.get(word, 0) + 1

        before = remaining[:start]
        remaining = remaining[end:]

        if before:
            segments.append({"t": "text", "v": before})

        # Build options: anchor on actual_word (as it appears in prose).
        # Model options may use the lowercase form — normalise by replacing any
        # case-equivalent entry with actual_word so the correct index is stable.
        raw_options = blank.get("options", [])
        seen: set[str] = set()
        normalised: list[str] = []
        for opt in raw_options:
            canonical = actual_word if opt.lower() == actual_word.lower() else opt
            if canonical not in seen:
                seen.add(canonical)
                normalised.append(canonical)

        # Ensure actual_word is present, then add distractors up to 3 total
        if actual_word not in normalised:
            normalised.insert(0, actual_word)
        distractors = [o for o in normalised if o != actual_word][:2]
        options = [actual_word] + distractors
        random.shuffle(options)
        correct_idx = options.index(actual_word)

        segments.append({
            "t": "blank",
            "id": blank_id,
            "options": options,
            "correct": correct_idx,
            "rule": blank.get("rule", ""),
        })
        blank_id += 1

    if remaining:
        segments.append({"t": "text", "v": remaining})

    return segments


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


def _call_client(client: AIClient, prompt: str, model: str, timeout: int, extra_kwargs: dict) -> str | None:
    """Call the AI client, return raw text or None."""
    logger.info("── AI REQUEST ── model=%s kwargs=%s\nPROMPT:\n%s\n── END PROMPT ──", model, extra_kwargs, prompt)
    try:
        result = client.complete(prompt, model, timeout, **extra_kwargs)
        logger.info("── AI RESPONSE ── %d chars:\n%s\n── END RESPONSE ──", len(result or ""), (result or "")[:1000])
        return result
    except Exception as exc:
        logger.warning("AI call failed: %s", exc)
        return None


def _parse_exercise_json(raw: str, attempt: int, prose: str = "") -> tuple[dict | None, Exception | None]:
    """Parse and validate exercise JSON. Returns (data, error)."""
    json_str = _fix_common_model_errors(_extract_json(raw))
    logger.info("Grammar raw response (attempt %d, %d chars):\n%s", attempt, len(raw), raw[:2000])
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as exc:
        logger.warning("Grammar JSON parse error (attempt %d): %s\nFull raw:\n%s", attempt, exc, raw)
        return None, ValueError(f"Invalid JSON from model: {exc}")

    # New format: model returns "blanks" list → build segments from prose
    if isinstance(data, dict) and "blanks" in data and prose:
        logger.info("Building segments from blanks list (%d blanks)", len(data["blanks"]))
        data["segments"] = _build_segments_from_blanks(prose, data["blanks"])
        data.pop("blanks", None)

    # Legacy format: normalize malformed segments
    elif isinstance(data, dict) and "segments" in data:
        data["segments"] = _normalize_segments(data["segments"])

    try:
        _validate_exercise(data)
    except ValueError as exc:
        logger.warning("Grammar validation failed (attempt %d): %s", attempt, exc)
        return None, exc

    return data, None


# ── Generation modes ──────────────────────────────────────────────────────────

def _generate_two_phase(
    topic: str,
    interface_lang: str,
    grammar_focus: str,
    model: str,
    timeout: int,
    client: AIClient,
    extra_kwargs: dict,
    correct_prose: bool = True,
    prose_override: Optional[str] = None,
    double_correct: bool = False,
    max_blanks: int = 10,
) -> dict:
    """Phase 1: generate prose. Optional Phase 1b: auto-correct (1 or 2 passes). Phase 2: analyze prose → exercise JSON."""
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")

    prose_kwargs = {**extra_kwargs, "num_predict": extra_kwargs.get("num_predict", 1024)}
    phase2_kwargs = {**extra_kwargs, "num_predict": max(extra_kwargs.get("num_predict", 0), 8000)}

    if prose_override:
        # Skip Phase 1 — use provided text directly
        prose = prose_override.strip()
        logger.info("[two_phase] Using prose_override (%d chars)", len(prose))
    else:
        # Phase 1 — prose
        logger.info("[two_phase] Phase 1: generating prose for topic=%r", topic)
        prose_prompt = PROMPT_GENERATE_PROSE.format_map(_SafeDict(
            topic=topic,
            grammar_focus=grammar_focus,
        ))
        prose = _call_client(client, prose_prompt, model, timeout, prose_kwargs)
        if not prose:
            raise ValueError("Phase 1 failed: model returned no prose")
        logger.info("[two_phase] Phase 1 prose (%d chars): %s", len(prose), prose[:120])

        # Phase 1b — auto-correct prose (1 or 2 passes)
        if correct_prose:
            num_passes = 2 if double_correct else 1
            logger.info("[two_phase] Phase 1b BEFORE (%d pass(es)): %s", num_passes, prose)
            for pass_num in range(1, num_passes + 1):
                correct_prompt = PROMPT_AUTO_CORRECT_PROSE.format_map(_SafeDict(prose=prose))
                corrected = _call_client(client, correct_prompt, model, timeout, prose_kwargs)
                if corrected:
                    corrected = corrected.strip()
                    if corrected == prose:
                        logger.info("[two_phase] Phase 1b pass %d: no changes, stopping", pass_num)
                        break
                    prose = corrected
                    logger.info("[two_phase] Phase 1b pass %d AFTER: %s", pass_num, prose)

    # Phase 2 — exercise JSON from prose
    logger.info("[two_phase] Phase 2: analyzing prose → exercise JSON\nPROSE SENT TO PHASE 2: %s", prose)
    exercise_prompt = PROMPT_ANALYZE_TO_EXERCISE.format_map(_SafeDict(
        prose=prose,
        topic=topic,
        interface_lang=interface_lang_name,
        grammar_focus=grammar_focus,
        max_blanks=max_blanks,
    ))

    last_error: Exception | None = None
    for attempt in range(1, 3):
        raw = _call_client(client, exercise_prompt, model, timeout, phase2_kwargs)
        if not raw:
            last_error = ValueError("Phase 2 returned no response")
            continue
        data, err = _parse_exercise_json(raw, attempt, prose=prose)
        if data is not None:
            return data
        last_error = err

    raise last_error or ValueError("Two-phase generation failed")


def _generate_rolling(
    topic: str,
    interface_lang: str,
    grammar_focus: str,
    num_sentences: int,
    model: str,
    timeout: int,
    client: AIClient,
    extra_kwargs: dict,
    double_correct: bool = False,
) -> dict:
    """
    Rolling mode — 3 phases:

    Phase 1 — generate all N sentences as plain prose in one call.
    Phase 1b — auto-correct the prose (same as two_phase).
    Phase 2 — for each sentence independently, ask model to choose ONE word
               to blank + provide options. Python splits on _find_word_in_text_.
               Uses the same _build_segments_from_blanks as two_phase.
    """
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")

    # ── Phase 1: generate all sentences at once ────────────────────────────────
    logger.info("[rolling] Phase 1: generating %d sentences", num_sentences)
    prose_prompt = PROMPT_ROLLING_PROSE.format_map(_SafeDict(
        topic=topic,
        grammar_focus=grammar_focus,
        num_sentences=num_sentences,
    ))
    prose_timeout = max(60, timeout // 3)
    raw_prose = _call_client(client, prose_prompt, model, prose_timeout, extra_kwargs)
    if not raw_prose:
        raise ValueError("Rolling Phase 1 returned no response")

    # Split into individual sentences — strip numbering/bullets if model added them
    lines = [re.sub(r'^\s*[\d\-\*\.\)]+\s*', '', ln).strip() for ln in raw_prose.splitlines()]
    sentences = [ln for ln in lines if len(ln) > 10]
    if not sentences:
        raise ValueError("Rolling Phase 1 produced no sentences")
    logger.info("[rolling] Phase 1 got %d sentences", len(sentences))

    # ── Phase 1b: auto-correct the full prose ─────────────────────────────────
    full_prose = " ".join(sentences)
    num_passes = 2 if double_correct else 1
    for pass_num in range(1, num_passes + 1):
        logger.info("[rolling] Phase 1b pass %d: correcting prose", pass_num)
        correct_prompt = PROMPT_AUTO_CORRECT_PROSE.format_map(_SafeDict(prose=full_prose))
        corrected = _call_client(client, correct_prompt, model, prose_timeout, extra_kwargs)
        if corrected:
            if corrected == full_prose:
                logger.info("[rolling] Phase 1b pass %d: no changes, stopping", pass_num)
                break
            full_prose = corrected.strip()
            logger.info("[rolling] Phase 1b pass %d done", pass_num)

    # Re-split corrected prose back into sentences
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', full_prose) if s.strip()]
    logger.info("[rolling] After correction: %d sentences", len(sentences))

    # ── Phase 2: blank one word per sentence ──────────────────────────────────
    all_segments: list[dict] = []
    blank_id = 1
    per_sentence_timeout = max(30, timeout // max(len(sentences), 1))

    for i, sentence in enumerate(sentences):
        logger.info("[rolling] Phase 2 sentence %d/%d: %r", i + 1, len(sentences), sentence[:60])
        blank_prompt = PROMPT_ROLLING_BLANK.format_map(_SafeDict(
            sentence=sentence,
            grammar_focus=grammar_focus,
            interface_lang=interface_lang_name,
        ))

        blank_data: dict | None = None
        for attempt in range(1, 3):
            raw = _call_client(client, blank_prompt, model, per_sentence_timeout, extra_kwargs)
            if not raw:
                break
            try:
                parsed = json.loads(_fix_common_model_errors(_extract_json(raw)))
                answer = parsed.get("answer", "").strip()
                wrong = parsed.get("wrong", [])
                rule = parsed.get("rule", "")
                if not answer or len(wrong) < 1:
                    raise ValueError(f"Incomplete blank data: answer={answer!r} wrong={wrong}")
                blank_data = {"word": answer, "options": wrong, "rule": rule}
                break
            except Exception as exc:
                logger.warning("[rolling] Phase 2 parse error sentence %d attempt %d: %s", i+1, attempt, exc)

        if blank_data is None:
            # Fallback: include the sentence as plain text with no blank
            logger.warning("[rolling] Sentence %d has no blank, adding as plain text", i+1)
            all_segments.append({"t": "text", "v": sentence + " "})
            continue

        # Build segments using the robust builder (handles capitalisation etc.)
        sentence_segs = _build_segments_from_blanks(sentence + " ", [blank_data])

        # Re-assign blank IDs globally
        for seg in sentence_segs:
            if seg.get("t") == "blank":
                seg["id"] = blank_id
                blank_id += 1

        all_segments.extend(sentence_segs)

    if not all_segments:
        raise ValueError("Rolling generation produced no segments")

    if not any(s.get("t") == "blank" for s in all_segments):
        raise ValueError("Rolling generation produced no blanks")

    return {
        "title": topic[:40],
        "topic": topic,
        "segments": all_segments,
        "grammar_notes": [],
        "vocabulary_used": [],
    }


# ── Public API ────────────────────────────────────────────────────────────────

def generate_exercise(
    topic: str,
    interface_lang: str,
    grammar_focus: list[str],
    vocabulary: list[str],
    model: str,
    timeout: int,
    custom_prompt: str = "",
    ai_client: Optional[AIClient] = None,
    temperature: Optional[float] = None,
    num_predict: Optional[int] = None,
    top_p: Optional[float] = None,
    mode: str = "two_phase",
    rolling_sentences: int = 6,
    prose_override: Optional[str] = None,
    double_correct: bool = False,
    max_blanks: int = 10,
) -> dict:
    """
    Generate a fill-in-the-blank grammar exercise.

    mode:
      "two_phase"  — Phase 1: prose generation; Phase 2: prose → JSON (default)
      "rolling"    — Iterative sentence-by-sentence with accumulated context
      "custom"     — Uses custom_prompt (original single-shot behavior)
    """
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")
    focus_str = ", ".join(grammar_focus) if grammar_focus else "articles, prepositions, word order"

    client = ai_client or OllamaClient(OLLAMA_BASE)

    extra_kwargs: dict = {}
    if isinstance(client, OllamaClient):
        if num_predict is not None:
            extra_kwargs["num_predict"] = num_predict
        if temperature is not None:
            extra_kwargs["temperature"] = temperature
        if top_p is not None:
            extra_kwargs["top_p"] = top_p

    # Dispatch to mode
    if mode == "two_phase":
        data = _generate_two_phase(
            topic=topic,
            interface_lang=interface_lang,
            grammar_focus=focus_str,
            model=model,
            timeout=timeout,
            client=client,
            extra_kwargs=extra_kwargs,
            prose_override=prose_override,
            double_correct=double_correct,
            max_blanks=max_blanks,
        )
    elif mode == "rolling":
        data = _generate_rolling(
            topic=topic,
            interface_lang=interface_lang,
            grammar_focus=focus_str,
            num_sentences=rolling_sentences,
            model=model,
            timeout=timeout,
            client=client,
            extra_kwargs=extra_kwargs,
            double_correct=double_correct,
        )
    else:
        # custom / legacy single-shot
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

        last_error: Exception | None = None
        data = None
        for attempt in range(1, 3):
            raw = _call_client(client, prompt, model, timeout, extra_kwargs)
            if not raw:
                last_error = ValueError("AI provider did not return a response")
                continue
            parsed, err = _parse_exercise_json(raw, attempt)
            if parsed is not None:
                data = parsed
                break
            last_error = err

        if data is None:
            raise last_error or ValueError("Exercise generation failed after retries")

    data.setdefault("grammar_notes", [])
    data.setdefault("vocabulary_used", [])
    data.setdefault("topic", topic)

    return data


def check_prose(
    text: str,
    interface_lang: str,
    model: str,
    timeout: int,
    ai_client: Optional[AIClient] = None,
) -> str:
    """
    Ask the model to review a German text for grammatical errors.
    Returns the model's feedback as a plain string.
    """
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")
    prompt = PROMPT_CHECK_PROSE.format_map(_SafeDict(
        text=text,
        interface_lang=interface_lang_name,
    ))
    client = ai_client or OllamaClient(OLLAMA_BASE)
    try:
        raw = client.complete(prompt, model, timeout)
        return raw.strip() if raw else "No response from model."
    except Exception as exc:
        logger.warning("check_prose call failed: %s", exc)
        raise ValueError(f"Model unavailable: {exc}")


def suggest_topics(
    interface_lang: str, model: str, timeout: int,
    ai_client: Optional[AIClient] = None,
) -> list[str]:
    """Ask the model for 7 grammar exercise topic suggestions."""
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


def get_default_grammar_prompt(mode: str = "custom") -> str:
    if mode == "two_phase":
        return PROMPT_ANALYZE_TO_EXERCISE
    if mode == "rolling":
        return PROMPT_ROLLING_PROSE + "\n\n---\n\nPhase 2 (per sentence):\n\n" + PROMPT_ROLLING_BLANK
    return DEFAULT_PROMPT_GRAMMAR
