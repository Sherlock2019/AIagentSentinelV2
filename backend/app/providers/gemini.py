from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.providers.base import SYSTEM_PROMPT, SafetyProvider, build_user_prompt, extract_json


class GeminiProvider(SafetyProvider):
    name = "gemini"

    def evaluate(self, ctx: dict[str, Any]) -> dict[str, Any]:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent",
            headers={"x-goog-api-key": settings.gemini_api_key},
            json={
                "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": [{"role": "user", "parts": [{"text": build_user_prompt(ctx)}]}],
                "generationConfig": {"responseMimeType": "application/json"},
            },
            timeout=settings.ai_timeout_seconds,
        )
        response.raise_for_status()
        return extract_json(response.json()["candidates"][0]["content"]["parts"][0]["text"])
