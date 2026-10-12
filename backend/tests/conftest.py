"""Test fixtures. An isolated SQLite file and the mock provider are forced BEFORE the app is imported."""
import os
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="agentsentinel-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["AI_PROVIDER"] = "mock"
os.environ["ALERT_WEBHOOK_URL"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database.db import SessionLocal  # noqa: E402
from app.database.seed import seed  # noqa: E402
from app.main import app  # noqa: E402
from app.providers import set_provider_override  # noqa: E402
from app.schemas import InterceptRequest  # noqa: E402
from app.sentinel import gateway  # noqa: E402


@pytest.fixture()
def db():
    """Fresh, fully seeded database for every test."""
    session = SessionLocal()
    seed(session, reset=True)
    yield session
    set_provider_override(None)
    session.close()


@pytest.fixture()
def client(db):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def call(db):
    """Submit one action through the gateway, exactly as an agent would."""

    def _call(agent_id: str, tool: str, resource: str = "", task: str = "test task", **kwargs):
        return gateway.intercept(db, InterceptRequest(agent_id=agent_id, tool=tool, resource=resource, task=task, **kwargs))

    return _call
