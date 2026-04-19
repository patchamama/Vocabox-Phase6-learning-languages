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

# CEFR level descriptions for prompt injection
CEFR_LEVEL_DESCRIPTIONS = {
    "A1": (
        "CEFR level A1 (Beginner). Use ONLY:\n"
        "- Very simple, short sentences (subject + verb + object)\n"
        "- Basic everyday vocabulary: numbers, colors, family, food, greetings\n"
        "- Present tense only (Präsens)\n"
        "- Basic articles (der/die/das) in nominative and accusative only\n"
        "- Common verbs: sein, haben, heißen, wohnen, kommen, gehen, essen, trinken\n"
        "- No subordinate clauses, no complex grammar\n"
        "- Max 8-10 words per sentence"
    ),
    "A2": (
        "CEFR level A2 (Elementary). Use:\n"
        "- Simple sentences with some coordination (und, aber, oder)\n"
        "- Present tense, Perfekt for past events\n"
        "- Basic prepositions with dative: mit, bei, nach, zu, von, aus, seit\n"
        "- Accusative prepositions: durch, für, gegen, ohne, um\n"
        "- Articles in nominative, accusative and dative (no genitive)\n"
        "- Common adjectives without complex declension\n"
        "- Modal verbs: können, müssen, wollen, möchten\n"
        "- Everyday topics: shopping, travel, family, work, free time\n"
        "- Max 12-15 words per sentence"
    ),
    "B1": (
        "CEFR level B1 (Intermediate). Use:\n"
        "- Compound sentences with subordinate clauses (weil, dass, wenn, obwohl, damit)\n"
        "- Perfekt and Präteritum for narration\n"
        "- All four cases including genitive\n"
        "- All prepositions with correct cases including Wechselpräpositionen\n"
        "- Adjective declension (strong, weak, mixed)\n"
        "- All modal verbs including subjunctive (könnte, müsste, würde)\n"
        "- Verb-preposition pairs (warten auf, sich freuen auf, denken an)\n"
        "- Varied vocabulary, some idiomatic expressions\n"
        "- 15-20 words per sentence"
    ),
    "B2": (
        "CEFR level B2 (Upper-Intermediate). Use:\n"
        "- Complex sentence structures with multiple clauses\n"
        "- Konjunktiv II freely (würde, hätte, wäre, könnte)\n"
        "- Passive voice (wird gemacht, wurde gebaut)\n"
        "- Extended use of genitive and complex prepositions (wegen, trotz, aufgrund, anhand)\n"
        "- Participial phrases and infinitive constructions (um...zu, ohne...zu, anstatt...zu)\n"
        "- Nuanced vocabulary, collocations, fixed expressions\n"
        "- Abstract topics: environment, society, work culture\n"
        "- 20-25 words per sentence"
    ),
    "C1": (
        "CEFR level C1 (Advanced). Use:\n"
        "- Sophisticated, varied sentence structures with embedded clauses\n"
        "- Konjunktiv I for reported speech (er sagte, er sei...)\n"
        "- Complex passive constructions including modal passive\n"
        "- Nominal style (Nominalisierungen): die Durchführung, die Entscheidung\n"
        "- Advanced connectors: dennoch, infolgedessen, nichtsdestotrotz, einerseits...andererseits\n"
        "- Rich idiomatic language and register variation\n"
        "- Abstract, academic or professional topics\n"
        "- 25+ words per sentence, complex syntax"
    ),
    "C2": (
        "CEFR level C2 (Mastery). Use:\n"
        "- Native-like precision with full grammatical complexity\n"
        "- All Konjunktiv forms including archaic/literary uses\n"
        "- Complex nominalization and abstract noun phrases\n"
        "- Rare but precise vocabulary, including compound nouns\n"
        "- Stylistic variation: formal, informal, literary registers\n"
        "- Sophisticated rhetorical structures\n"
        "- Topics: philosophy, politics, literature, science\n"
        "- No length restriction — natural, flowing prose"
    ),
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

# ── Focus-conditional prompt building ─────────────────────────────────────────
#
# Each focus key maps to:
#   FOCUS_PROSE_GUIDE   → one instruction line for Phase-1 prose generation
#   FOCUS_STEP1         → one instruction line for Phase-2 STEP 1 (what to scan)
#   FOCUS_STEP2_BLOCKS  → the option-set block(s) for Phase-2 STEP 2
#   FOCUS_BLANK_HINT    → one-line hint for Rolling PROMPT_ROLLING_BLANK
#
# Keys must match what the frontend sends in the grammar_focus array:
#   articles, cases, prepositions, word_order, verb_prepositions,
#   adjective_endings, modal_verbs, possessive_pronouns, reflexive_pronouns

FOCUS_PROSE_GUIDE: dict[str, str] = {
    "articles": (
        "- Articles & declension: pack MULTIPLE declined forms per sentence — "
        "der/die/das/dem/den/des/ein/eine/einen/einem/einer/eines. "
        "Each case (Nom/Akk/Dat/Gen) at least twice across the text."
    ),
    "cases": (
        "- Cases (Nom/Akk/Dat/Gen): vary grammatical cases — use nouns and pronouns "
        "in different cases so each case appears at least once."
    ),
    "prepositions": (
        "- Prepositions: use prepositions with their required case — "
        "mit+Dat, für+Akk, in+Dat/Akk (Wechsel!), auf+Dat/Akk, nach+Dat, bei+Dat, "
        "von+Dat, zu+Dat, wegen+Gen, trotz+Gen. "
        "Include contractions (zum, zur, im, am, ins, vom, beim) and "
        "da-compounds (darauf, damit, dafür, davon, daran) where natural."
    ),
    "word_order": (
        "- Word order: include at least TWO subordinate clauses "
        "(weil, dass, damit, wenn, obwohl, nachdem, bevor, während) with verb at the end."
    ),
    "verb_prepositions": (
        "- Verb+preposition pairs: include fixed verb-preposition pairs — "
        "warten auf (+Akk), sich freuen auf (+Akk), denken an (+Akk), "
        "fragen nach (+Dat), sich interessieren für (+Akk), sprechen über (+Akk)."
    ),
    "adjective_endings": (
        "- Adjective endings: use adjectives before nouns with correct case/gender agreement — "
        "strong (kalter Kaffee), weak (der kalte Kaffee), mixed (ein kalter Kaffee). "
        "Vary the case and gender."
    ),
    "modal_verbs": (
        "- Modal verbs: use at least two DIFFERENT modals "
        "(können, müssen, wollen, möchten, dürfen, sollen) "
        "conjugated for different subjects (ich/du/er/wir)."
    ),
    "possessive_pronouns": (
        "- Possessive pronouns: use DECLINED possessive pronouns across different cases — "
        "meinen/meinem/meiner/seiner/ihrer/unserem/eurem etc. "
        "At least 3 different declined forms."
    ),
    "reflexive_pronouns": (
        "- Reflexive pronouns: use reflexive verb constructions explicitly — "
        "mich/dich/sich/uns/euch/mir/dir in verbs like "
        "sich freuen, sich erinnern, sich waschen, sich setzen, sich vorstellen."
    ),
}

FOCUS_STEP1: dict[str, str] = {
    "articles": (
        '- "Articles & declension": find EVERY definite article (der/die/das/dem/den/des) '
        'and indefinite article (ein/eine/einen/einem/einer/eines). '
        'List every single occurrence — even repeated forms. Each occurrence = one blank.'
    ),
    "cases": (
        '- "Cases (Nom/Akk/Dat/Gen)": find articles and pronouns that show case — '
        'der/die/das/dem/den/des, ein/eine/einen/einem/einer/eines. Each occurrence = one blank.'
    ),
    "prepositions": (
        '- "Prepositions": find EVERY simple preposition '
        '(mit/nach/auf/für/in/an/zu/bei/von/durch/über/unter/vor/hinter/neben/zwischen/seit/wegen/trotz), '
        'every contraction (zum/zur/im/am/ins/vom/beim/aufs/ans), '
        'and every da-compound (darauf/darüber/daran/damit/dafür/davon/dabei/danach/darin/davor). '
        'Each one = one blank.'
    ),
    "word_order": (
        '- "Word order / subordinate clauses": identify subordinating conjunctions '
        '(weil/dass/wenn/damit/obwohl/nachdem/bevor/während/falls) — blank the conjunction.'
    ),
    "verb_prepositions": (
        '- "Verb+preposition": find verb+preposition pairs '
        '(warte auf, freue mich auf, denke an, frage nach, interessiere mich für, spreche über). '
        'Blank the preposition only (single word).'
    ),
    "adjective_endings": (
        '- "Adjective endings": find EVERY adjective directly before a noun. '
        'Each one = one blank (blank the FULL adjective, not just its ending).'
    ),
    "modal_verbs": (
        '- "Modal verbs": find EVERY conjugated modal verb '
        '(kann/kannst/können/muss/musst/müssen/will/willst/wollen/'
        'darf/darfst/dürfen/soll/sollst/sollen/mag/magst/mögen/möchte/möchtest/möchten). '
        'Each one = one blank.'
    ),
    "possessive_pronouns": (
        '- "Possessive pronouns": find EVERY possessive pronoun form '
        '(mein/meine/meinen/meinem/meiner/meines/'
        'dein/deine/deinen/deinem/deiner/'
        'sein/seine/seinen/seinem/seiner/'
        'ihr/ihre/ihren/ihrem/ihrer/'
        'unser/unsere/unseren/unserem/unserer/'
        'euer/eure/euren/eurem/eurer). '
        'Each one = one blank.'
    ),
    "reflexive_pronouns": (
        '- "Reflexive pronouns": find EVERY reflexive pronoun '
        '(mich/dich/sich/uns/euch/mir/dir) used in reflexive verb constructions. '
        'Each one = one blank.'
    ),
}

FOCUS_STEP2_BLOCKS: dict[str, str] = {
    "articles": """\
  DEFINITE ARTICLES (der/die/das and their cases):
    → options from: der, die, das, dem, den, des
    Examples: "dem" → [dem, der, den] | "des" → [des, der, dem] | "den" → [den, dem, der]

  INDEFINITE ARTICLES (ein and its cases):
    → options from: ein, eine, einen, einem, einer, eines
    Examples: "einen" → [einen, ein, eine] | "einem" → [einem, einen, einer]""",

    "cases": """\
  DEFINITE ARTICLES (der/die/das and their cases):
    → options from: der, die, das, dem, den, des
    Examples: "dem" → [dem, der, den] | "des" → [des, der, dem]

  INDEFINITE ARTICLES (ein and its cases):
    → options from: ein, eine, einen, einem, einer, eines
    Examples: "einen" → [einen, ein, eine] | "einem" → [einem, einen, einer]""",

    "prepositions": """\
  PREPOSITIONS (simple):
    → options from: mit, nach, auf, für, in, an, zu, bei, von, durch, über, unter, vor, hinter, neben, zwischen, seit, wegen, trotz, außer, gegenüber
    Examples: "mit" → [mit, nach, bei] | "für" → [für, mit, durch] | "seit" → [seit, nach, von]

  PREPOSITION CONTRACTIONS (zum/zur/ins/ans/beim/im/am/aufs/vom):
    → options from the same contraction family:
    "zum" → [zum, zur, beim] | "ins" → [ins, ans, aufs] | "im" → [im, am, beim] | "am" → [am, im, vom]

  DA-COMPOUNDS (darauf/darüber/daran/damit/dafür/davon/dabei/danach/darin/davor):
    → options from: darauf, darüber, daran, damit, dafür, davon, dabei, danach, darin, davor
    Examples: "darauf" → [darauf, daran, damit] | "davon" → [davon, dafür, dabei]""",

    "word_order": """\
  SUBORDINATING CONJUNCTIONS (weil/dass/wenn/obwohl/damit/nachdem/bevor/während):
    → options from: weil, dass, wenn, obwohl, damit, nachdem, bevor, während, falls
    Examples: "obwohl" → [obwohl, weil, wenn] | "nachdem" → [nachdem, bevor, während]""",

    "verb_prepositions": """\
  PREPOSITIONS in verb+preposition context:
    → options from: auf, an, für, nach, über, von, bei, mit, in, zu, um
    Examples: "auf" (warten auf) → [auf, an, für] | "an" (denken an) → [an, auf, über]
    "nach" (fragen nach) → [nach, an, für] | "für" (interessieren für) → [für, auf, an]""",

    "adjective_endings": """\
  ADJECTIVE ENDINGS (blank the FULL adjective, not just the ending):
    → options: same adjective root with different endings for wrong case/gender
    "wichtiges" → [wichtiges, wichtigen, wichtige] | "guten" → [guten, gute, gutem]
    "kalten" → [kalten, kalte, kaltem] | "schöner" → [schöner, schöne, schönem]""",

    "modal_verbs": """\
  MODAL VERBS (conjugated — keep same subject and tense):
    → options: other modals conjugated for the SAME subject
    ich: "muss" → [muss, kann, darf] | "will" → [will, soll, kann]
    du: "musst" → [musst, kannst, darfst] | "willst" → [willst, sollst, kannst]
    er/sie: "muss" → [muss, kann, darf] | "soll" → [soll, kann, will]
    wir/sie: "müssen" → [müssen, können, dürfen] | "wollen" → [wollen, sollen, können]""",

    "possessive_pronouns": """\
  POSSESSIVE PRONOUNS (mein/dein/sein/ihr/unser/euer — all declined forms):
    → options: other declined forms of possessives (same or different owner)
    "meinem" → [meinem, meinen, meine] | "seiner" → [seiner, seinem, seine]
    "mein" → [mein, dein, sein] | "meine" → [meine, seine, deine]
    "unserem" → [unserem, unseren, unser] | "ihren" → [ihren, ihre, ihrem]""",

    "reflexive_pronouns": """\
  REFLEXIVE PRONOUNS (mich/dich/sich/uns/euch/mir/dir):
    → options from: mich, dich, sich, uns, euch, mir, dir
    Examples: "mich" → [mich, dich, sich] | "mir" → [mir, dir, sich]
    "uns" → [uns, euch, sich] | "dich" → [dich, mich, sich]""",
}

# Short hint injected into PROMPT_ROLLING_BLANK per focus key
FOCUS_BLANK_HINT: dict[str, str] = {
    "articles": "articles (definite: der/die/das/dem/den/des — indefinite: ein/eine/einen/einem/einer)",
    "cases": "articles or pronouns showing grammatical case (Nom/Akk/Dat/Gen)",
    "prepositions": "prepositions (mit/auf/für/in/an/zu/bei...), contractions (zum/zur/im/am/ins) or da-compounds (darauf/damit/dafür)",
    "word_order": "subordinating conjunctions (weil/dass/wenn/obwohl/damit/nachdem/bevor/während)",
    "verb_prepositions": "the preposition in a verb+preposition pair (warten auf, denken an, fragen nach...)",
    "adjective_endings": "an adjective before a noun (blank the full adjective)",
    "modal_verbs": "a modal verb (kann/muss/will/darf/soll/möchte and their conjugations)",
    "possessive_pronouns": "a possessive pronoun (mein/meine/meinen/meinem/sein/ihre/unser...)",
    "reflexive_pronouns": "a reflexive pronoun (mich/dich/sich/uns/euch/mir/dir)",
}


def _build_prose_focus_guide(focus_keys: list[str], free_text: list[str] | None = None) -> str:
    """Build the grammar focus application guide lines for Phase-1 prose prompts."""
    lines = [FOCUS_PROSE_GUIDE[k] for k in focus_keys if k in FOCUS_PROSE_GUIDE]
    # Option B: inject free-text focus items as direct instructions
    for ft in (free_text or []):
        lines.append(f"- {ft}: build multiple sentences that clearly illustrate this grammar structure. Use it at least 3 times across the text.")
    return "\n".join(lines) if lines else "- Use natural German grammar appropriate to the level."


def _build_analysis_step1(focus_keys: list[str], free_text: list[str] | None = None) -> str:
    """Build the STEP 1 scan instructions for PROMPT_ANALYZE_TO_EXERCISE."""
    # Deduplicate: 'articles' and 'cases' both produce article blanks — keep only one line
    seen: set[str] = set()
    lines: list[str] = []
    for k in focus_keys:
        canonical = "articles" if k == "cases" else k
        if canonical not in seen and k in FOCUS_STEP1:
            seen.add(canonical)
            lines.append(FOCUS_STEP1[k])
    # Option B: free-text focus → instruct model to find and blank relevant words itself
    for ft in (free_text or []):
        lines.append(
            f'- "{ft}": find every word or form that exemplifies this grammar structure. '
            f'Each occurrence = one blank. Choose plausible wrong alternatives of the same grammatical category.'
        )
    return "\n".join(lines) if lines else "- Find grammatically interesting words to blank."


def _build_analysis_step2(focus_keys: list[str], free_text: list[str] | None = None) -> str:
    """Build the option-set blocks for STEP 2 of PROMPT_ANALYZE_TO_EXERCISE."""
    seen: set[str] = set()
    blocks: list[str] = []
    for k in focus_keys:
        # 'articles' and 'cases' share the same block — deduplicate
        canonical = "articles" if k == "cases" else k
        if canonical not in seen and canonical in FOCUS_STEP2_BLOCKS:
            seen.add(canonical)
            blocks.append(FOCUS_STEP2_BLOCKS[canonical])
    # Option B: for free-text focus, no fixed option sets — model uses own judgment
    for ft in (free_text or []):
        blocks.append(
            f"  {ft.upper()} forms:\n"
            f"    → Choose 2 wrong options of the SAME grammatical category as the correct answer.\n"
            f"    → Never mix grammatical categories. Options must be the same word type."
        )
    if not blocks:
        return "  Use appropriate option sets for the word type found."
    return "\n\n".join(blocks)


def _build_rolling_blank_instructions(focus_keys: list[str], free_text: list[str] | None = None) -> str:
    """Build the word-type preference hint for PROMPT_ROLLING_BLANK."""
    hints = [FOCUS_BLANK_HINT[k] for k in focus_keys if k in FOCUS_BLANK_HINT]
    # Option B: add free-text items as direct hints
    hints.extend(free_text or [])
    if not hints:
        return "articles, prepositions, pronouns, adjective endings, modal verbs"
    return " | ".join(hints)


# Two-phase mode — Phase 1: generate prose only
PROMPT_GENERATE_PROSE = """\
You are a German language teacher writing a text for a grammar exercise.

Topic: {topic}

{cefr_block}

PRIMARY GOAL — GRAMMAR FOCUS:
The text MUST be rich in the following grammar structures. Every sentence must illustrate at least one of them:
{grammar_focus}

Grammar focus application guide — apply ONLY the instructions below, nothing else:
{prose_focus_guide}

Format rules:
- 5-8 sentences total. Write either coherent prose OR a dialogue — both are good.
- CRITICAL: put EACH sentence on its OWN line. One sentence = one line. No sentence runs into another on the same line.
- If writing a DIALOGUE: each speaker turn on its own line, starting with the speaker's name followed by a colon.
  Example:
  Anna: Ich möchte einen Kaffee, bitte.
  Kellner: Mit Milch oder ohne?
  Anna: Mit Milch, aber ohne Zucker.
- If writing PROSE: still one sentence per line. Example:
  Der Zug fährt um 8 Uhr ab.
  Maria wartet am Bahnhof auf ihren Freund.
  Sie hat eine Tasse Kaffee in der Hand.
- Write ONLY the German text — no explanations, no labels, no JSON, no translation, no markdown.

German text:
"""

# Two-phase mode — Phase 2: analyze prose → blank list (Python builds segments)
PROMPT_ANALYZE_TO_EXERCISE = """\
You are a German grammar teacher. Your task: find words in the text that belong to the grammar focus areas and turn them into fill-in-the-blank questions. Generate between 6 and {max_blanks} blanks — pick the most interesting and varied ones, strictly within the grammar focus.

TEXT:
{prose}

Grammar areas to focus on: {grammar_focus}

IMPORTANT: ONLY blank words from the grammar focus listed above. Do NOT blank words from other grammatical categories.

STEP 1 — Scan the text and list ALL words that match the grammar focus ONLY:
{step1_instructions}

STEP 2 — For each word found, create a blank:
- "word": exact word as it appears in the text (case-sensitive, single word only)
- "options": exactly 3 DISTINCT words of the SAME TYPE. CRITICAL: "word" MUST be one of the 3 options. The other 2 must be plausible wrong alternatives of the SAME grammatical category. Never mix types. Never repeat values.

  Option sets by type — use ONLY the sets listed below, no others:

{step2_blocks}

- "correct": 0-based index of the correct answer in options (shuffle — not always 0)
- "rule": ONE sentence in {interface_lang} — state the grammatical case/category, gender if applicable, and why this form is correct

STEP 3 — grammar_notes: write 2-3 summary notes in {interface_lang} about the main grammar patterns in this text.

Return ONLY valid JSON — no markdown, no backticks, no explanation:
{{"title":"Short German title (3-5 words)","description":"One sentence in {interface_lang} describing what this exercise covers (grammar + topic)","cefr_level":"B1","topic":"{topic}","blanks":[{{"word":"einen","options":["ein","eine","einen","einem"],"correct":2,"rule":"Akkusativ maskulin: direktes Objekt, maskulin → einen"}},{{"word":"die","options":["der","die","das","dem"],"correct":1,"rule":"Nominativ feminin: Subjekt, feminin → die"}}],"grammar_notes":["note1 in {interface_lang}","note2"],"vocabulary_used":["word1","word2"]}}

For "cefr_level": pick the ONE level that best matches the difficulty (A1/A2/B1/B2/C1/C2).
For "description": write a single sentence in {interface_lang} summarizing the grammar focus and context of this exercise.
"""

# Rolling mode — Phase 1: generate all sentences as plain prose
PROMPT_ROLLING_PROSE = """\
You are a German language teacher writing sentences for a grammar exercise.

Topic: {topic}

{cefr_block}

PRIMARY GOAL — GRAMMAR FOCUS:
Every sentence MUST actively illustrate at least one of these structures (more is better):
{grammar_focus}

Grammar focus application guide — apply ONLY the instructions below, nothing else:
{prose_focus_guide}

Format rules:
- Write exactly {num_sentences} sentences.
- CRITICAL: one sentence per line. Each sentence ends and the next begins on a NEW line.
- You may write a coherent mini-story OR a dialogue — both are good.
- If writing a DIALOGUE: each speaker turn on its own line (speaker name + colon + sentence).
  Example:
  Anna: Ich muss mit dem Bus fahren, weil mein Auto kaputt ist.
  Max: Kannst du nicht mit meinem Fahrrad fahren?
- If writing PROSE: still one sentence per line.
  Example:
  Der Zug fährt um 8 Uhr ab.
  Maria wartet am Bahnhof auf ihren Freund.
- Each sentence must cover a NEW aspect — do not repeat ideas or structures.
- Write ONLY the sentences — no numbering, no explanations, no JSON, no markdown.

German sentences:
"""

# Rolling mode — Phase 2: for each sentence, choose ONE word to blank
PROMPT_ROLLING_BLANK = """\
You are creating a German fill-in-the-blank exercise.

German sentence: {sentence}
Grammar focus: {grammar_focus}

Choose ONE word from this sentence to turn into a blank.
ONLY choose a word that belongs to the grammar focus. Preferred word types (in order):
{blank_instructions}

Return ONLY valid JSON — no markdown, no backticks:
{{"answer":"<exact word from sentence>","wrong":["<wrong1>","<wrong2>"],"rule":"<grammar rule in {interface_lang}>"}}

Rules:
- "answer" must be exactly one word as it appears in the sentence (same spelling, same case).
- "wrong" = exactly 2 alternatives of the SAME word type (never mix types).
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
You are a German language teacher. Check the following German text strictly for:
1. Grammatical errors (wrong case, wrong verb form, wrong agreement, wrong word order)
2. Spelling errors (including umlauts: ä, ö, ü, ß)

Do NOT comment on style, naturalness, vocabulary choice, or phrasing — only hard grammar and spelling errors.
Do NOT rewrite or reproduce the full text.

---
{text}
---

Write your response in {interface_lang}.

List only the errors found. For each error:
- Quote the wrong part
- Explain the rule briefly
- Show the correction

If no errors were found, write a single short confirmation sentence.
"""

PROMPT_GRAMMAR_NOTES = """\
You are a German grammar teacher. Read this German text and write 2-3 concise grammar notes in {interface_lang} about the main grammar patterns it illustrates (cases, prepositions, verb forms, word order, etc.).

Text:
{prose}

Also suggest:
- A short German title for this exercise (3-6 words)
- A one-sentence description in {interface_lang} of what the exercise covers (grammar + topic)
- The CEFR level (A1/A2/B1/B2/C1/C2) that best matches the difficulty

Return ONLY a valid JSON object — no markdown, no extra text:
{{"title":"Short German title","description":"One sentence in {interface_lang}","cefr_level":"B1","notes":["note 1 in {interface_lang}","note 2 in {interface_lang}"]}}
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
      1. Exact case, word-boundary  (\b word \b)
      2. Case-insensitive, word-boundary
      3. Exact case, preceded/followed by non-word char or start/end (handles ä/ö/ü adjacent to punctuation)
      4. Case-insensitive, same

    Patterns 3 and 4 intentionally require the match NOT to be embedded inside a longer
    word — a match at position i is only valid if text[i-1] (if exists) and text[i+len]
    (if exists) are non-alphanumeric. This prevents "hat" from matching inside "hatten".
    Returns the first valid match object or None.
    """
    escaped = re.escape(word)
    # Patterns 1 & 2: strict word boundary (\b handles ASCII word chars only)
    strict_patterns = [
        re.compile(r'\b' + escaped + r'\b'),
        re.compile(r'\b' + escaped + r'\b', re.IGNORECASE),
    ]
    for pat in strict_patterns:
        m = pat.search(text)
        if m:
            return m

    # Patterns 3 & 4: Unicode-aware boundary — check surrounding chars manually
    loose_patterns = [
        re.compile(escaped),
        re.compile(escaped, re.IGNORECASE),
    ]
    for pat in loose_patterns:
        for m in pat.finditer(text):
            start, end = m.start(), m.end()
            before_ok = start == 0 or not text[start - 1].isalnum()
            after_ok = end == len(text) or not text[end].isalnum()
            if before_ok and after_ok:
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


# ── Rule-based extra blanks ───────────────────────────────────────────────────

# Each entry: (pattern_group_label, set_of_forms, options_pool)
# Pattern is matched as whole word (case-insensitive).  options_pool is the
# full list of candidates — 2 distractors are picked randomly from it
# (excluding the matched form).

_RULE_BASED_GROUPS: list[tuple[str, frozenset[str], list[str]]] = [
    # Definite articles
    ("definite_article",
     frozenset({"der", "die", "das", "dem", "den", "des"}),
     ["der", "die", "das", "dem", "den", "des"]),

    # Indefinite articles
    ("indefinite_article",
     frozenset({"ein", "eine", "einen", "einem", "einer", "eines"}),
     ["ein", "eine", "einen", "einem", "einer", "eines"]),

    # Possessive pronouns (all declined forms — common subset)
    ("possessive_pronoun",
     frozenset({
         "mein", "meine", "meinen", "meinem", "meiner", "meines",
         "dein", "deine", "deinen", "deinem", "deiner", "deines",
         "sein", "seine", "seinen", "seinem", "seiner", "seines",
         "ihr", "ihre", "ihren", "ihrem", "ihrer", "ihres",
         "unser", "unsere", "unseren", "unserem", "unserer", "unseres",
         "euer", "eure", "euren", "eurem", "eurer", "eures",
     }),
     ["mein", "meine", "meinen", "meinem", "dein", "deine", "deinen", "sein", "seine", "seinen",
      "ihr", "ihre", "ihren", "unser", "unsere", "unseren", "unserem"]),

    # Reflexive pronouns
    ("reflexive_pronoun",
     frozenset({"mich", "dich", "sich", "uns", "euch", "mir", "dir"}),
     ["mich", "dich", "sich", "uns", "euch", "mir", "dir"]),

    # Modal verbs (conjugated — keep same subject by grouping by person)
    ("modal_ich",
     frozenset({"kann", "muss", "will", "darf", "soll", "mag"}),
     ["kann", "muss", "will", "darf", "soll", "mag"]),
    ("modal_du",
     frozenset({"kannst", "musst", "willst", "darfst", "sollst", "magst"}),
     ["kannst", "musst", "willst", "darfst", "sollst", "magst"]),
    ("modal_er",
     frozenset({"kann", "muss", "will", "darf", "soll", "mag"}),
     # same as ich — handled by context; kept separate for label clarity
     ["kann", "muss", "will", "darf", "soll", "mag"]),
    ("modal_wir",
     frozenset({"können", "müssen", "wollen", "dürfen", "sollen", "mögen", "möchten"}),
     ["können", "müssen", "wollen", "dürfen", "sollen", "mögen", "möchten"]),

    # Simple prepositions
    ("preposition",
     frozenset({
         "mit", "nach", "auf", "für", "in", "an", "zu", "bei", "von",
         "durch", "über", "unter", "vor", "hinter", "neben", "zwischen",
         "seit", "wegen", "trotz", "außer", "gegenüber",
     }),
     ["mit", "nach", "auf", "für", "in", "an", "zu", "bei", "von",
      "durch", "über", "unter", "vor", "hinter", "neben", "zwischen", "seit"]),

    # Preposition contractions
    ("prep_contraction",
     frozenset({"zum", "zur", "ins", "ans", "beim", "im", "am", "aufs", "vom"}),
     ["zum", "zur", "beim", "ins", "ans", "aufs", "im", "am", "vom"]),

    # Da-compounds
    ("da_compound",
     frozenset({
         "darauf", "darüber", "daran", "damit", "dafür", "davon",
         "dabei", "danach", "darin", "davor",
     }),
     ["darauf", "darüber", "daran", "damit", "dafür", "davon", "dabei", "danach", "darin", "davor"]),

    # Subordinating conjunctions
    ("sub_conjunction",
     frozenset({"weil", "dass", "wenn", "obwohl", "damit", "nachdem", "bevor", "während", "falls"}),
     ["weil", "dass", "wenn", "obwohl", "damit", "nachdem", "bevor", "während", "falls"]),
]

# Build a fast lookup: lowercase_form → (label, pool)
_FORM_TO_GROUP: dict[str, tuple[str, list[str]]] = {}
for _label, _forms, _pool in _RULE_BASED_GROUPS:
    for _f in _forms:
        # Don't overwrite — first match wins (definite articles before possessives for "ihr" etc.)
        if _f.lower() not in _FORM_TO_GROUP:
            _FORM_TO_GROUP[_f.lower()] = (_label, _pool)

# Special-case: "ihr/ihre/ihren/ihrem/ihrer/ihres" are possessives, not definite articles
for _poss in ("ihre", "ihren", "ihrem", "ihrer", "ihres"):
    _FORM_TO_GROUP[_poss] = ("possessive_pronoun",
                              ["ihr", "ihre", "ihren", "ihrem", "ihrer", "ihres",
                               "sein", "seine", "seinen", "unser", "unsere"])

# "ihr" by itself is ambiguous (pronoun / possessive) — skip for determinism
_FORM_TO_GROUP.pop("ihr", None)

# Prepositions that are ambiguous short words — exclude to avoid false positives
_SKIP_AMBIGUOUS = frozenset({"in", "an", "auf", "vor", "über", "unter", "nach", "zu"})


# Canonical user-facing categories (groups modal_ich/du/er/wir under one key)
EXTRA_GRAMMAR_CATEGORIES: list[dict] = [
    {"key": "definite_article",   "labels": {"es": "Artículos definidos (der/die/das)", "en": "Definite articles", "de": "Bestimmte Artikel", "fr": "Articles définis"}},
    {"key": "indefinite_article", "labels": {"es": "Artículos indefinidos (ein/eine)", "en": "Indefinite articles", "de": "Unbestimmte Artikel", "fr": "Articles indéfinis"}},
    {"key": "possessive_pronoun", "labels": {"es": "Pronombres posesivos (mein/dein/sein...)", "en": "Possessive pronouns", "de": "Possessivpronomen", "fr": "Pronoms possessifs"}},
    {"key": "reflexive_pronoun",  "labels": {"es": "Pronombres reflexivos (mich/dich/sich...)", "en": "Reflexive pronouns", "de": "Reflexivpronomen", "fr": "Pronoms réfléchis"}},
    {"key": "modal_verbs",        "labels": {"es": "Verbos modales (kann/muss/will...)", "en": "Modal verbs", "de": "Modalverben", "fr": "Verbes modaux"}},
    {"key": "preposition",        "labels": {"es": "Preposiciones simples (mit/auf/für...)", "en": "Simple prepositions", "de": "Präpositionen", "fr": "Prépositions simples"}},
    {"key": "prep_contraction",   "labels": {"es": "Contracciones (zum/zur/im/am...)", "en": "Preposition contractions", "de": "Präpositionalkontraktion", "fr": "Contractions prépositionnelles"}},
    {"key": "da_compound",        "labels": {"es": "Da-compuestos (darauf/damit/dafür...)", "en": "Da-compounds", "de": "Da-Komposita", "fr": "Composés da-"}},
    {"key": "sub_conjunction",    "labels": {"es": "Conjunciones subordinantes (weil/dass/wenn...)", "en": "Subordinating conjunctions", "de": "Unterordnende Konjunktionen", "fr": "Conjonctions de subordination"}},
]

# Map user-facing keys to the internal _RULE_BASED_GROUPS labels they cover
_CATEGORY_TO_LABELS: dict[str, set[str]] = {
    "definite_article":   {"definite_article"},
    "indefinite_article": {"indefinite_article"},
    "possessive_pronoun": {"possessive_pronoun"},
    "reflexive_pronoun":  {"reflexive_pronoun"},
    "modal_verbs":        {"modal_ich", "modal_du", "modal_er", "modal_wir"},
    "preposition":        {"preposition"},
    "prep_contraction":   {"prep_contraction"},
    "da_compound":        {"da_compound"},
    "sub_conjunction":    {"sub_conjunction"},
}


def _inject_rule_based_blanks(
    segments: list[dict],
    existing_blank_words: set[str],
    max_extra: int = 6,
    allowed_categories: list[str] | None = None,
) -> list[dict]:
    """
    Post-process segments: scan text segments for words that match the rule-based
    grammar tables and turn them into additional blanks.

    existing_blank_words: set of lowercase words already blanked by the AI phase.
    max_extra: maximum number of new blanks to inject.

    Strategy:
    - Walk text segments left-to-right.
    - Tokenise each text segment into word-tokens + surrounding punctuation/spaces.
    - For each word-token, check if it's in _FORM_TO_GROUP.
    - Skip words already blanked, skip ambiguous short prepositions if not in focus.
    - Pick 2 random distractors from the pool (excluding the actual form).
    - Replace the text segment with [text_before, blank, text_after] sub-segments.
    - Stop after max_extra new blanks.
    """
    if max_extra <= 0:
        return segments

    # Build the set of allowed internal labels from user-facing category keys
    if allowed_categories:
        allowed_labels: set[str] = set()
        for cat_key in allowed_categories:
            allowed_labels.update(_CATEGORY_TO_LABELS.get(cat_key, set()))
    else:
        # No filter → all labels allowed
        allowed_labels = set()
        for labels in _CATEGORY_TO_LABELS.values():
            allowed_labels.update(labels)

    # Assign starting blank_id from existing blanks
    next_id = max((s.get("id", 0) for s in segments if s.get("t") == "blank"), default=0) + 1
    injected = 0

    # Regex: split a text into (prefix, word, suffix) tokens
    _TOKEN_RE = re.compile(r'(\W*)(\w+)(\W*)')

    result: list[dict] = []

    for seg in segments:
        if seg.get("t") != "text" or injected >= max_extra:
            result.append(seg)
            continue

        text = seg.get("v", "")
        if not text.strip():
            result.append(seg)
            continue

        # Try to find a word in this text segment to blank
        found = False
        pos = 0
        while pos < len(text) and injected < max_extra:
            m = _TOKEN_RE.search(text, pos)
            if not m:
                break
            prefix, word, suffix = m.group(1), m.group(2), m.group(3)
            word_lower = word.lower()

            group_info = _FORM_TO_GROUP.get(word_lower)
            if group_info and word_lower not in existing_blank_words:
                label, pool = group_info
                # Skip if this label is not in the allowed categories
                if label not in allowed_labels:
                    pos = m.end()
                    continue
                # Skip very short ambiguous prepositions unless they're the only option
                if word_lower in _SKIP_AMBIGUOUS and len(word_lower) <= 3:
                    pos = m.end()
                    continue

                # Build 2 distractors from pool
                candidates = [p for p in pool if p.lower() != word_lower]
                if len(candidates) < 2:
                    pos = m.end()
                    continue
                distractors = random.sample(candidates, 2)

                options = [word] + distractors
                random.shuffle(options)
                correct_idx = options.index(word)

                # Split the segment at this word
                before_text = text[:m.start()] + prefix
                after_text = suffix + text[m.end():]

                if before_text:
                    result.append({"t": "text", "v": before_text})

                result.append({
                    "t": "blank",
                    "id": next_id,
                    "options": options,
                    "correct": correct_idx,
                    "rule": f"[{label}] {word}",
                })
                next_id += 1
                injected += 1
                existing_blank_words.add(word_lower)

                # Continue with the rest of the segment as a new text seg
                if after_text:
                    result.append({"t": "text", "v": after_text})

                found = True
                break  # one blank per text segment max (keeps flow readable)
            else:
                pos = m.end()

        if not found:
            result.append(seg)

    return result


# ── Generation modes ──────────────────────────────────────────────────────────

def _generate_two_phase(
    topic: str,
    interface_lang: str,
    grammar_focus: str,
    focus_keys: list[str],
    free_text_focus: list[str],
    model: str,
    timeout: int,
    client: AIClient,
    extra_kwargs: dict,
    correct_prose: bool = True,
    prose_override: Optional[str] = None,
    double_correct: bool = False,
    max_blanks: int = 10,
    cefr_block: str = "",
) -> dict:
    """Phase 1: generate prose. Optional Phase 1b: auto-correct (1 or 2 passes). Phase 2: analyze prose → exercise JSON."""
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")

    # Build conditional prompt sections from the focus keys + free-text items
    prose_focus_guide = _build_prose_focus_guide(focus_keys, free_text_focus)
    step1_instructions = _build_analysis_step1(focus_keys, free_text_focus)
    step2_blocks = _build_analysis_step2(focus_keys, free_text_focus)

    prose_kwargs = {**extra_kwargs, "num_predict": extra_kwargs.get("num_predict", 1024)}
    phase2_kwargs = {**extra_kwargs, "num_predict": max(extra_kwargs.get("num_predict", 0), 8000)}

    if prose_override:
        # Skip Phase 1 — use provided text directly
        prose = prose_override.strip()
        logger.info("[two_phase] Using prose_override (%d chars)", len(prose))
    else:
        # Phase 1 — prose
        logger.info("[two_phase] Phase 1: generating prose for topic=%r focus_keys=%r", topic, focus_keys)
        prose_prompt = PROMPT_GENERATE_PROSE.format_map(_SafeDict(
            topic=topic,
            grammar_focus=grammar_focus,
            cefr_block=cefr_block,
            prose_focus_guide=prose_focus_guide,
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
        step1_instructions=step1_instructions,
        step2_blocks=step2_blocks,
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
    focus_keys: list[str],
    free_text_focus: list[str],
    num_sentences: int,
    model: str,
    timeout: int,
    client: AIClient,
    extra_kwargs: dict,
    double_correct: bool = False,
    cefr_block: str = "",
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

    # Build conditional prompt sections from the focus keys + free-text items
    prose_focus_guide = _build_prose_focus_guide(focus_keys, free_text_focus)
    blank_instructions = _build_rolling_blank_instructions(focus_keys, free_text_focus)

    # ── Phase 1: generate all sentences at once ────────────────────────────────
    logger.info("[rolling] Phase 1: generating %d sentences focus_keys=%r", num_sentences, focus_keys)
    prose_prompt = PROMPT_ROLLING_PROSE.format_map(_SafeDict(
        topic=topic,
        grammar_focus=grammar_focus,
        num_sentences=num_sentences,
        cefr_block=cefr_block,
        prose_focus_guide=prose_focus_guide,
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
            blank_instructions=blank_instructions,
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
            # Prefix \n to separate from previous sentence (frontend splits on \n)
            prefix = "\n" if all_segments else ""
            all_segments.append({"t": "text", "v": prefix + sentence})
            continue

        # Build segments using the robust builder (handles capitalisation etc.)
        sentence_segs = _build_segments_from_blanks(sentence, [blank_data])

        # Re-assign blank IDs globally
        for seg in sentence_segs:
            if seg.get("t") == "blank":
                seg["id"] = blank_id
                blank_id += 1

        # Add \n to the first text segment of this sentence (frontend splits on \n to group by sentence)
        if all_segments and sentence_segs:
            first = sentence_segs[0]
            if first.get("t") == "text":
                sentence_segs[0] = {**first, "v": "\n" + first.get("v", "")}
            else:
                # First segment is a blank — insert a text separator before it
                sentence_segs.insert(0, {"t": "text", "v": "\n"})

        all_segments.extend(sentence_segs)

    if not all_segments:
        raise ValueError("Rolling generation produced no segments")

    if not any(s.get("t") == "blank" for s in all_segments):
        raise ValueError("Rolling generation produced no blanks")

    # ── Grammar notes + title + description + cefr from the corrected prose ─────
    grammar_notes: list[str] = []
    ai_title = topic[:40]
    ai_description: str = ""
    ai_cefr: str = ""
    try:
        notes_prompt = PROMPT_GRAMMAR_NOTES.format_map(_SafeDict(
            prose=full_prose,
            interface_lang=interface_lang_name,
        ))
        raw_notes = _call_client(client, notes_prompt, model, per_sentence_timeout, extra_kwargs)
        if raw_notes:
            notes_json = _fix_common_model_errors(_extract_json(raw_notes))
            parsed_notes = json.loads(notes_json)
            if isinstance(parsed_notes, dict):
                ai_title = str(parsed_notes.get("title", topic[:40]) or topic[:40])
                ai_description = str(parsed_notes.get("description", "") or "")
                ai_cefr = str(parsed_notes.get("cefr_level", "") or "")
                raw_list = parsed_notes.get("notes", [])
                grammar_notes = [str(n) for n in raw_list if n]
            elif isinstance(parsed_notes, list):
                grammar_notes = [str(n) for n in parsed_notes if n]
    except Exception as exc:
        logger.warning("[rolling] Grammar notes generation failed: %s", exc)

    return {
        "title": ai_title,
        "description": ai_description,
        "cefr_level": ai_cefr,
        "topic": topic,
        "segments": all_segments,
        "grammar_notes": grammar_notes,
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
    cefr_level: str = "",
    force_extra_grammar: bool = False,
    extra_grammar_categories: list[str] | None = None,
) -> dict:
    """
    Generate a fill-in-the-blank grammar exercise.

    mode:
      "two_phase"  — Phase 1: prose generation; Phase 2: prose → JSON (default)
      "rolling"    — Iterative sentence-by-sentence with accumulated context
      "custom"     — Uses custom_prompt (original single-shot behavior)
    """
    interface_lang_name = INTERFACE_LANG_NAMES.get(interface_lang, "Spanish")

    # Separate recognised keys (have conditional prompt sections) from free-text focus items
    _KNOWN_KEYS = set(FOCUS_PROSE_GUIDE.keys())
    focus_keys: list[str] = [f for f in (grammar_focus or []) if f in _KNOWN_KEYS]
    free_text_focus: list[str] = [f for f in (grammar_focus or []) if f not in _KNOWN_KEYS]

    # focus_str: human-readable list for prompt text (all items)
    all_focus = focus_keys + free_text_focus
    focus_str = ", ".join(all_focus) if all_focus else "articles, prepositions, word order"
    cefr_block = CEFR_LEVEL_DESCRIPTIONS.get(cefr_level, "Intermediate level (A2-B2): natural everyday German vocabulary and grammar.")

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
            focus_keys=focus_keys,
            free_text_focus=free_text_focus,
            model=model,
            timeout=timeout,
            client=client,
            extra_kwargs=extra_kwargs,
            prose_override=prose_override,
            double_correct=double_correct,
            max_blanks=max_blanks,
            cefr_block=cefr_block,
        )
    elif mode == "rolling":
        data = _generate_rolling(
            topic=topic,
            interface_lang=interface_lang,
            grammar_focus=focus_str,
            focus_keys=focus_keys,
            free_text_focus=free_text_focus,
            num_sentences=rolling_sentences,
            model=model,
            timeout=timeout,
            client=client,
            extra_kwargs=extra_kwargs,
            double_correct=double_correct,
            cefr_block=cefr_block,
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
    data.setdefault("description", "")
    data.setdefault("cefr_level", "")

    # Inject rule-based extra blanks (Python-only, no AI call)
    if force_extra_grammar:
        existing_blanked = {
            opt.lower()
            for seg in data.get("segments", [])
            if seg.get("t") == "blank"
            for opt in [seg["options"][seg.get("correct", 0)]]
        }
        data["segments"] = _inject_rule_based_blanks(
            data["segments"],
            existing_blank_words=existing_blanked,
            max_extra=8,
            allowed_categories=extra_grammar_categories or None,
        )
        logger.info("[force_extra_grammar] Injected extra blanks. Total blanks: %d",
                    sum(1 for s in data["segments"] if s.get("t") == "blank"))

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
