"""Plain-English explanations: every decision must be understandable by a non-engineer."""
from __future__ import annotations

from typing import Any

from app.schemas import BehaviorResult, CapabilityResult, DecisionResult, PolicyResult, RiskResult, SafetyVerdict

_RESOURCE_WORDS = {
    "production_secrets": "a production credential",
    "iam": "identity and access management (IAM) permissions",
    "audit_log": "the audit logging configuration",
    "sentinel_policy": "its own Sentinel policy",
    "customer_database": "the customer database",
    "private_db": "a private internal database",
    "external_network": "an external network destination",
    "host_system": "the host operating system",
    "production": "the production environment",
    "payments": "the payments system",
    "accounts": "customer accounts",
    "payroll": "payroll data",
}
_HEADLINES = {
    "ALLOW": "WHY AGENTSENTINEL ALLOWED THIS ACTION",
    "REVIEW": "WHY AGENTSENTINEL REQUIRED HUMAN APPROVAL",
    "BLOCK": "WHY AGENTSENTINEL BLOCKED THIS ACTION",
}


def _call(tool: str, resource: str) -> str:
    return f"{tool}({resource})" if resource else f"{tool}()"


def build(
    agent_name: str,
    purpose: str,
    task: str,
    tool: str,
    resource: str,
    policy: PolicyResult,
    capability: CapabilityResult,
    llm: SafetyVerdict,
    behavior: BehaviorResult,
    risk: RiskResult,
    decision: DecisionResult,
    paused: bool,
) -> dict[str, Any]:
    target = _RESOURCE_WORDS.get(policy.resource_class, f"'{policy.resource_class}'")
    steps = [
        f"The agent is registered for: {purpose.rstrip('.')}.",
        f"It requested {_call(tool, resource)}, which touches {target}.",
    ]

    if policy.verdict == "DENY":
        steps.append("Policy check failed: " + "; ".join(v.rstrip(".") for v in policy.violations[:3]) + ".")
    elif policy.verdict == "REQUIRE_APPROVAL":
        steps.append(f"Policy permits '{tool}' only with human approval.")
    else:
        steps.append(f"'{tool}' and its target are explicitly permitted by the agent's policy.")

    if capability.transitive:
        steps.append(f"Capability analysis found an indirect path to a forbidden resource: {capability.paths[0]['label']}.")
    if llm.injection_indicators:
        steps.append(f"The request context contained injected instructions ({llm.injection_indicators[0].lower()}).")
    steps.append(f"Safety evaluator: {llm.summary}")

    if behavior.signals:
        top = max(behavior.signals, key=lambda s: s.score)
        steps.append(f"Behaviour anomaly {behavior.score}/100 — {top.detail[0].lower() + top.detail[1:]}.")
    else:
        steps.append("The action is consistent with the agent's normal behaviour.")
    steps.append(f"Final risk score {risk.score}/100, classified {risk.severity}.")

    if decision.decision == "ALLOW":
        result = ["Action allowed and executed.", "Decision recorded in the audit trail."]
        what = "Allowed the action and recorded it in the audit trail."
    elif decision.decision == "REVIEW":
        result = ["Action held — nothing was executed.", "Waiting for a human administrator to approve or reject."]
        what = "Paused the action and asked a human to approve it. Nothing ran."
    else:
        result = ["Action blocked — the tool was never called."]
        if decision.quarantine:
            result += ["Agent automatically quarantined and its session revoked."]
        elif paused:
            result += ["Agent automatically paused."]
        result += ["Administrator notified.", "Audit evidence preserved."]
        what = "Blocked the action before it reached any real system" + (
            ", quarantined the agent and alerted an administrator." if decision.quarantine else " and alerted an administrator."
        )

    if decision.decision == "ALLOW":
        why = "It was a normal, permitted action that matches the agent's job."
    elif decision.decision == "REVIEW":
        why = "The action has real-world impact, so a human must stay in control."
    else:
        why = (decision.reasons[0] if decision.reasons else "The action violated policy") + "."

    return {
        "headline": _HEADLINES[decision.decision],
        "steps": steps,
        "result": result,
        # Recruiter-mode story: four short answers.
        "plain": {
            "supposed_to": purpose,
            "wanted": f"While working on “{task or 'its task'}”, the agent tried to call {_call(tool, resource)} — {target}.",
            "why": why,
            "what_sentinel_did": what,
            "shut_down": "Yes — the agent is quarantined and cannot act until an administrator restores it."
            if decision.quarantine
            else ("Paused — an administrator must resume it." if paused else "No — the agent keeps running."),
            "admin_action_required": decision.decision != "ALLOW",
        },
    }
