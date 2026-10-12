from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.database.db import get_db
from app.models import Agent, Alert, Event
from app.models.agent import DISABLED, QUARANTINED, RUNNING
from app.sentinel import audit, quarantine

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
def list_alerts(
    db: Session = Depends(get_db),
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    query = db.query(Alert)
    if severity:
        query = query.filter(Alert.severity == severity.upper())
    if status:
        query = query.filter(Alert.status == status.upper())
    return [a.to_dict() for a in query.order_by(Alert.created_at.desc()).limit(limit).all()]


def _admin_action(db: Session, alert_id: str, status: str, admin_action: str, agent_fn=None) -> dict[str, Any]:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, "Alert not found")
    agent = db.get(Agent, alert.agent_id)
    if agent_fn and agent:
        agent_fn(agent)
    alert.status, alert.admin_action, alert.updated_at = status, admin_action, utcnow()
    if agent:
        alert.agent_state = agent.status
    # The admin's response is part of the evidence: append it to the audit trail.
    source = db.get(Event, alert.event_id) if alert.event_id else None
    if source:
        source.admin_action = admin_action
        audit.record(db, source, admin_action=f"{admin_action} by admin", decision=f"ADMIN:{admin_action}")
    db.commit()
    return alert.to_dict()


@router.post("/{alert_id}/acknowledge")
def acknowledge(alert_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _admin_action(db, alert_id, "ACKNOWLEDGED", "ACKNOWLEDGED")


@router.post("/{alert_id}/investigate")
def investigate(alert_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Open an investigation. A still-running agent is put under REVIEW: every action needs approval."""

    def to_review(agent: Agent) -> None:
        if agent.status == RUNNING:
            quarantine.review_agent(db, agent, "Under investigation — all actions require human approval", admin_action="INVESTIGATE")

    return _admin_action(db, alert_id, "INVESTIGATING", "INVESTIGATING", to_review)


@router.post("/{alert_id}/keep-quarantined")
def keep_quarantined(alert_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    def ensure(agent: Agent) -> None:
        if agent.status not in (QUARANTINED, DISABLED):
            quarantine.quarantine_agent(db, agent, "Administrator confirmed quarantine", admin_action="KEEP_QUARANTINED")

    return _admin_action(db, alert_id, "RESOLVED", "KEPT QUARANTINED", ensure)


@router.post("/{alert_id}/restore-agent")
def restore_agent(alert_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    def restore(agent: Agent) -> None:
        if agent.status != RUNNING:
            quarantine.restore_agent(db, agent, "Administrator reviewed the alert and restored the agent", admin_action="RESTORE_AGENT")

    return _admin_action(db, alert_id, "RESOLVED", "AGENT RESTORED", restore)
