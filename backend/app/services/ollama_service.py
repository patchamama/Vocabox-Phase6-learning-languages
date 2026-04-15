"""
ollama_service.py — Ollama LLM integration for translation.

Detects if Ollama is running locally and uses a chosen model
to auto-translate words when no existing translation exists.
"""

import json
import logging
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

OLLAMA_BASE = "http://localhost:11434"


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

    prompt = f"""You are an expert multilingual translator and linguist with deep knowledge of vocabulary, grammar, and nuance across European and world languages.

Your task: Translate the following word or short phrase into {target_lang_name}.

Word ({word_lang_name}): {word}
Known translation ({known_lang_name}): {known_translation}

Rules:
- Provide ONLY the translated word or short phrase in {target_lang_name}. No explanations, no punctuation, no extra text.
- Use the most common, natural translation for everyday vocabulary.
- If it is a noun, use the standard dictionary form (with article if applicable in that language).
- Consider the known translation as context to disambiguate meaning.
- Output exactly one word or short phrase.

Translation ({target_lang_name}):"""

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
        with urllib.request.urlopen(req, timeout=30) as resp:
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
