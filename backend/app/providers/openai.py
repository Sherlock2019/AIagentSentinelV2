from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.providers.base import SYSTEM_PROMPT, SafetyProvider, build_user_prompt, extract_json


class OpenAIProvider(SafetyProvider):
    name = "openai"

    def evaluate(self, ctx: dict[str, Any]) -> dict[str, Any]:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        response = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={
                "model": settings.openai_model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(ctx)},
                ],
            },
            timeout=settings.ai_timeout_seconds,
        )
        response.raise_for_status()
        return extract_json(response.json()["choices"][0]["message"]["content"])
