"""Agent containment: pause, quarantine, kill, restore, and the global emergency stop.

In this POC containment only changes simulated state: the agent's status, its
demo session token and its pending simulated actions. No real infrastructure is
touched.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.clock import new_id, utcnow
from app.database.settings_store import get_settings, update_settings
from app.models import Action, Agent, AgentState, BehaviorHistory, Event
from app.models.agent import DISABLED, PAUSED, QUARANTINED, REVIEW, RUNNING
from app.sentinel import alerts, audit

_EVENT_SEVERITY = {QUARANTINED: "CRITICAL", DISABLED: "CRITICAL", PAUSED: "HIGH", REVIEW: "MEDIUM", RUNNING: "LOW"}
_VERB = {QUARANTINED: "quarantined", DISABLED: "killed (disabled)", PAUSED: "paused", REVIEW: "placed under review", RUNNING: "restored to RUNNING"}


def new_session_token() -> str:
    return new_id("sess")


def cancel_pending(db: Session, agent_id: str, why: str) -> int:
    pending = db.query(Action).filter(Action.agent_id == agent_id, Action.status == "PENDING_APPROVAL").all()
    for action in pending:
        action.status = "CANCELLED"
        action.resolved_at = utcnow()
        action.result = {"cancelled": why}
    return len(pending)


def _transition(
    db: Session,
    agent: Agent,
    to_state: str,
    reason: str,
    actor: str,
    at: Optional[datetime] = None,
    scenario: Optional[str] = None,
    admin_action: Optional[str] = None,
) -> Event:
    at = at or utcnow()
    from_state = agent.status
    agent.status = to_state
    responses = [f"AGENT {to_state}"]

    if to_state in (QUARANTINED, DISABLED):
        # Contain: revoke the session and cancel anything still waiting to run.
        agent.session_token = None
        cancelled = cancel_pending(db, agent.id, f"agent {to_state.lower()}")
        responses.append("SESSION REVOKED")
        if cancelled:
            responses.append(f"{cancelled} PENDING ACTION(S) CANCELLED")
    elif to_state == RUNNING:
        if agent.session_token is None:
            agent.session_token = new_session_token()
            responses.append("NEW SESSION ISSUED")
        if from_state in (QUARANTINED, DISABLED):
            # Fresh session: the strike counter and anomaly window start over.
            db.query(BehaviorHistory).filter(BehaviorHistory.agent_id == agent.id, BehaviorHistory.baseline.is_(False)).delete()
            agent.risk_score = 0
            agent.current_task = "Idle"

    db.add(AgentState(agent_id=agent.id, from_state=from_state, to_state=to_state, reason=reason, actor=actor, timestamp=at))
    event = Event(
        id=new_id("evt"),
        kind="SYSTEM",
        agent_id=agent.id,
        agent_name=agent.name,
        agent_purpose=agent.purpose,
        timestamp=at,
        decision="INFO",
        severity=_EVENT_SEVERITY[to_state],
        risk_score=agent.risk_score,
        reasons=[reason],
        response_actions=responses,
        quarantined=to_state == QUARANTINED,
        agent_status_after=to_state,
        scenario=scenario,
        message=f"Agent {_VERB[to_state]} by {actor}: {reason}",
        admin_action=admin_action,
    )
    db.add(event)
    audit.record(db, event, admin_action=admin_action or (f"{to_state} by {actor}" if actor != "sentinel" else None), decision=f"STATE:{to_state}")
    return event


def pause_agent(db: Session, agent: Agent, reason: str = "Paused by administrator", actor: str = "admin", **kw) -> Event:
    return _transition(db, agent, PAUSED, reason, actor, **kw)


def review_agent(db: Session, agent: Agent, reason: str = "Under investigation", actor: str = "admin", **kw) -> Event:
    return _transition(db, agent, REVIEW, reason, actor, **kw)


def quarantine_agent(db: Session, agent: Agent, reason: str = "Quarantined by administrator", actor: str = "admin", **kw) -> Event:
    return _transition(db, agent, QUARANTINED, reason, actor, **kw)


def kill_agent(db: Session, agent: Agent, reason: str = "Killed by administrator", actor: str = "admin", **kw) -> Event:
    return _transition(db, agent, DISABLED, reason, actor, **kw)


def restore_agent(db: Session, agent: Agent, reason: str = "Restored by administrator", actor: str = "admin", **kw) -> Event:
    return _transition(db, agent, RUNNING, reason, actor, **kw)


def reset_runtime(db: Session, agent: Agent) -> None:
    """Start a clean simulated session (used before each red-team scenario so results are reproducible)."""
    cancel_pending(db, agent.id, "session reset")
    db.query(BehaviorHistory).filter(BehaviorHistory.agent_id == agent.id, BehaviorHistory.baseline.is_(False)).delete()
    if agent.status != RUNNING:
        db.add(AgentState(agent_id=agent.id, from_state=agent.status, to_state=RUNNING, reason="Session reset for red-team scenario", actor="redteam-lab", timestamp=utcnow()))
    agent.status = RUNNING
    agent.session_token = new_session_token()
    agent.risk_score = 0
    db.flush()


def emergency_stop(db: Session, actor: str = "admin") -> dict:
    """Global kill switch: every agent is disabled and the gateway refuses all calls."""
    update_settings(db, {"emergency_stop_active": True})
    now = utcnow()
    stopped = []
    for offset, agent in enumerate(db.query(Agent).order_by(Agent.name).all()):
        # Quarantined agents are already contained; keep that state (and its cause) intact.
        if agent.status not in (DISABLED, QUARANTINED):
            _transition(db, agent, DISABLED, "EMERGENCY STOP — all agents disabled", actor, at=now + timedelta(milliseconds=offset), admin_action="EMERGENCY_STOP")
            stopped.append(agent.name)
    alert = alerts.create_alert(
        db,
        agent_id="*",
        agent_name="ALL AGENTS",
        severity="CRITICAL",
        title="EMERGENCY STOP activated — all agents disabled",
        channels=get_settings(db)["alert_channels"],
        reasons=[f"Global kill switch triggered by {actor}"],
        sentinel_response=["ALL AGENTS DISABLED", "ALL SESSIONS REVOKED", "GATEWAY REFUSING ALL ACTIONS"],
        agent_state=DISABLED,
    )
    alert.admin_action = "EMERGENCY_STOP"
    return {"stopped": stopped, "alert_id": alert.id}


def release_emergency_stop(db: Session, actor: str = "admin") -> list[str]:
    update_settings(db, {"emergency_stop_active": False})
    restored = []
    now = utcnow()
    for offset, agent in enumerate(db.query(Agent).order_by(Agent.name).all()):
        last = db.query(AgentState).filter(AgentState.agent_id == agent.id).order_by(AgentState.id.desc()).first()
        # Only bring back agents the emergency stop disabled — not ones quarantined for cause.
        if agent.status == DISABLED and last and last.reason.startswith("EMERGENCY STOP"):
            _transition(db, agent, RUNNING, "Emergency stop released", actor, at=now + timedelta(milliseconds=offset), admin_action="EMERGENCY_RELEASE")
            restored.append(agent.name)
    return restored
