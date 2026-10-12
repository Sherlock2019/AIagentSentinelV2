from __future__ import annotations

import re
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.database.db import get_db
from app.models import Action, Agent, AgentState, BehaviorHistory, Event, Policy
from app.models.agent import DISABLED, PAUSED, QUARANTINED, REVIEW, RUNNING
from app.schemas import AgentCreate
from app.sentinel import policy_engine, quarantine

router = APIRouter(prefix="/api/agents", tags=["agents"])


def get_agent_or_404(db: Session, agent_id: str) -> Agent:
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(404, f"Agent '{agent_id}' is not registered with Sentinel")
    return agent


def display_status(agent: Agent, pending: int, active: bool) -> str:
    """UI status: containment states first, then review, then live activity."""
    if agent.status in (QUARANTINED, DISABLED, PAUSED):
        return agent.status
    if agent.status == REVIEW or pending:
        return "REVIEW"
    if agent.risk_score >= 30:
        return "WATCH"
    return "ACTIVE" if active else "SAFE"


def enrich(db: Session, agent: Agent) -> dict[str, Any]:
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    per_minute = db.query(BehaviorHistory).filter(BehaviorHistory.agent_id == agent.id, BehaviorHistory.timestamp > now - timedelta(seconds=60)).count()
    blocked = db.query(Event).filter(Event.agent_id == agent.id, Event.kind == "ACTION", Event.decision == "BLOCK", Event.timestamp >= day_start).count()
    pending = db.query(Action).filter(Action.agent_id == agent.id, Action.status == "PENDING_APPROVAL").count()
    active = agent.last_activity is not None and agent.last_activity > now - timedelta(seconds=60)
    return {
        **agent.to_dict(),
        "actions_per_min": per_minute,
        "blocked_today": blocked,
        "pending_approvals": pending,
        "display_status": display_status(agent, pending, active),
    }


@router.get("")
def list_agents(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return [enrich(db, a) for a in db.query(Agent).order_by(Agent.created_at, Agent.name).all()]


@router.post("", status_code=201)
def create_agent(body: AgentCreate, db: Session = Depends(get_db)) -> dict[str, Any]:
    agent_id = re.sub(r"[^a-z0-9]+", "-", re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", body.name.strip()).lower()).strip("-")
    if not agent_id:
        raise HTTPException(422, "Agent name must contain letters or digits")
    if db.get(Agent, agent_id) or db.query(Agent).filter(Agent.name == body.name.strip()).first():
        raise HTTPException(409, f"An agent named '{body.name}' already exists")

    doc = policy_engine.normalize({
        "agent": body.name.strip(),
        "purpose": [body.purpose],
        "allow": body.allowed_tools,
        "require_approval": body.approval_tools,
        "deny": body.denied_tools,
        "resources": {"allow": body.allowed_resources, "deny": body.denied_resources},
        "network": {"allow": body.network_destinations},
        "limits": {"rate_per_minute": body.rate_limit_per_min, "cost_per_minute_usd": body.cost_limit_per_min},
    })
    errors, _ = policy_engine.validate(doc)
    if errors:
        raise HTTPException(422, {"message": "Invalid policy", "errors": errors})

    agent = Agent(
        id=agent_id, name=body.name.strip(), purpose=body.purpose, owner=body.owner, environment=body.environment,
        risk_sensitivity=body.risk_sensitivity, session_token=quarantine.new_session_token(),
    )
    db.add(agent)
    db.add(Policy(agent_id=agent_id, doc=doc))
    db.add(AgentState(agent_id=agent_id, from_state="NEW", to_state=RUNNING, reason="Agent registered with declared intent", actor="admin"))
    db.commit()
    return enrich(db, agent)


@router.get("/{agent_id}")
def get_agent(agent_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    agent = get_agent_or_404(db, agent_id)
    policy = db.get(Policy, agent_id)
    states = db.query(AgentState).filter(AgentState.agent_id == agent_id).order_by(AgentState.id.desc()).limit(15).all()
    events = db.query(Event).filter(Event.agent_id == agent_id).order_by(Event.timestamp.desc()).limit(12).all()
    return {
        **enrich(db, agent),
        "policy": policy.doc if policy else None,
        "state_history": [s.to_dict() for s in states],
        "recent_events": [e.summary() for e in events],
    }


def _control(agent_id: str, db: Session, fn, allowed_from: tuple[str, ...], verb: str) -> dict[str, Any]:
    agent = get_agent_or_404(db, agent_id)
    if agent.status not in allowed_from:
        raise HTTPException(409, f"Cannot {verb} an agent that is {agent.status}")
    fn(db, agent)
    db.commit()
    return enrich(db, agent)


@router.post("/{agent_id}/pause")
def pause(agent_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _control(agent_id, db, quarantine.pause_agent, (RUNNING, REVIEW), "pause")


@router.post("/{agent_id}/resume")
def resume(agent_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Resume a paused agent, or restore a quarantined / disabled one with a fresh session."""
    return _control(agent_id, db, quarantine.restore_agent, (PAUSED, REVIEW, QUARANTINED, DISABLED), "resume")


@router.post("/{agent_id}/quarantine")
def quarantine_(agent_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _control(agent_id, db, quarantine.quarantine_agent, (RUNNING, REVIEW, PAUSED), "quarantine")


@router.post("/{agent_id}/kill")
def kill(agent_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _control(agent_id, db, quarantine.kill_agent, (RUNNING, REVIEW, PAUSED, QUARANTINED), "kill")
