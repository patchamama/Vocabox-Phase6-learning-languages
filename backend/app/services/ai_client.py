"""
ai_client.py — Abstract AI client + provider implementations.

Supports: Ollama, OpenAI (+ OpenAI-compatible endpoints), Anthropic, Gemini, Azure OpenAI.
All implementations use only the stdlib (urllib) — no extra pip deps.
"""

import json
import logging
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)


class AIClient(ABC):
    """Abstract AI completion client — complete(prompt, model, timeout) → str"""

    @abstractmethod
    def complete(self, prompt: str, model: str, timeout: int) -> str:
        """Send prompt, return text response. Raises on failure."""
        ...

    @abstractmethod
    def is_available(self, timeout: int = 5) -> bool:
        """Quick connectivity/auth check."""
        ...


class OllamaClient(AIClient):
    """Ollama local LLM via /api/generate."""

    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url.rstrip("/")

    def complete(self, prompt: str, model: str, timeout: int) -> str:
        payload = json.dumps({
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.4, "top_p": 0.9, "num_predict": 2500},
        }).encode()
        req = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            return data.get("response", "").strip()

    def is_available(self, timeout: int = 5) -> bool:
        try:
            urllib.request.urlopen(f"{self.base_url}/api/tags", timeout=timeout)
            return True
        except Exception:
            return False


class OpenAIClient(AIClient):
    """
    OpenAI Chat Completions API.
    Also works with any OpenAI-compatible endpoint (LM Studio, vLLM, Together AI,
    Groq, Perplexity, Mistral, etc.) — just set base_url accordingly.
    """

    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def complete(self, prompt: str, model: str, timeout: int) -> str:
        payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.4,
            "max_tokens": 2500,
        }).encode()
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"].strip()

    def is_available(self, timeout: int = 5) -> bool:
        try:
            req = urllib.request.Request(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            urllib.request.urlopen(req, timeout=timeout)
            return True
        except Exception:
            return False


class AnthropicClient(AIClient):
    """Anthropic Messages API (claude-3-*, claude-sonnet-*, etc.)."""

    def __init__(self, api_key: str):
        self.api_key = api_key

    def complete(self, prompt: str, model: str, timeout: int) -> str:
        payload = json.dumps({
            "model": model,
            "max_tokens": 2500,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            return data["content"][0]["text"].strip()

    def is_available(self, timeout: int = 5) -> bool:
        try:
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
            )
            urllib.request.urlopen(req, timeout=timeout)
            return True
        except Exception:
            return False


class GeminiClient(AIClient):
    """Google Generative AI (Gemini) REST API."""

    def __init__(self, api_key: str):
        self.api_key = api_key

    def complete(self, prompt: str, model: str, timeout: int) -> str:
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 2500},
        }).encode()
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={self.api_key}"
        )
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()

    def is_available(self, timeout: int = 5) -> bool:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}"
            urllib.request.urlopen(url, timeout=timeout)
            return True
        except Exception:
            return False


def build_client_from_provider(provider) -> AIClient:
    """Build an AIClient instance from an AIProvider ORM object."""
    t = provider.provider_type
    if t == "openai":
        return OpenAIClient(
            api_key=provider.api_key or "",
            base_url=provider.base_url or "https://api.openai.com/v1",
        )
    if t == "anthropic":
        return AnthropicClient(api_key=provider.api_key or "")
    if t == "gemini":
        return GeminiClient(api_key=provider.api_key or "")
    if t == "azure":
        # Azure OpenAI: base_url is the full deployment endpoint
        return OpenAIClient(
            api_key=provider.api_key or "",
            base_url=provider.base_url or "",
        )
    if t == "openai_compat":
        # Generic OpenAI-compatible (LM Studio, Groq, Mistral, etc.)
        return OpenAIClient(
            api_key=provider.api_key or "none",
            base_url=provider.base_url or "",
        )
    # Default: ollama
    return OllamaClient(base_url=provider.base_url or "http://localhost:11434")


def get_active_client_and_model(user_id: int, db) -> Optional[tuple[AIClient, str]]:
    """
    Look up the user's active AI provider in the DB.
    Returns (client, model_name) or None if no active provider configured.
    """
    from ..models.ai_provider import AIProvider
    p = (
        db.query(AIProvider)
        .filter(AIProvider.user_id == user_id, AIProvider.is_active.is_(True))
        .first()
    )
    if p is None:
        return None
    return build_client_from_provider(p), p.model_name
