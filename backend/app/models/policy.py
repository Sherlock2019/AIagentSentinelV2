from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import iso, utcnow
from app.database.db import Base


class Policy(Base):
    """An agent's DECLARED INTENT: the normalized policy document (see policy_engine)."""

    __tablename__ = "policies"

    agent_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    doc: Mapped[Any] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "policy": self.doc,
            "version": self.version,
            "updated_at": iso(self.updated_at),
        }


class CapabilityEdge(Base):
    """What a tool or downstream service can reach (tool -> service -> resource)."""

    __tablename__ = "capability_edges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(80), index=True)
    target: Mapped[str] = mapped_column(String(80))
    access: Mapped[str] = mapped_column(String(20), default="CALLS")  # CALLS | READ | WRITE | DELETE | EXECUTE
