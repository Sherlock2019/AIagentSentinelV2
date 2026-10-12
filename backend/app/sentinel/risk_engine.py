"""Risk scoring: fuse every engine's signal into one explainable 0-100 score."""
from __future__ import annotations

from typing import Any

from app.schemas import BehaviorResult, CapabilityResult, PolicyResult, RiskResult, SafetyVerdict

# Policy carries the most weight on purpose: it is the deterministic control.
WEIGHTS: dict[str, float] = {
    "policy": 0.35,
    "llm": 0.25,
    "behavior": 0.20,
    "resource_sensitivity": 0.15,
    "irreversibility": 0.05,
}
SENSITIVITY_MULTIPLIER = {"LOW": 0.9, "MEDIUM": 1.0, "HIGH": 1.1}
# Deterministic critical triggers floor the score here, whatever the weighted sum says.
CRITICAL_FLOOR = 95
TRANSITIVE_FLOOR = 90
RUNAWAY_FLOOR = 75  # individually harmless calls, but the pattern is a HIGH-severity event


def severity_for(score: int, cfg: dict[str, Any]) -> str:
    if score >= cfg["threshold_critical"]:
        return "CRITICAL"
    if score >= cfg["threshold_high"]:
        return "HIGH"
    if score >= cfg["threshold_medium"]:
        return "MEDIUM"
    return "LOW"


def compute(
    policy: PolicyResult,
    capability: CapabilityResult,
    llm: SafetyVerdict,
    behavior: BehaviorResult,
    irreversibility: int,
    risk_sensitivity: str,
    cfg: dict[str, Any],
) -> RiskResult:
    components = {
        # Capability-path findings are a policy-level concern, so they feed the policy term.
        "policy": max(policy.risk, capability.risk),
        "llm": llm.risk,
        "behavior": behavior.score,
        "resource_sensitivity": max(policy.resource_sensitivity, capability.max_sensitivity),
        "irreversibility": irreversibility,
    }
    weighted = sum(components[k] * WEIGHTS[k] for k in WEIGHTS)
    multiplier = SENSITIVITY_MULTIPLIER.get(risk_sensitivity, 1.0)
    score = min(100, round(weighted * multiplier))

    overrides: list[str] = []
    if policy.critical and score < CRITICAL_FLOOR:
        score = CRITICAL_FLOOR
        overrides.append(f"Deterministic critical trigger ({', '.join(policy.critical_triggers)}) → floor {CRITICAL_FLOOR}")
    elif policy.critical:
        overrides.append(f"Deterministic critical trigger: {', '.join(policy.critical_triggers)}")
    if capability.verdict == "BLOCK" and score < TRANSITIVE_FLOOR:
        score = TRANSITIVE_FLOOR
        overrides.append(f"Unintended transitive capability → floor {TRANSITIVE_FLOOR}")

    if behavior.rate_exceeded and score < RUNAWAY_FLOOR:
        score = RUNAWAY_FLOOR
        overrides.append(f"Rate limit exceeded (runaway loop) → floor {RUNAWAY_FLOOR}")

    terms = " + ".join(f"{WEIGHTS[k]:.2f}×{components[k]}" for k in WEIGHTS)
    formula = f"({terms}) × {multiplier:.1f} = {weighted * multiplier:.1f}"
    return RiskResult(
        score=score,
        severity=severity_for(score, cfg),
        components=components,
        weights=WEIGHTS,
        weighted_score=round(weighted, 1),
        multiplier=multiplier,
        overrides=overrides,
        formula=formula,
    )
