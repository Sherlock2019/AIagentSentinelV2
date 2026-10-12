from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.providers.base import SYSTEM_PROMPT, SafetyProvider, build_user_prompt, extract_json


class OllamaProvider(SafetyProvider):
    """Local model via Ollama — keeps evaluation data on the machine."""

    name = "ollama"

    def evaluate(self, ctx: dict[str, Any]) -> dict[str, Any]:
        response = httpx.post(
            f"{settings.ollama_url.rstrip('/')}/api/chat",
            json={
                "model": settings.ollama_model,
                "stream": False,
                "format": "json",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(ctx)},
                ],
            },
            timeout=settings.ai_timeout_seconds,
        )
        response.raise_for_status()
        return extract_json(response.json()["message"]["content"])
