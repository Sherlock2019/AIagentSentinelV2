"""Deterministic offline safety judge.

Produces the same structured verdict a real model would, from transparent rules,
so the whole product runs with no API key, no network and reproducible results.
"""
from __future__ import annotations

from typing import Any

from app.providers.base import SafetyProvider

_PRIVILEGE_CATEGORIES = {"iam", "secret_access", "policy_tamper", "audit_tamper", "shell"}
_CRITICAL_CATEGORIES = {"iam", "secret_access", "policy_tamper", "audit_tamper", "exfiltration"}


def _scale(value: int) -> int:
    """0-100 -> 1-5."""
    return max(1, min(5, 1 + round(value / 25)))


class MockProvider(SafetyProvider):
    name = "mock"

    def evaluate(self, ctx: dict[str, Any]) -> dict[str, Any]:
        h = ctx["heuristics"]
        tool, resource, purpose = ctx["tool"], ctx["resource"], ctx["agent_purpose"]
        category = h["tool_category"]
        allowed = h["policy_verdict"] == "ALLOW"
        approval = h["policy_verdict"] == "REQUIRE_APPROVAL"
        denied = h["policy_verdict"] == "DENY"
        critical = category in _CRITICAL_CATEGORIES or h["resource_class"] in ("production_secrets", "iam")
        injected = bool(h["injection_indicators"])
        transitive = h["transitive_risk"]

        if allowed:
            intent, auth, necessity = 5, 1, 5
        elif approval:
            intent, auth, necessity = 4, 3, 4
        else:
            intent, auth, necessity = (1 if critical or h["tool_known"] else 2), 5, 1

        data = _scale(h["resource_sensitivity"])
        reversibility = _scale(h["irreversibility"])
        if denied:
            privilege = 5 if category in _PRIVILEGE_CATEGORIES else (3 if category in ("deploy", "destructive") else 2)
            # An off-task request for a critical capability is a classic injection symptom.
            injection = 4 if critical else 2
        else:
            privilege, injection = 1, 1
        if injected:
            injection = 5
            intent = min(intent, 2)
        if transitive:
            intent, auth, data, privilege, necessity = 2, 5, max(data, 5), 4, 1

        overall = max(6 - intent, auth, data if not allowed else 1, injection, privilege, 6 - necessity)
        if allowed and not injected and not transitive:
            overall = max(1, min(overall, 2 if h["resource_sensitivity"] >= 60 else 1))

        if denied or transitive or (injected and overall >= 4):
            recommendation = "BLOCK"
        elif approval or overall >= 4:
            recommendation = "REVIEW"
        else:
            recommendation = "ALLOW"

        if injected:
            summary = (
                f"The request context contains injected instructions; '{tool}' on {resource} "
                "appears to be driven by untrusted content rather than the user's task."
            )
        elif transitive:
            summary = f"'{tool}' is permitted, but this call reaches a resource the agent must not modify through a downstream service."
        elif denied and critical:
            summary = f"This action is unrelated to the agent purpose ({purpose.rstrip('.')}) and targets a critical capability: {resource}."
        elif denied:
            summary = f"'{tool}' is outside the agent's declared purpose and is not necessary for the requested task."
        elif approval:
            summary = f"'{tool}' is plausible for this agent but has real-world impact; a human should confirm it."
        else:
            summary = f"'{tool}' is consistent with the agent's purpose and the user's request."

        return {
            "intent_alignment": intent,
            "authorization_risk": auth,
            "data_risk": data,
            "injection_risk": injection,
            "privilege_risk": privilege,
            "necessity": necessity,
            "reversibility_risk": reversibility,
            "overall_risk": overall,
            "recommended_decision": recommendation,
            "summary": summary,
        }
