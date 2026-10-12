from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import iso, utcnow
from app.database.db import Base

# Agent lifecycle states. Only RUNNING and REVIEW agents may reach the pipeline.
RUNNING, PAUSED, REVIEW, QUARANTINED, DISABLED = "RUNNING", "PAUSED", "REVIEW", "QUARANTINED", "DISABLED"
AGENT_STATES = (RUNNING, PAUSED, REVIEW, QUARANTINED, DISABLED)


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    purpose: Mapped[str] = mapped_column(Text, default="")
    owner: Mapped[str] = mapped_column(String(120), default="")
    environment: Mapped[str] = mapped_column(String(40), default="demo")
    risk_sensitivity: Mapped[str] = mapped_column(String(10), default="MEDIUM")
    status: Mapped[str] = mapped_column(String(20), default=RUNNING)
    # Simulated session credential. Revoked (None) on quarantine / kill.
    session_token: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    current_task: Mapped[str] = mapped_column(Text, default="Idle")
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_activity: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "purpose": self.purpose,
            "owner": self.owner,
            "environment": self.environment,
            "risk_sensitivity": self.risk_sensitivity,
            "status": self.status,
            "session_active": self.session_token is not None,
            "current_task": self.current_task,
            "risk_score": self.risk_score,
            "is_demo": self.is_demo,
            "created_at": iso(self.created_at),
            "last_activity": iso(self.last_activity),
        }


class AgentState(Base):
    """History of every state transition (who, why, when)."""

    __tablename__ = "agent_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(80), index=True)
    from_state: Mapped[str] = mapped_column(String(20))
    to_state: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(40), default="sentinel")
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "from_state": self.from_state,
            "to_state": self.to_state,
            "reason": self.reason,
            "actor": self.actor,
            "timestamp": iso(self.timestamp),
        }


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
