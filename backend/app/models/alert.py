from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import iso, utcnow
from app.database.db import Base


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    event_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    agent_id: Mapped[str] = mapped_column(String(80), index=True)
    agent_name: Mapped[str] = mapped_column(String(120), default="")
    severity: Mapped[str] = mapped_column(String(10), default="INFO")  # INFO | WARNING | HIGH | CRITICAL
    title: Mapped[str] = mapped_column(Text, default="")
    tool: Mapped[str] = mapped_column(String(80), default="")
    resource: Mapped[str] = mapped_column(String(200), default="")
    reasons: Mapped[Any] = mapped_column(JSON, default=list)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    sentinel_response: Mapped[Any] = mapped_column(JSON, default=list)
    agent_state: Mapped[str] = mapped_column(String(20), default="")
    status: Mapped[str] = mapped_column(String(20), default="OPEN")  # OPEN | ACKNOWLEDGED | INVESTIGATING | RESOLVED
    admin_action: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    # One simulated delivery record per channel (dashboard / email / slack / webhook).
    channels: Mapped[Any] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "event_id": self.event_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "severity": self.severity,
            "title": self.title,
            "tool": self.tool,
            "resource": self.resource,
            "reasons": self.reasons or [],
            "risk_score": self.risk_score,
            "sentinel_response": self.sentinel_response or [],
            "agent_state": self.agent_state,
            "status": self.status,
            "admin_action": self.admin_action,
            "channels": self.channels or [],
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
        }
