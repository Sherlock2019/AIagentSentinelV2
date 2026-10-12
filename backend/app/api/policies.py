from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.agents import get_agent_or_404
from app.clock import new_id, utcnow
from app.config import ROOT
from app.database.db import get_db
from app.models import Agent, Event, Policy
from app.schemas import PolicyUpdate
from app.sentinel import audit, capability_engine, policy_engine
from app.simulator.demo_tools import RESOURCE_CLASSES, TOOLS

router = APIRouter(prefix="/api", tags=["policies"])


def export_policy_file(agent_id: str, doc: dict[str, Any]) -> None:
    """Keep a human-readable YAML copy under data/policies/ (best effort)."""
    try:
        folder = ROOT / "data" / "policies"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{agent_id}.yaml").write_text(policy_engine.to_yaml(doc), encoding="utf-8")
    except OSError:
        pass


def _check(body: PolicyUpdate, agent_name: str) -> dict[str, Any]:
    """Parse + validate a policy submitted as YAML text or as a structured document."""
    if body.yaml is not None:
        doc, errors = policy_engine.parse_yaml(body.yaml)
    elif body.policy is not None:
        doc, errors = body.policy, []
    else:
        doc, errors = None, ["Provide either 'yaml' or 'policy'."]
    warnings: list[str] = []
    if doc is not None:
        doc = {**doc, "agent": doc.get("agent") or agent_name}
        errors, warnings = policy_engine.validate(doc)
        if not errors and doc["agent"] != agent_name:
            errors.append(f"'agent' must be '{agent_name}' — a policy cannot be re-pointed at another agent.")
    if errors or doc is None:
        return {"valid": False, "errors": errors, "warnings": warnings, "policy": None, "yaml": body.yaml}
    normalized = policy_engine.normalize(doc)
    return {"valid": True, "errors": [], "warnings": warnings, "policy": normalized, "yaml": policy_engine.to_yaml(normalized)}


@router.get("/policies")
def list_policies(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    names = {a.id: a for a in db.query(Agent).all()}
    return [
        {**p.to_dict(), "agent_name": names[p.agent_id].name, "agent_purpose": names[p.agent_id].purpose, "yaml": policy_engine.to_yaml(p.doc)}
        for p in db.query(Policy).all()
        if p.agent_id in names
    ]


@router.post("/policies/{agent_id}/validate")
def validate_policy(agent_id: str, body: PolicyUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _check(body, get_agent_or_404(db, agent_id).name)


@router.put("/policies/{agent_id}")
def update_policy(agent_id: str, body: PolicyUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Only administrators change policy, through this endpoint. Agents cannot: the
    'update_policy' tool is a simulated attack that the gateway blocks."""
    agent = get_agent_or_404(db, agent_id)
    result = _check(body, agent.name)
    if not result["valid"]:
        raise HTTPException(422, {"message": "Invalid policy — not saved", "errors": result["errors"]})

    policy = db.get(Policy, agent_id)
    if policy is None:
        policy = Policy(agent_id=agent_id, doc=result["policy"], version=0)
        db.add(policy)
    policy.doc, policy.version, policy.updated_at = result["policy"], policy.version + 1, utcnow()
    event = Event(
        id=new_id("evt"), kind="SYSTEM", agent_id=agent.id, agent_name=agent.name, agent_purpose=agent.purpose,
        timestamp=utcnow(), decision="INFO", severity="LOW", agent_status_after=agent.status,
        message=f"Policy updated by admin (version {policy.version})", admin_action="POLICY_UPDATE",
        response_actions=["POLICY UPDATED"],
    )
    db.add(event)
    audit.record(db, event, admin_action="POLICY_UPDATE by admin", decision="ADMIN:POLICY_UPDATE")
    db.commit()
    export_policy_file(agent_id, policy.doc)
    return {**policy.to_dict(), "agent_name": agent.name, "yaml": result["yaml"], "warnings": result["warnings"]}


@router.get("/capabilities/{agent_id}")
def capabilities(agent_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    agent = get_agent_or_404(db, agent_id)
    policy = db.get(Policy, agent_id)
    doc = policy.doc if policy else policy_engine.empty_policy(agent.name)
    return capability_engine.build_graph(db, agent, doc)


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    """Known tools, resource classes and quarantine rules (for forms and editors)."""
    return {
        "tools": [t.to_dict() for t in TOOLS.values()],
        "resources": [{"name": name, "sensitivity": score} for name, score in RESOURCE_CLASSES.items()],
        "quarantine_rules": policy_engine.QUARANTINE_RULES,
    }
