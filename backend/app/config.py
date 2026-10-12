"""Runtime configuration, read once from the environment / .env file."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# agentsentinel/ (backend/app/config.py -> parents[2])
ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


class Settings:
    def __init__(self) -> None:
        data_dir = ROOT / "data"
        data_dir.mkdir(exist_ok=True)
        # SQLite by default; set DATABASE_URL=postgresql+psycopg://... for PostgreSQL.
        self.database_url: str = os.getenv("DATABASE_URL") or f"sqlite:///{data_dir / 'agentsentinel.db'}"
        self.ai_provider: str = (os.getenv("AI_PROVIDER") or "mock").strip().lower()
        self.ai_timeout_seconds: float = float(os.getenv("AI_TIMEOUT_SECONDS") or 20)

        self.ollama_url: str = os.getenv("OLLAMA_URL") or "http://127.0.0.1:11434"
        self.ollama_model: str = os.getenv("OLLAMA_MODEL") or "llama3.1"
        self.openai_api_key: str = os.getenv("OPENAI_API_KEY") or ""
        self.openai_model: str = os.getenv("OPENAI_MODEL") or "gpt-4o-mini"
        self.gemini_api_key: str = os.getenv("GEMINI_API_KEY") or ""
        self.gemini_model: str = os.getenv("GEMINI_MODEL") or "gemini-2.0-flash"
        self.anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY") or ""
        self.anthropic_model: str = os.getenv("ANTHROPIC_MODEL") or ""

        # Real webhook delivery happens ONLY when this is explicitly configured.
        self.alert_webhook_url: str = os.getenv("ALERT_WEBHOOK_URL") or ""
        # When true, every external gateway call must carry the agent's session token
        # (recommended as soon as CI runners or anything off-host can reach Sentinel).
        self.require_agent_token: bool = (os.getenv("REQUIRE_AGENT_TOKEN") or "false").strip().lower() in ("1", "true", "yes")
        self.cors_origins: list[str] = [
            o.strip()
            for o in (os.getenv("CORS_ORIGINS") or "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        ]


settings = Settings()
