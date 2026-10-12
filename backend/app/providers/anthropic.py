from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.providers.base import SYSTEM_PROMPT, SafetyProvider, build_user_prompt, extract_json


class AnthropicProvider(SafetyProvider):
    """Claude via the Messages API (plain HTTP, so no extra SDK dependency)."""

    name = "anthropic"

    def evaluate(self, ctx: dict[str, Any]) -> dict[str, Any]:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        response = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.anthropic_model,
                "max_tokens": 600,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": build_user_prompt(ctx)}],
            },
            timeout=settings.ai_timeout_seconds,
        )
        response.raise_for_status()
        text = "".join(block.get("text", "") for block in response.json()["content"] if block.get("type") == "text")
        return extract_json(text)
