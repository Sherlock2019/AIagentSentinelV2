"""CI/CD integration: agent tokens for runners, and a simulated GitHub Actions pipeline demo."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.agents import get_agent_or_404
from app.clock import new_id, utcnow
from app.config import settings
from app.database.db import get_db
from app.database.settings_store import get_settings
from app.models import Event
from app.models.agent import REVIEW, RUNNING
from app.schemas import InterceptRequest
from app.sentinel import audit, gateway, quarantine

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

DEMO_AGENT = "coding-agent"
DEMO_REPO = "acme/storefront"
# One simulated workflow run: three jobs, each gated by the AgentSentinel action.
DEMO_PIPELINE: list[dict[str, Any]] = [
    {
        "job": "test", "name": "Agent runs the tests", "tool": "run_tests", "resource": "ci_sandbox/storefront",
        "task": "Review pull request #128 and run the test suite", "run": "npm test", "on_review": "fail",
    },
    {
        "job": "patch", "name": "Agent applies its patch", "tool": "apply_patch", "resource": "source_repo/storefront",
        "task": "Apply the generated fix for pull request #128", "run": "git apply agent.patch", "on_review": "wait",
    },
    {
        "job": "deploy", "name": "Agent tries to deploy to production", "tool": "deploy_prod", "resource": "production/storefront",
        "task": "Review pull request #128 and run the test suite", "run": "./deploy.sh", "on_review": "fail",
    },
]


@router.get("/github")
def github_info() -> dict[str, Any]:
    return {
        "require_agent_token": settings.require_agent_token,
        "action_path": "github-action",
        "example_workflows": ["examples/github-workflows/agent-pipeline.yml", ".github/workflows/sentinel-selftest.yml"],
        "demo_pipeline": [{k: step[k] for k in ("job", "name", "tool", "resource", "run", "on_review")} for step in DEMO_PIPELINE],
    }


@router.post("/agents/{agent_id}/token")
def issue_agent_token(agent_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Rotate the agent's session token and return it ONCE, to be stored as a CI secret.
    The previous token stops working immediately."""
    agent = get_agent_or_404(db, agent_id)
    if agent.status not in (RUNNING, REVIEW):
        raise HTTPException(409, f"Agent is {agent.status}. Restore it before issuing a token.")
    agent.session_token = quarantine.new_session_token()
    event = Event(
        id=new_id("evt"), kind="SYSTEM", agent_id=agent.id, agent_name=agent.name, agent_purpose=agent.purpose,
        timestamp=utcnow(), decision="INFO", severity="LOW", agent_status_after=agent.status,
        message="Agent session token rotated by admin (for CI/CD integration)", admin_action="TOKEN_ROTATED",
        response_actions=["PREVIOUS TOKEN REVOKED", "NEW TOKEN ISSUED"],
    )
    db.add(event)
    audit.record(db, event, admin_action="TOKEN_ROTATED by admin", decision="ADMIN:TOKEN_ROTATED")
    db.commit()
    return {
        "agent_id": agent.id,
        "token": agent.session_token,
        "secret_name": "SENTINEL_AGENT_TOKEN",
        "note": "Shown once. Quarantining or killing the agent revokes it; restoring the agent issues a new one.",
    }


@router.post("/github/demo")
def github_demo(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Simulate a GitHub Actions run. Each job submits exactly what the real action submits,
    through the real gateway, so the decisions are the ones a runner would get."""
    if get_settings(db)["emergency_stop_active"]:
        raise HTTPException(409, "Emergency stop is active — release it to run the pipeline demo.")
    agent = get_agent_or_404(db, DEMO_AGENT)
    quarantine.reset_runtime(db, agent)  # fresh session => reproducible demo
    db.commit()

    run_id = new_id("run").split("_")[1]
    jobs = []
    for step in DEMO_PIPELINE:
        request = InterceptRequest(
            agent_id=DEMO_AGENT, task=step["task"], tool=step["tool"], resource=step["resource"],
            context={
                "source": "github-actions", "simulated": True, "repository": DEMO_REPO, "workflow": "Guarded AI agent pipeline",
                "job": step["job"], "run_id": run_id, "actor": "coding-agent[bot]", "ref": "refs/pull/128/merge", "event": "pull_request",
            },
        )
        response = gateway.intercept(db, request, scenario="github_actions_demo", internal=True)
        decision = response["decision"]
        if decision == "ALLOW":
            outcome, command_ran = "success", True
        elif decision == "REVIEW":
            outcome, command_ran = ("waiting" if step["on_review"] == "wait" else "failure"), False
        else:
            outcome, command_ran = "failure", False
        jobs.append({**{k: step[k] for k in ("job", "name", "tool", "resource", "run", "on_review")}, "outcome": outcome, "command_ran": command_ran, "response": response})

    db.refresh(agent)
    return {"repository": DEMO_REPO, "run_id": run_id, "agent": agent.to_dict(), "jobs": jobs}
