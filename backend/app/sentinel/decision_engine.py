"""Final decision: ALLOW / REVIEW / BLOCK, plus the automatic response.

Precedence (strictest wins, and nothing below can relax anything above):

  1. Deterministic policy DENY, forbidden capability path, rate limit  -> BLOCK
  2. Policy REQUIRE_APPROVAL, unproven capability path, agent in REVIEW -> REVIEW
  3. LLM judge: may only TIGHTEN (ALLOW -> REVIEW). It can never unblock.
  4. Risk score: CRITICAL -> BLOCK, HIGH -> REVIEW, MEDIUM -> ALLOW+log (REVIEW in STRICT mode)
"""
from __future__ import annotations

from typing import Any

from app.schemas import BehaviorResult, CapabilityResult, DecisionResult, PolicyResult, RiskResult, SafetyVerdict

_ORDER = {"ALLOW": 0, "REVIEW": 1, "BLOCK": 2}
_SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
_TRIGGER_TEXT = {
    "secret_access": "attempted to access secrets",
    "iam_modification": "attempted to modify IAM",
    "audit_tampering": "attempted to disable audit logging",
    "sentinel_bypass": "attempted to modify or bypass Sentinel",
    "critical_exfiltration": "critical data-exfiltration attempt",
}


def decide(
    agent_status: str,
    quarantine_rules: list[str],
    policy: PolicyResult,
    capability: CapabilityResult,
    llm: SafetyVerdict,
    behavior: BehaviorResult,
    risk: RiskResult,
    cfg: dict[str, Any],
) -> DecisionResult:
    decision = "ALLOW"
    reasons: list[str] = []
    drivers: list[str] = []

    def raise_to(level: str, reason: str, driver: str) -> None:
        nonlocal decision
        if _ORDER[level] > _ORDER[decision]:
            decision = level
        if reason not in reasons:
            reasons.append(reason)
        if driver not in drivers:
            drivers.append(driver)

    # --- 1. Deterministic blocks -------------------------------------------------
    if policy.verdict == "DENY":
        for violation in policy.violations:
            raise_to("BLOCK", violation, "policy")
    if capability.verdict == "BLOCK":
        raise_to("BLOCK", capability.summary, "capability")
    if behavior.rate_exceeded:
        raise_to("BLOCK", f"Rate limit exceeded: {behavior.calls_last_minute} calls in 60 seconds (runaway loop)", "behavior")

    # --- 2. Deterministic human approval -----------------------------------------
    if policy.verdict == "REQUIRE_APPROVAL":
        detail = next((c.detail for c in policy.checks if c.status in ("APPROVAL", "WARN")), "Policy requires human approval")
        raise_to("REVIEW", f"Human approval required: {detail}", "policy")
    if capability.verdict == "REVIEW":
        raise_to("REVIEW", capability.summary, "capability")
    if agent_status == "REVIEW":
        raise_to("REVIEW", "Agent is under investigation: every action needs human approval", "state")

    # --- 3. LLM judge: advisory, tighten-only -------------------------------------
    if not llm.available and max(policy.resource_sensitivity, capability.max_sensitivity) >= 50:
        raise_to("REVIEW", "Safety evaluator unavailable for a sensitive action — failing safe to human review", "llm")
    if llm.injection_indicators:
        raise_to("REVIEW", f"Prompt injection indicators in context: {llm.injection_indicators[0]}", "llm")
    if decision == "ALLOW" and llm.recommended_decision in ("REVIEW", "BLOCK"):
        raise_to("REVIEW", f"Safety evaluator flagged this action: {llm.summary}", "llm")

    # --- 4. Risk score -------------------------------------------------------------
    if risk.severity == "CRITICAL":
        raise_to("BLOCK", f"Risk score {risk.score}/100 is CRITICAL", "risk")
    elif risk.severity == "HIGH":
        raise_to("REVIEW", f"Risk score {risk.score}/100 is HIGH — human approval required", "risk")
    elif risk.severity == "MEDIUM" and cfg["global_policy_mode"] == "STRICT":
        raise_to("REVIEW", f"Risk score {risk.score}/100 is MEDIUM (STRICT mode requires approval)", "risk")

    if decision == "ALLOW":
        reasons.append("Tool, resource and intent are within the agent's declared purpose")
    elif decision == "BLOCK" and policy.verdict == "DENY" and llm.summary:
        reasons.append(f"Safety evaluator: {llm.summary}")

    # --- Automatic response ----------------------------------------------------------
    quarantine, quarantine_reason = False, ""
    armed = [t for t in policy.critical_triggers if t in quarantine_rules]
    if decision == "BLOCK" and armed and cfg["auto_quarantine_enabled"]:
        quarantine = True
        quarantine_reason = "Automatic quarantine: " + "; ".join(_TRIGGER_TEXT.get(t, t) for t in armed)

    severity = risk.severity
    if decision == "BLOCK" and _SEVERITY_ORDER.index(severity) < _SEVERITY_ORDER.index("HIGH"):
        severity = "HIGH"  # a blocked action is never reported as low severity

    return DecisionResult(
        decision=decision,
        severity=severity,
        reasons=reasons,
        quarantine=quarantine,
        quarantine_reason=quarantine_reason,
        pause=decision == "BLOCK" and behavior.rate_exceeded and not quarantine,
        alert=decision == "BLOCK",
        drivers=drivers,
    )
