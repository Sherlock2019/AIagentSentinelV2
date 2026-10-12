from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.clock import iso, utcnow
from app.database.db import get_db
from app.models import Agent, Event
from app.models.agent import QUARANTINED

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

BUCKET_MINUTES = 30
BUCKETS = 12


@router.get("")
def metrics(db: Session = Depends(get_db)) -> dict[str, Any]:
    events = db.query(Event).filter(Event.kind == "ACTION").order_by(Event.timestamp.asc()).all()
    agents = db.query(Agent).all()
    decisions = Counter(e.decision for e in events)
    severities = Counter(e.severity for e in events)

    def tool_denied(event: Event) -> bool:
        checks = (event.policy_result or {}).get("checks", [])
        return any(c["name"] == "Tool Allowed" and c["status"] == "FAIL" for c in checks)

    # Riskiest tool = the one that accumulated the most risk in non-allowed calls.
    tool_risk: dict[str, int] = defaultdict(int)
    for e in events:
        if e.decision != "ALLOW":
            tool_risk[e.tool] += e.risk_score
    top_agent = max(agents, key=lambda a: a.risk_score, default=None)

    now = utcnow()
    start = now - timedelta(minutes=BUCKET_MINUTES * BUCKETS)
    series = [
        {"t": iso(start + timedelta(minutes=BUCKET_MINUTES * (i + 1))), "allow": 0, "review": 0, "block": 0, "avg_risk": 0, "max_risk": 0, "_risks": []}
        for i in range(BUCKETS)
    ]
    for e in events:
        index = int((e.timestamp - start).total_seconds() // (BUCKET_MINUTES * 60))
        if 0 <= index < BUCKETS:
            series[index][e.decision.lower()] += 1
            series[index]["_risks"].append(e.risk_score)
    for bucket in series:
        risks = bucket.pop("_risks")
        if risks:
            bucket["avg_risk"], bucket["max_risk"] = round(sum(risks) / len(risks)), max(risks)

    usage: dict[str, Counter] = defaultdict(Counter)
    for e in events:
        usage[e.tool][e.decision] += 1
    tool_usage = sorted(
        ({"tool": tool, "allow": c["ALLOW"], "review": c["REVIEW"], "block": c["BLOCK"], "total": sum(c.values())} for tool, c in usage.items()),
        key=lambda row: -row["total"],
    )[:10]

    blocked_by_agent = Counter(e.agent_id for e in events if e.decision == "BLOCK")
    return {
        "totals": {
            "total_actions": len(events),
            "allowed": decisions["ALLOW"],
            "blocked": decisions["BLOCK"],
            "review": decisions["REVIEW"],
            "critical_events": severities["CRITICAL"],
            "quarantined_agents": sum(1 for a in agents if a.status == QUARANTINED),
            "average_risk": round(sum(e.risk_score for e in events) / len(events), 1) if events else 0,
            "top_risky_tool": max(tool_risk, key=tool_risk.get) if tool_risk else None,
            "top_risky_agent": top_agent.name if top_agent and top_agent.risk_score > 0 else None,
            "prompt_injection_detections": sum(1 for e in events if e.injection_detected),
            "policy_violations": sum(1 for e in events if (e.policy_result or {}).get("verdict") == "DENY"),
            "tool_abuse_attempts": sum(1 for e in events if e.decision == "BLOCK" and tool_denied(e)),
        },
        "series": series,
        "bucket_minutes": BUCKET_MINUTES,
        "by_decision": [{"name": d, "value": decisions[d]} for d in ("ALLOW", "REVIEW", "BLOCK")],
        "by_severity": [{"name": s, "value": severities[s]} for s in ("LOW", "MEDIUM", "HIGH", "CRITICAL")],
        "tool_usage": tool_usage,
        "agent_ranking": sorted(
            ({"agent": a.name, "risk": a.risk_score, "blocked": blocked_by_agent[a.id], "status": a.status} for a in agents),
            key=lambda row: -row["risk"],
        ),
    }
