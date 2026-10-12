from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.agents import enrich
from app.clock import utcnow
from app.config import settings
from app.database.db import get_db
from app.database.seed import seed
from app.database.settings_store import get_settings, update_settings
from app.models import Action, Agent, Alert, Event
from app.models.agent import DISABLED, QUARANTINED
from app.schemas import SettingsUpdate
from app.sentinel import quarantine, risk_engine

router = APIRouter(prefix="/api/system", tags=["system"])

_MODELS = {
    "mock": "deterministic rules (offline)",
    "ollama": settings.ollama_model,
    "openai": settings.openai_model,
    "gemini": settings.gemini_model,
    "anthropic": settings.anthropic_model,
}


def _health_score(agents: list[dict[str, Any]], open_critical: int) -> dict[str, Any]:
    """Fleet health: 100 = nothing wrong. Risk, containment and open criticals all pull it down."""
    if not agents:
        return {"score": 100, "label": "HEALTHY"}
    avg_risk = sum(a["risk_score"] for a in agents) / len(agents)
    contained = sum(1 for a in agents if a["status"] in (QUARANTINED, DISABLED))
    review = sum(1 for a in agents if a["display_status"] == "REVIEW")
    score = max(0, 100 - round(avg_risk * 0.5 + 12 * contained + 5 * open_critical + 3 * review))
    label = "HEALTHY" if score >= 80 else "ELEVATED" if score >= 60 else "AT RISK" if score >= 40 else "CRITICAL"
    return {"score": score, "label": label}


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict[str, Any]:
    agents = [enrich(db, a) for a in db.query(Agent).order_by(Agent.created_at, Agent.name).all()]
    day_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    open_critical = db.query(Alert).filter(Alert.severity == "CRITICAL", Alert.status.in_(("OPEN", "INVESTIGATING"))).count()
    cfg = get_settings(db)
    return {
        "kpis": {
            "active_agents": sum(1 for a in agents if a["status"] in ("RUNNING", "REVIEW")),
            "safe_agents": sum(1 for a in agents if a["display_status"] in ("SAFE", "ACTIVE")),
            "under_review": sum(1 for a in agents if a["display_status"] in ("REVIEW", "WATCH", "PAUSED")),
            "quarantined": sum(1 for a in agents if a["status"] in (QUARANTINED, DISABLED)),
            "blocked_today": db.query(Event).filter(Event.kind == "ACTION", Event.decision == "BLOCK", Event.timestamp >= day_start).count(),
            "critical_alerts": open_critical,
        },
        "health": _health_score(agents, open_critical),
        "agents": agents,
        "pending_approvals": db.query(Action).filter(Action.status == "PENDING_APPROVAL").count(),
        "open_alerts": db.query(Alert).filter(Alert.status == "OPEN").count(),
        "emergency_stop_active": cfg["emergency_stop_active"],
        "ai_provider": settings.ai_provider,
    }


@router.post("/emergency-stop")
def emergency_stop(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Global kill switch. In this POC it only changes simulated agent state."""
    result = quarantine.emergency_stop(db)
    db.commit()
    return {"emergency_stop_active": True, **result}


@router.post("/emergency-stop/release")
def release_emergency_stop(db: Session = Depends(get_db)) -> dict[str, Any]:
    restored = quarantine.release_emergency_stop(db)
    db.commit()
    return {"emergency_stop_active": False, "restored": restored}


@router.post("/reset")
def reset_demo(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Wipe everything and re-seed the reproducible demo dataset."""
    seed(db, reset=True)
    return {"reset": True, "agents": db.query(Agent).count()}


def _settings_view(cfg: dict[str, Any]) -> dict[str, Any]:
    # Deliberately exposes configuration only — never API keys or webhook URLs.
    return {
        **cfg,
        "ai_provider": settings.ai_provider,
        "ai_model": _MODELS.get(settings.ai_provider, "unknown"),
        "mock_mode": settings.ai_provider == "mock",
        "available_providers": list(_MODELS),
        "webhook_configured": bool(settings.alert_webhook_url),
        "database": "sqlite" if settings.database_url.startswith("sqlite") else "postgresql",
        "risk_weights": risk_engine.WEIGHTS,
    }


@router.get("/settings")
def read_settings(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _settings_view(get_settings(db))


@router.put("/settings")
def write_settings(body: SettingsUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    changes = body.model_dump(exclude_none=True)
    merged = {**get_settings(db), **changes}
    if not merged["threshold_medium"] < merged["threshold_high"] < merged["threshold_critical"]:
        raise HTTPException(422, "Risk thresholds must satisfy MEDIUM < HIGH < CRITICAL")
    if "alert_channels" in changes:
        changes["alert_channels"] = {**get_settings(db)["alert_channels"], **changes["alert_channels"], "dashboard": True}
    cfg = update_settings(db, changes)
    db.commit()
    return _settings_view(cfg)
