from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import iso, utcnow
from app.database.db import Base


class AuditLog(Base):
    """Append-only, hash-chained audit record. Rows are never updated or deleted."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(40), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    agent_id: Mapped[str] = mapped_column(String(80), index=True)
    agent_purpose: Mapped[str] = mapped_column(Text, default="")
    user_task: Mapped[str] = mapped_column(Text, default="")
    requested_tool: Mapped[str] = mapped_column(String(80), default="")
    resource: Mapped[str] = mapped_column(String(200), default="")
    arguments_summary: Mapped[str] = mapped_column(Text, default="")
    policy_result: Mapped[str] = mapped_column(String(30), default="")
    llm_result: Mapped[Any] = mapped_column(JSON, nullable=True)
    behavior_score: Mapped[int] = mapped_column(Integer, default=0)
    final_risk: Mapped[int] = mapped_column(Integer, default=0)
    decision: Mapped[str] = mapped_column(String(20), default="")
    quarantine_state: Mapped[str] = mapped_column(String(20), default="")
    alert_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    admin_action: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    prev_hash: Mapped[str] = mapped_column(String(64), default="")
    hash: Mapped[str] = mapped_column(String(64), default="")

    def payload(self) -> dict[str, Any]:
        """Fields covered by the integrity hash."""
        return {
            "event_id": self.event_id,
            "timestamp": iso(self.timestamp),
            "agent_id": self.agent_id,
            "agent_purpose": self.agent_purpose,
            "user_task": self.user_task,
            "requested_tool": self.requested_tool,
            "resource": self.resource,
            "arguments_summary": self.arguments_summary,
            "policy_result": self.policy_result,
            "llm_result": self.llm_result,
            "behavior_score": self.behavior_score,
            "final_risk": self.final_risk,
            "decision": self.decision,
            "quarantine_state": self.quarantine_state,
            "alert_generated": self.alert_generated,
            "admin_action": self.admin_action,
        }

    def to_dict(self) -> dict[str, Any]:
        return {"seq": self.id, **self.payload(), "prev_hash": self.prev_hash, "hash": self.hash}
