"""Provider registry. AI_PROVIDER selects one; mock is the default."""
from __future__ import annotations

from typing import Optional

from app.config import settings
from app.providers.anthropic import AnthropicProvider
from app.providers.base import SafetyProvider
from app.providers.gemini import GeminiProvider
from app.providers.mock import MockProvider
from app.providers.ollama import OllamaProvider
from app.providers.openai import OpenAIProvider

PROVIDERS: dict[str, type[SafetyProvider]] = {
    "mock": MockProvider,
    "ollama": OllamaProvider,
    "openai": OpenAIProvider,
    "gemini": GeminiProvider,
    "anthropic": AnthropicProvider,
}

_override: Optional[SafetyProvider] = None


def set_provider_override(provider: Optional[SafetyProvider]) -> None:
    """Test hook: force a specific provider instance (None restores AI_PROVIDER)."""
    global _override
    _override = provider


def get_provider() -> SafetyProvider:
    if _override is not None:
        return _override
    return PROVIDERS.get(settings.ai_provider, MockProvider)()
