"""The Sentinel Gateway — the single choke point every agent action passes through.

    Agent -> intercept() -> policy / capability / behaviour / LLM judge -> risk -> decision
                                                                                     |
                                              tool executes ONLY if decision == ALLOW

The tool is never called before the decision exists. That ordering is the product.
"""
from __future__ import annotations

import time
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.clock import new_id, utcnow
from app.config import settings
from app.database.settings_store import get_settings
from app.models import Action, Agent, BehaviorHistory, Event, Policy
from app.models.agent import DISABLED, PAUSED, QUARANTINED
from app.schemas import InterceptRequest
from app.sentinel import alerts, audit, behavior_engine, capability_engine, decision_engine, explain, policy_engine, quarantine, risk_engine
from app.sentinel import llm_safety_judge
from app.simulator.demo_tools import execute_tool, get_tool


class AgentNotFound(Exception):
    pass


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


def _gate(agent: Agent, cfg: dict[str, Any], token: Optional[str], internal: bool = False) -> Optional[str]:
    """Step 1: authenticate the agent and check it is allowed to act at all."""
    if cfg["emergency_stop_active"]:
        return "Global emergency stop is active — all agent actions are refused"
    if agent.status == QUARANTINED:
        return "Agent is QUARANTINED — all actions are blocked until an administrator restores it"
    if agent.status == DISABLED:
        return "Agent is DISABLED (killed) — all actions are blocked"
    if agent.status == PAUSED:
        return "Agent is PAUSED — actions are blocked until an administrator resumes it"
    if agent.session_token is None:
        return "Agent session has been revoked"
    if token is None and settings.require_agent_token and not internal:
        return "Agent session token required (REQUIRE_AGENT_TOKEN is enabled)"
    if token is not None and token != agent.session_token:
        return "Invalid agent session token"
    return None


def _response(event: Event, action: Action, alert_id: Optional[str]) -> dict[str, Any]:
    return {
        "decision": event.decision,
        "risk_score": event.risk_score,
        "severity": event.severity,
        "reasons": event.reasons,
        "quarantine": event.quarantined,
        "alert": alert_id is not None,
        "event_id": event.id,
        "action_id": action.id,
        "alert_id": alert_id,
        "agent_status": event.agent_status_after,
        "response_actions": event.response_actions,
        "tool_result": action.result if action.status == "EXECUTED" else None,
        "event": event.to_dict(),
    }


def intercept(db: Session, req: InterceptRequest, scenario: Optional[str] = None, internal: bool = False) -> dict[str, Any]:
    """`internal` marks calls made by Sentinel's own simulator (seeding, red-team lab),
    which act on behalf of an agent without holding its token."""
    started = time.perf_counter()
    timings: dict[str, float] = {}
    now = utcnow()

    agent = db.get(Agent, req.agent_id)
    if agent is None:
        raise AgentNotFound(req.agent_id)
    cfg = get_settings(db)
    spec = get_tool(req.tool)
    resource = req.resource or spec.default_resource
    operation = (req.operation or spec.operation).upper()
    recent = behavior_engine.last_actions(db, agent.id)

    action = Action(
        id=new_id("act"), agent_id=agent.id, task=req.task, tool=req.tool, resource=resource,
        operation=operation, arguments=req.arguments, context=req.context, timestamp=now,
    )
    db.add(action)
    event = Event(
        id=new_id("evt"), kind="ACTION", action_id=action.id, agent_id=agent.id, agent_name=agent.name,
        agent_purpose=agent.purpose, timestamp=now, task=req.task, tool=req.tool, resource=resource,
        operation=operation, arguments=req.arguments, context=req.context, recent_actions=recent, scenario=scenario,
    )
    action.event_id = event.id

    # ---- 1. Gate: identity + agent state -----------------------------------------
    refusal = _gate(agent, cfg, req.session_token, internal)
    if refusal:
        action.status, action.reasons, action.risk_score = "BLOCKED", [refusal], agent.risk_score
        event.decision, event.severity, event.risk_score = "BLOCK", "HIGH", agent.risk_score
        event.reasons = [refusal]
        event.response_actions = ["ACTION BLOCKED", "AUDIT EVIDENCE PRESERVED"]
        event.agent_status_after = agent.status
        event.quarantined = agent.status == QUARANTINED
        event.explanation = {
            "headline": "WHY AGENTSENTINEL BLOCKED THIS ACTION",
            "steps": [f"{agent.name} requested {req.tool}({resource}).", refusal + ".", "Contained agents cannot reach any tool, whatever they request."],
            "result": ["Action blocked — the tool was never called.", "Audit evidence preserved."],
            "plain": {
                "supposed_to": agent.purpose,
                "wanted": f"The agent tried to call {req.tool}({resource}).",
                "why": refusal + ".",
                "what_sentinel_did": "Refused the action at the gateway. The pipeline was not even consulted.",
                "shut_down": f"The agent is currently {agent.status}.",
                "admin_action_required": True,
            },
        }
        event.timings = {"total_ms": _ms(started)}
        db.add(event)
        # Not `counted`: an already-contained agent hammering the gateway is not a new strike.
        db.add(BehaviorHistory(agent_id=agent.id, timestamp=now, tool=req.tool, resource=resource, decision="BLOCK", blocked=True, counted=False, sensitivity=spec.sensitivity))
        audit.record(db, event)
        db.commit()
        return _response(event, action, None)

    policy_row = db.get(Policy, agent.id)
    policy = policy_row.doc if policy_row else policy_engine.empty_policy(agent.name)  # no policy => default deny

    # ---- 2. Deterministic policy ---------------------------------------------------
    t = time.perf_counter()
    pres = policy_engine.evaluate(policy, req.tool, resource, operation, req.arguments)
    timings["policy_ms"] = _ms(t)

    # ---- 3. Capability-path analysis ---------------------------------------------
    t = time.perf_counter()
    cres = capability_engine.check_request(db, agent, policy, req.tool, req.arguments)
    timings["capability_ms"] = _ms(t)

    # ---- 4. Behaviour ---------------------------------------------------------------
    t = time.perf_counter()
    window = int(cfg["blocked_retry_window_seconds"])
    bres = behavior_engine.evaluate(db, agent, policy, spec, resource, pres.resource_class, operation, req.arguments, now, window)
    timings["behavior_ms"] = _ms(t)

    # ---- 5. LLM safety judge (advisory) --------------------------------------------
    t = time.perf_counter()
    indicators = llm_safety_judge.scan_injection(req.context, req.arguments)
    lres = llm_safety_judge.evaluate(
        {
            "agent_purpose": agent.purpose,
            "task": req.task,
            "plan": req.context.get("plan"),
            "tool": req.tool,
            "tool_description": spec.description,
            "resource": resource,
            "operation": operation,
            "arguments": req.arguments,
            "context": req.context,
            "recent_actions": recent,
            "policy": {k: policy[k] for k in ("purpose", "allow", "require_approval", "deny", "resources")},
            "heuristics": {
                "tool_category": spec.category,
                "tool_known": spec.known,
                "policy_verdict": pres.verdict,
                "resource_class": pres.resource_class,
                "resource_sensitivity": max(pres.resource_sensitivity, cres.max_sensitivity),
                "irreversibility": spec.irreversibility,
                "injection_indicators": indicators,
                "transitive_risk": cres.transitive,
            },
        },
        enabled=bool(cfg["llm_judge_enabled"]),
    )
    timings["llm_ms"] = _ms(t)

    # ---- 6. Risk + decision ---------------------------------------------------------
    risk = risk_engine.compute(pres, cres, lres, bres, spec.irreversibility, agent.risk_sensitivity, cfg)
    decision = decision_engine.decide(agent.status, policy["quarantine_rules"], pres, cres, lres, bres, risk, cfg)

    # N-strikes rule: repeated blocked attempts mean the agent is probing the boundary.
    threshold = int(cfg["blocked_retry_threshold"])
    if (
        decision.decision == "BLOCK"
        and not decision.quarantine
        and cfg["auto_quarantine_enabled"]
        and "repeated_blocks" in policy["quarantine_rules"]
        and bres.blocked_last_window + 1 >= threshold
    ):
        decision.quarantine, decision.pause = True, False
        decision.quarantine_reason = f"Automatic quarantine: {threshold} blocked actions within {window} seconds"
        decision.reasons.append(f"{threshold} blocked actions within {window} seconds — repeated policy bypass attempts")

    # ---- 7. Enforce -------------------------------------------------------------------
    if decision.decision == "ALLOW":
        action.result = execute_tool(req.tool, resource, req.arguments)  # the ONLY place a tool runs un-reviewed
        action.status = "EXECUTED"
        responses = ["ACTION ALLOWED", "TOOL EXECUTED"]
    elif decision.decision == "REVIEW":
        action.status = "PENDING_APPROVAL"
        responses = ["ACTION HELD", "HUMAN APPROVAL REQUESTED"]
    else:
        action.status = "BLOCKED"
        responses = ["ACTION BLOCKED"]
    action.risk_score, action.reasons = risk.score, decision.reasons

    db.add(BehaviorHistory(
        agent_id=agent.id, timestamp=now, tool=req.tool, resource=resource, resource_class=pres.resource_class,
        decision=decision.decision, blocked=decision.decision == "BLOCK", counted=True,
        sensitivity=spec.sensitivity, cost=spec.cost if decision.decision == "ALLOW" else 0.0,
    ))
    agent.risk_score = max(risk.score, int(agent.risk_score * 0.7))  # spikes decay over later safe actions
    agent.last_activity = now
    agent.current_task = req.task or agent.current_task

    status_after = agent.status
    if decision.quarantine:
        status_after = QUARANTINED
        responses += ["AGENT QUARANTINED", "SESSION REVOKED"]
    elif decision.pause:
        status_after = PAUSED
        responses += ["AGENT PAUSED"]

    alert = None
    if decision.alert:
        responses.append("ADMIN ALERT SENT")
        alert = alerts.create_alert(
            db,
            agent_id=agent.id,
            agent_name=agent.name,
            severity="CRITICAL" if (decision.quarantine or decision.severity == "CRITICAL") else "HIGH",
            title=f"Blocked {req.tool}({resource})" + (" — agent quarantined" if decision.quarantine else " — agent paused" if decision.pause else ""),
            channels=cfg["alert_channels"],
            event_id=event.id,
            tool=req.tool,
            resource=resource,
            reasons=decision.reasons,
            risk_score=risk.score,
            sentinel_response=list(responses),
            agent_state=status_after,
        )
    responses.append("AUDIT EVIDENCE PRESERVED")

    event.resource_class = pres.resource_class
    event.decision, event.severity, event.risk_score = decision.decision, decision.severity, risk.score
    event.reasons = decision.reasons
    event.explanation = explain.build(agent.name, agent.purpose, req.task, req.tool, resource, pres, cres, lres, bres, risk, decision, decision.pause)
    event.policy_result = pres.model_dump()
    event.llm_result = lres.model_dump()
    event.behavior_result = bres.model_dump()
    event.capability_result = cres.model_dump()
    event.risk_breakdown = {**risk.model_dump(), "drivers": decision.drivers}
    event.response_actions = responses
    event.quarantined = decision.quarantine
    event.agent_status_after = status_after
    event.alert_id = alert.id if alert else None
    event.injection_detected = bool(indicators)
    timings["total_ms"] = _ms(started)
    event.timings = timings
    db.add(event)
    audit.record(db, event)

    # ---- 8. Contain the agent (after the decision is safely in the audit trail) ------
    if decision.quarantine:
        quarantine.quarantine_agent(db, agent, decision.quarantine_reason, actor="sentinel", at=now + timedelta(milliseconds=1), scenario=scenario)
    elif decision.pause:
        quarantine.pause_agent(db, agent, "Automatic pause: runaway loop / rate limit exceeded", actor="sentinel", at=now + timedelta(milliseconds=1), scenario=scenario)
    db.commit()
    return _response(event, action, alert.id if alert else None)


def resolve_approval(db: Session, action: Action, approve: bool, actor: str = "admin") -> dict[str, Any]:
    """Human-in-the-loop: an administrator approves or rejects a held action."""
    agent = db.get(Agent, action.agent_id)
    now = utcnow()
    if approve:
        action.result = execute_tool(action.tool, action.resource, action.arguments or {})
        action.status = "APPROVED"
        message, responses, admin_action = f"Human approved {action.tool}({action.resource}) — tool executed", ["HUMAN APPROVED", "TOOL EXECUTED"], "APPROVED"
    else:
        action.status = "REJECTED"
        message, responses, admin_action = f"Human rejected {action.tool}({action.resource}) — nothing executed", ["HUMAN REJECTED", "ACTION DISCARDED"], "REJECTED"
    action.resolved_at = now

    original = db.get(Event, action.event_id) if action.event_id else None
    if original:
        original.admin_action = admin_action
    event = Event(
        id=new_id("evt"), kind="SYSTEM", action_id=action.id, agent_id=action.agent_id,
        agent_name=agent.name if agent else action.agent_id, agent_purpose=agent.purpose if agent else "",
        timestamp=now, task=action.task, tool=action.tool, resource=action.resource, operation=action.operation,
        arguments=action.arguments, decision="INFO", severity="LOW", risk_score=action.risk_score,
        reasons=[f"{admin_action.title()} by {actor}"], response_actions=responses,
        agent_status_after=agent.status if agent else "", message=message, admin_action=admin_action,
    )
    db.add(event)
    audit.record(db, event, admin_action=f"{admin_action} by {actor}", decision=f"HUMAN:{admin_action}")
    db.commit()
    return {"action": action.to_dict(), "event": event.summary()}
