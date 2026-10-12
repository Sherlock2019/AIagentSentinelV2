"""LLM safety judge — semantic, ADVISORY evaluation of a proposed action.

The judge can make Sentinel stricter (ALLOW -> REVIEW) but can never loosen a
deterministic decision: that asymmetry is enforced in decision_engine, not here.

If the model is unavailable or returns garbage we do NOT silently allow: the
verdict is marked `available=False`, scored with the offline heuristic, and the
decision engine sends anything sensitive to a human.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.providers import get_provider
from app.providers.mock import MockProvider
from app.schemas import SafetyVerdict

# Phrases that indicate instructions smuggled into retrieved content.
_INJECTION_PATTERNS: list[tuple[str, str]] = [
    (r"ignore (all |any )?(the )?(previous|prior|above) (instructions|rules)", "Instruction override ('ignore previous instructions')"),
    (r"disregard (all |any )?(previous|prior|your) (instructions|rules|guidelines)", "Instruction override ('disregard instructions')"),
    (r"you are now|new system prompt|act as (the )?(system|admin|root)", "Role reassignment attempt"),
    (r"(send|upload|post|forward) (it|them|this|the \w+) to (the |an )?external", "Instruction to send data to an external server"),
    (r"do not (tell|inform|alert|log)|without (telling|logging|alerting)", "Instruction to hide activity"),
    (r"(read|reveal|print|dump) (the )?(production )?(secret|credential|token|password|api key)", "Instruction to reveal a secret"),
]
_RISK_FIELDS = ("authorization_risk", "data_risk", "injection_risk", "privilege_risk", "reversibility_risk")
_SCORE_FIELDS = ("intent_alignment", "necessity", "overall_risk", *_RISK_FIELDS)


def scan_injection(*parts: Any) -> list[str]:
    """Deterministic prompt-injection indicator scan over untrusted text."""
    text = " ".join(p if isinstance(p, str) else json.dumps(p, default=str) for p in parts if p).lower()
    return list(dict.fromkeys(label for pattern, label in _INJECTION_PATTERNS if re.search(pattern, text)))


def semantic_risk(verdict: SafetyVerdict) -> int:
    """Collapse the 1-5 dimensions into 0-100. The worst dimension dominates (70%)
    so a single severe finding cannot be averaged away by benign ones."""
    dims = [6 - verdict.intent_alignment, 6 - verdict.necessity, *(getattr(verdict, f) for f in _RISK_FIELDS)]
    worst = (max(dims) - 1) / 4 * 100
    mean = (sum(dims) / len(dims) - 1) / 4 * 100
    return round(0.7 * worst + 0.3 * mean)


def _coerce(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate untrusted model output: clamp scores, whitelist the decision."""
    clean: dict[str, Any] = {}
    for field in _SCORE_FIELDS:
        clean[field] = max(1, min(5, int(round(float(raw[field])))))
    decision = str(raw.get("recommended_decision", "")).upper()
    if decision not in ("ALLOW", "REVIEW", "BLOCK"):
        raise ValueError(f"Invalid recommended_decision: {decision!r}")
    clean["recommended_decision"] = decision
    clean["summary"] = str(raw.get("summary", ""))[:500]
    return clean


def evaluate(ctx: dict[str, Any], enabled: bool = True) -> SafetyVerdict:
    indicators = ctx["heuristics"]["injection_indicators"]
    provider = get_provider()
    degraded: str | None = None

    if not enabled:
        degraded = "LLM judge disabled in settings — offline heuristic used"
    try:
        if degraded:
            raise RuntimeError(degraded)
        verdict = SafetyVerdict(**_coerce(provider.evaluate(ctx)), provider=provider.name)
    except Exception as exc:  # fail safe, never fail open
        degraded = degraded or f"{provider.name} evaluator unavailable: {type(exc).__name__}: {exc}"
        verdict = SafetyVerdict(**_coerce(MockProvider().evaluate(ctx)), provider=f"{provider.name} (fallback heuristic)")
        verdict.available = False
        verdict.degraded_reason = degraded[:300]

    verdict.injection_indicators = indicators
    # The deterministic scan is authoritative for injection: a model that was itself
    # fooled by the injected text must not be able to lower this score.
    if indicators:
        verdict.injection_risk = max(verdict.injection_risk, 5)
        verdict.overall_risk = max(verdict.overall_risk, 5)
    verdict.risk = semantic_risk(verdict)
    return verdict
