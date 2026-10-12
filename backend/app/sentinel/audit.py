"""Append-only, hash-chained audit trail.

Each record stores the SHA-256 of (previous hash + its own content), so any
edit or deletion of history breaks the chain and is detected by verify_chain().
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.clock import utcnow
from app.models import AuditLog, Event

GENESIS = "0" * 64


def _digest(prev_hash: str, payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev_hash + body).encode()).hexdigest()


def _summarize_arguments(arguments: Any) -> str:
    text = json.dumps(arguments or {}, sort_keys=True, default=str)
    return text if len(text) <= 240 else text[:237] + "..."


def record(db: Session, event: Event, admin_action: Optional[str] = None, decision: Optional[str] = None) -> AuditLog:
    db.flush()
    last = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
    prev_hash = last.hash if last else GENESIS
    llm = event.llm_result or None
    entry = AuditLog(
        event_id=event.id,
        timestamp=event.timestamp or utcnow(),
        agent_id=event.agent_id,
        agent_purpose=event.agent_purpose,
        user_task=event.task,
        requested_tool=event.tool,
        resource=event.resource,
        arguments_summary=_summarize_arguments(event.arguments),
        policy_result=(event.policy_result or {}).get("verdict", "N/A"),
        llm_result={k: llm[k] for k in ("recommended_decision", "overall_risk", "risk", "provider", "available")} if llm else None,
        behavior_score=(event.behavior_result or {}).get("score", 0),
        final_risk=event.risk_score,
        decision=decision or event.decision,
        quarantine_state=event.agent_status_after,
        alert_generated=event.alert_id is not None,
        admin_action=admin_action,
        prev_hash=prev_hash,
    )
    entry.hash = _digest(prev_hash, entry.payload())
    db.add(entry)
    db.flush()
    return entry


def verify_chain(db: Session) -> dict[str, Any]:
    prev_hash = GENESIS
    count = 0
    for entry in db.query(AuditLog).order_by(AuditLog.id.asc()).all():
        if entry.prev_hash != prev_hash or entry.hash != _digest(prev_hash, entry.payload()):
            return {"valid": False, "records": count, "broken_at_seq": entry.id}
        prev_hash = entry.hash
        count += 1
    return {"valid": True, "records": count, "broken_at_seq": None, "head": prev_hash}
