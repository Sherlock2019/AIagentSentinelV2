"""AgentSentinel API — AI Agent Runtime Safety Guard (POC)."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api import actions, agents, alerts, audit, integrations, metrics, policies, redteam, system
from app.api.policies import export_policy_file
from app.config import settings
from app.database.db import SessionLocal, get_db
from app.database.seed import seed
from app.models import Policy


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with SessionLocal() as db:
        seed(db)  # creates tables; seeds demo data on first run only
        for policy in db.query(Policy).all():
            export_policy_file(policy.agent_id, policy.doc)
    yield


app = FastAPI(
    title="AgentSentinel",
    description="AI Agent Runtime Safety Guard — policy enforcement, runtime monitoring, LLM safety evaluation, automatic quarantine and admin alerts.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

for module in (agents, actions, alerts, policies, audit, metrics, redteam, system, integrations):
    app.include_router(module.router)


@app.exception_handler(SQLAlchemyError)
async def database_error(_request, exc: SQLAlchemyError) -> JSONResponse:
    # Fail closed: if Sentinel cannot record a decision, nothing is allowed through.
    return JSONResponse(status_code=503, content={"detail": f"Database unavailable — action refused ({type(exc).__name__})"})


@app.get("/health", tags=["system"])
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
        database = "online"
    except SQLAlchemyError:
        database = "offline"
    return {
        "status": "healthy" if database == "online" else "degraded",
        "gateway": "online",
        "database": database,
        "ai_provider": settings.ai_provider,
    }
