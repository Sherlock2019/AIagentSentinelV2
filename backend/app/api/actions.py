from __future__ import annotations

from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.database.db import get_db
from app.models import Action, Agent, Event
from app.models.agent import REVIEW, RUNNING
from app.schemas import InterceptRequest
from app.sentinel import gateway

router = APIRouter(prefix="/api", tags=["actions"])


@router.post("/actions/intercept")
def intercept(body: InterceptRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """THE gateway endpoint: every agent tool call is submitted here before it runs."""
    try:
        return gateway.intercept(db, body)
    except gateway.AgentNotFound:
        # Unknown identities never reach a tool.
        raise HTTPException(404, f"Agent '{body.agent_id}' is not registered with Sentinel — action refused")


@router.get("/actions/pending")
def pending_actions(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    names = {a.id: a.name for a in db.query(Agent).all()}
    rows = db.query(Action).filter(Action.status == "PENDING_APPROVAL").order_by(Action.timestamp.desc()).all()
    return [{**a.to_dict(), "agent_name": names.get(a.agent_id, a.agent_id)} for a in rows]


@router.get("/actions/{action_id}")
def get_action(action_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Status of one action. CI jobs poll this while they wait for a human decision."""
    action = db.get(Action, action_id)
    if action is None:
        raise HTTPException(404, "Action not found")
    return action.to_dict()


def _resolve(action_id: str, approve: bool, db: Session) -> dict[str, Any]:
    action = db.get(Action, action_id)
    if action is None:
        raise HTTPException(404, "Action not found")
    if action.status != "PENDING_APPROVAL":
        raise HTTPException(409, f"Action is {action.status}, not pending approval")
    agent = db.get(Agent, action.agent_id)
    if approve and (agent is None or agent.status not in (RUNNING, REVIEW)):
        raise HTTPException(409, f"Cannot approve: agent is {agent.status if agent else 'missing'}")
    return gateway.resolve_approval(db, action, approve)


@router.post("/actions/{action_id}/approve")
def approve(action_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _resolve(action_id, True, db)


@router.post("/actions/{action_id}/reject")
def reject(action_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _resolve(action_id, False, db)


@router.get("/events")
def list_events(
    db: Session = Depends(get_db),
    agent_id: Optional[str] = None,
    decision: Optional[str] = None,
    severity: Optional[str] = None,
    tool: Optional[str] = None,
    kind: Optional[str] = None,
    since_minutes: Optional[int] = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    query = db.query(Event)
    if agent_id:
        query = query.filter(Event.agent_id == agent_id)
    if decision:
        query = query.filter(Event.decision == decision.upper())
    if severity:
        query = query.filter(Event.severity == severity.upper())
    if tool:
        query = query.filter(Event.tool.contains(tool))
    if kind:
        query = query.filter(Event.kind == kind.upper())
    if since_minutes:
        query = query.filter(Event.timestamp > utcnow() - timedelta(minutes=since_minutes))
    return [e.summary() for e in query.order_by(Event.timestamp.desc()).limit(limit).all()]


@router.get("/events/{event_id}")
def get_event(event_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    return event.to_dict()
