"""Runtime behaviour analysis: is this agent acting unlike its normal self?

Produces a 0-100 anomaly score from independent, explainable signals. Each
signal contributes a fixed weight so an analyst can see exactly why the score
is what it is.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models import Agent, BehaviorHistory
from app.schemas import BehaviorResult, BehaviorSignal
from app.sentinel.policy_engine import match_resource
from app.simulator.demo_tools import ToolSpec, resource_sensitivity

LOOP_WINDOW_SECONDS = 30
LOOP_THRESHOLD = 8
LARGE_EXPORT_ROWS = 10_000


def recent_history(db: Session, agent_id: str, now: datetime, seconds: int) -> list[BehaviorHistory]:
    return (
        db.query(BehaviorHistory)
        .filter(BehaviorHistory.agent_id == agent_id, BehaviorHistory.timestamp > now - timedelta(seconds=seconds))
        .order_by(BehaviorHistory.timestamp.asc(), BehaviorHistory.id.asc())
        .all()
    )


def count_recent_blocks(db: Session, agent_id: str, now: datetime, window_seconds: int) -> int:
    return sum(1 for h in recent_history(db, agent_id, now, window_seconds) if h.blocked and h.counted and not h.baseline)


def last_actions(db: Session, agent_id: str, limit: int = 6) -> list[dict[str, Any]]:
    rows = (
        db.query(BehaviorHistory)
        .filter(BehaviorHistory.agent_id == agent_id)
        .order_by(BehaviorHistory.timestamp.desc(), BehaviorHistory.id.desc())
        .limit(limit)
        .all()
    )
    return [{"tool": r.tool, "resource": r.resource, "decision": r.decision} for r in reversed(rows)]


def evaluate(
    db: Session,
    agent: Agent,
    policy: dict[str, Any],
    spec: ToolSpec,
    resource: str,
    resource_class: str,
    operation: str,
    arguments: dict[str, Any],
    now: datetime,
    block_window_seconds: int = 60,
) -> BehaviorResult:
    signals: list[BehaviorSignal] = []
    minute = [h for h in recent_history(db, agent.id, now, 60) if not h.baseline]
    five_minutes = [h for h in recent_history(db, agent.id, now, 300) if not h.baseline]
    permitted_tools = set(policy["allow"]) | set(policy["require_approval"])

    # 1. Call rate against the agent's declared limit (this call included).
    limit = int(policy["limits"]["rate_per_minute"])
    calls = len(minute) + 1
    rate_exceeded = calls > limit
    if rate_exceeded:
        signals.append(BehaviorSignal(name="High call rate", score=60, detail=f"{calls} calls in 60s exceeds the limit of {limit}/min"))
    elif calls > 0.8 * limit:
        signals.append(BehaviorSignal(name="Call rate rising", score=20, detail=f"{calls} calls in 60s is approaching the limit of {limit}/min"))

    # 2. Repeated denied attempts.
    blocked = sum(1 for h in recent_history(db, agent.id, now, block_window_seconds) if h.blocked and h.counted and not h.baseline)
    if blocked:
        signals.append(BehaviorSignal(name="Repeated denied attempts", score=min(45, blocked * 20), detail=f"{blocked} blocked action(s) in the last {block_window_seconds}s"))

    # 3. Tool outside the agent's historical norm.
    if spec.name not in permitted_tools:
        signals.append(BehaviorSignal(name="Tool outside normal behaviour", score=35, detail=f"'{spec.name}' has never been part of this agent's activity"))

    # 4. Unusual resource access.
    sensitivity = resource_sensitivity(resource_class)
    if not match_resource(policy["resources"]["allow"], resource_class, operation):
        signals.append(BehaviorSignal(name="Unusual resource access", score=max(8, round(25 * sensitivity / 100)), detail=f"'{resource_class}' is not a resource this agent normally touches"))

    # 5. Sequence anomaly: routine activity followed by a high-sensitivity jump.
    previous = five_minutes[-5:]
    if spec.sensitivity >= 80 and spec.name not in permitted_tools and all(h.sensitivity < 40 for h in previous):
        normal = ", ".join(sorted(policy["allow"])[:3]) or "routine tools"
        signals.append(BehaviorSignal(name="Tool-sequence anomaly", score=31, detail=f"Sudden jump from routine activity ({normal}) to a high-sensitivity operation"))

    # 6. Looping on the same call.
    cutoff = now - timedelta(seconds=LOOP_WINDOW_SECONDS)
    repeats = sum(1 for h in minute if h.timestamp > cutoff and h.tool == spec.name and h.resource == resource) + 1
    if repeats >= LOOP_THRESHOLD:
        signals.append(BehaviorSignal(name="Looping", score=30, detail=f"Identical call repeated {repeats} times in {LOOP_WINDOW_SECONDS}s"))

    # 7. Cost spike.
    cost_limit = float(policy["limits"]["cost_per_minute_usd"])
    spend = sum(h.cost for h in minute) + spec.cost
    if spend > cost_limit:
        signals.append(BehaviorSignal(name="Cost spike", score=30, detail=f"${spend:.2f} spent in 60s exceeds the ${cost_limit:.2f}/min budget"))

    # 8. Large export pattern.
    rows = max((v for k, v in arguments.items() if k in ("rows", "records", "limit", "count") and isinstance(v, (int, float))), default=0)
    if rows >= LARGE_EXPORT_ROWS:
        signals.append(BehaviorSignal(name="Large export pattern", score=25, detail=f"Request covers {int(rows):,} records"))

    # 9. Retrying something Sentinel already blocked.
    if any(h.blocked and h.counted and h.tool == spec.name for h in five_minutes):
        signals.append(BehaviorSignal(name="Policy bypass attempt", score=20, detail=f"'{spec.name}' is being retried after Sentinel blocked it"))

    return BehaviorResult(
        score=min(100, sum(s.score for s in signals)),
        signals=signals,
        rate_exceeded=rate_exceeded,
        calls_last_minute=calls,
        blocked_last_window=blocked,
    )
