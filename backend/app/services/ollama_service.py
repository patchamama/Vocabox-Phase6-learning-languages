"""
ollama_service.py — Ollama LLM integration for translation.

Detects if Ollama is running locally and uses a chosen model
to auto-translate words when no existing translation exists.
"""

import json
import logging
import re
import urllib.request
import urllib.error
from typing import Optional

from .ai_client import AIClient

logger = logging.getLogger(__name__)

OLLAMA_BASE = "http://localhost:11434"

# ── Default prompt templates (use {variable} placeholders) ───────────────────
# These are the built-in prompts. Users can override them via settings.
# translate() variables : {word}, {src_lang}, {dst_lang}, {known_translation}, {known_lang}
# enhance_word() variables: {word}, {translation}, {src_lang}, {dst_lang}, {extra_field}

DEFAULT_PROMPT_TRANSLATE = """\
You are an expert multilingual translator and linguist with deep knowledge of vocabulary, grammar, and nuance across European and world languages.

Your task: Translate the following word or short phrase into {dst_lang}.

Word ({src_lang}): {word}
Known translation ({known_lang}): {known_translation}

Rules:
- Provide ONLY the translated word or short phrase in {dst_lang}. No explanations, no punctuation, no extra text.
- Use the most common, natural translation for everyday vocabulary.
- If it is a noun, use the standard dictionary form (with article if applicable in that language).
- Consider the known translation as context to disambiguate meaning.
- Output exactly one word or short phrase.

Translation ({dst_lang}):"""

DEFAULT_PROMPT_ENHANCE = """\
You are an expert multilingual linguist and vocabulary teacher.

Analyze the vocabulary entry below and return a JSON object with corrections and enrichments.

Source word ({src_lang}): {word}
Current translation ({dst_lang}): {translation}

Return a JSON object with EXACTLY these fields:
- "palabra": The corrected and enriched source word in {src_lang}. Rules:
  * German nouns: add the definite article (der/die/das) in nominative if missing; capitalize the noun.
  * French/Italian/Spanish/Portuguese nouns: add the definite article if it is natural.
  * After the corrected word, append " | " followed by: word type in {src_lang} | plural form (if noun) | one brief context word.
  * Examples: "der Hund | Substantiv | die Hunde | Tier", "le chien | nom | les chiens | animal", "laufen | Verb | läuft, lief, gelaufen"
  * For non-noun verbs or adjectives: skip plural, include conjugation hints or forms instead.
  * Keep the total short.
- "significado": The best translation in {dst_lang}. For nouns, include the definite article if natural in {dst_lang}. One word or short phrase only.
- "category": Exactly one of: noun, verb, adjective, phrase, prep, adverb
{extra_field}
Return ONLY a valid JSON object. No markdown code blocks, no explanations, no extra text."""


class _SafeDict(dict):
    """dict subclass that returns {key} for missing keys in str.format_map."""
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def get_status() -> dict:
    """
    Check if Ollama is running and return available models.
    Returns: {running: bool, models: list[str]}
    """
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE}/api/tags")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            models = [m["name"] for m in data.get("models", [])]
            return {"running": True, "models": models}
    except Exception:
        return {"running": False, "models": []}


def translate(
    word: str,
    word_lang: str,
    known_translation: str,
    known_lang: str,
    target_lang: str,
    model: str,
    timeout: int = 60,
    prompt_override: str | None = None,
) -> str | None:
    """
    Use Ollama to translate `word` from `word_lang` into `target_lang`.
    Provides context via the known translation in `known_lang`.

    Returns the translated text, or None on failure.
    """
    lang_names = {
        "de": "German",
        "es": "Spanish",
        "en": "English",
        "fr": "French",
        "it": "Italian",
        "pt": "Portuguese",
        "nl": "Dutch",
        "ru": "Russian",
        "ja": "Japanese",
        "zh": "Chinese",
        "ko": "Korean",
        "pl": "Polish",
        "sv": "Swedish",
        "tr": "Turkish",
        "ar": "Arabic",
    }

    word_lang_name = lang_names.get(word_lang[:2], word_lang)
    known_lang_name = lang_names.get(known_lang[:2], known_lang)
    target_lang_name = lang_names.get(target_lang[:2], target_lang)

    template = prompt_override if prompt_override else DEFAULT_PROMPT_TRANSLATE
    prompt = template.format_map(_SafeDict(
        word=word,
        src_lang=word_lang_name,
        dst_lang=target_lang_name,
        known_translation=known_translation,
        known_lang=known_lang_name,
    ))

    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "top_p": 0.9,
            "num_predict": 30,
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
            result = data.get("response", "").strip()
            # Clean up: remove quotes, leading/trailing whitespace, newlines
            result = result.strip('"\'').strip().split("\n")[0].strip()
            if result:
                logger.info(
                    "Ollama translate: %r (%s) → %r (%s) via %s",
                    word, word_lang, result, target_lang, model,
                )
                return result
    except Exception as exc:
        logger.warning("Ollama translate failed for %r → %s: %s", word, target_lang, exc)

    return None


LANG_NAMES = {
    "de": "German",
    "es": "Spanish",
    "en": "English",
    "fr": "French",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "ru": "Russian",
    "ja": "Japanese",
    "zh": "Chinese",
    "ko": "Korean",
    "pl": "Polish",
    "sv": "Swedish",
    "tr": "Turkish",
    "ar": "Arabic",
}


def enhance_word(
    palabra: str,
    significado: str,
    idioma_origen: str,
    idioma_destino: str,
    model: str,
    extra_langs: list[str] | None = None,
    timeout: int = 60,
    prompt_override: str | None = None,
    ai_client: Optional[AIClient] = None,
) -> dict | None:
    """
    Use Ollama to analyze and enrich a vocabulary entry.

    Returns a dict with:
      - palabra: corrected word with language-specific fixes + pipe-separated extra info
      - significado: improved translation
      - category: word type (noun/verb/adjective/phrase/prep/adverb)
      - extra_translations: list of {idioma, texto} for requested extra languages
    Returns None on failure.
    """
    src_name = LANG_NAMES.get(idioma_origen[:2], idioma_origen)
    dst_name = LANG_NAMES.get(idioma_destino[:2], idioma_destino)

    extra_field = ""
    if extra_langs:
        langs_list = ", ".join(
            f"{LANG_NAMES.get(l[:2], l)} ({l})" for l in extra_langs
        )
        extra_field = (
            f'- "extra_translations": Array of objects with "idioma" (language code) and '
            f'"texto" (translation in that language, include definite article if natural). '
            f'Provide translations for: {langs_list}\n'
        )
    else:
        extra_field = '- "extra_translations": []\n'

    template = prompt_override if prompt_override else DEFAULT_PROMPT_ENHANCE
    prompt = template.format_map(_SafeDict(
        word=palabra,
        translation=significado,
        src_lang=src_name,
        dst_lang=dst_name,
        extra_field=extra_field.strip(),
    ))

    try:
        if ai_client is not None:
            raw = ai_client.complete(prompt, model, timeout)
        else:
            payload = json.dumps({
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.1, "top_p": 0.9, "num_predict": 200},
            }).encode()
            req = urllib.request.Request(
                f"{OLLAMA_BASE}/api/generate",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
                raw = data.get("response", "").strip()

        if raw:
            # Strip markdown code fences if present
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            raw = raw.strip()
            # Extract first JSON object
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if not match:
                logger.warning("enhance_word: no JSON found in response for %r", palabra)
                return None
            result = json.loads(match.group(0))
            logger.info("enhance_word: %r → %r", palabra, result)
            return result
    except json.JSONDecodeError as exc:
        logger.warning("enhance_word: JSON parse error for %r: %s", palabra, exc)
    except Exception as exc:
        logger.warning("enhance_word: failed for %r: %s", palabra, exc)

    return None


def get_default_prompts() -> dict:
    """Return the built-in prompt templates so the frontend can display them."""
    return {
        "translate": DEFAULT_PROMPT_TRANSLATE,
        "enhance": DEFAULT_PROMPT_ENHANCE,
    }
