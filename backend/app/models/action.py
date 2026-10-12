from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import iso, utcnow
from app.database.db import Base


class Action(Base):
    """A tool call proposed by an agent, and what ultimately happened to it."""

    __tablename__ = "actions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(80), index=True)
    task: Mapped[str] = mapped_column(Text, default="")
    tool: Mapped[str] = mapped_column(String(80))
    resource: Mapped[str] = mapped_column(String(200), default="")
    operation: Mapped[str] = mapped_column(String(20), default="")
    arguments: Mapped[Any] = mapped_column(JSON, default=dict)
    context: Mapped[Any] = mapped_column(JSON, default=dict)
    # RECEIVED | EXECUTED | PENDING_APPROVAL | APPROVED | REJECTED | BLOCKED | CANCELLED
    status: Mapped[str] = mapped_column(String(20), default="RECEIVED")
    result: Mapped[Any] = mapped_column(JSON, nullable=True)
    event_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    reasons: Mapped[Any] = mapped_column(JSON, default=list)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "task": self.task,
            "tool": self.tool,
            "resource": self.resource,
            "operation": self.operation,
            "arguments": self.arguments or {},
            "status": self.status,
            "result": self.result,
            "event_id": self.event_id,
            "risk_score": self.risk_score,
            "reasons": self.reasons or [],
            "timestamp": iso(self.timestamp),
            "resolved_at": iso(self.resolved_at),
        }


class Event(Base):
    """A Sentinel security decision (kind=ACTION) or system response (kind=SYSTEM)."""

    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), default="ACTION")
    action_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    agent_id: Mapped[str] = mapped_column(String(80), index=True)
    agent_name: Mapped[str] = mapped_column(String(120), default="")
    agent_purpose: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    task: Mapped[str] = mapped_column(Text, default="")
    tool: Mapped[str] = mapped_column(String(80), default="")
    resource: Mapped[str] = mapped_column(String(200), default="")
    resource_class: Mapped[str] = mapped_column(String(60), default="")
    operation: Mapped[str] = mapped_column(String(20), default="")
    arguments: Mapped[Any] = mapped_column(JSON, default=dict)
    context: Mapped[Any] = mapped_column(JSON, default=dict)
    decision: Mapped[str] = mapped_column(String(10), default="INFO")  # ALLOW | REVIEW | BLOCK | INFO
    severity: Mapped[str] = mapped_column(String(10), default="LOW")
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    reasons: Mapped[Any] = mapped_column(JSON, default=list)
    explanation: Mapped[Any] = mapped_column(JSON, default=dict)
    policy_result: Mapped[Any] = mapped_column(JSON, nullable=True)
    llm_result: Mapped[Any] = mapped_column(JSON, nullable=True)
    behavior_result: Mapped[Any] = mapped_column(JSON, nullable=True)
    capability_result: Mapped[Any] = mapped_column(JSON, nullable=True)
    risk_breakdown: Mapped[Any] = mapped_column(JSON, nullable=True)
    recent_actions: Mapped[Any] = mapped_column(JSON, default=list)
    response_actions: Mapped[Any] = mapped_column(JSON, default=list)
    quarantined: Mapped[bool] = mapped_column(Boolean, default=False)
    agent_status_after: Mapped[str] = mapped_column(String(20), default="")
    alert_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    injection_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    scenario: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    timings: Mapped[Any] = mapped_column(JSON, default=dict)
    admin_action: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "action_id": self.action_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "timestamp": iso(self.timestamp),
            "task": self.task,
            "tool": self.tool,
            "resource": self.resource,
            "operation": self.operation,
            "decision": self.decision,
            "severity": self.severity,
            "risk_score": self.risk_score,
            "reasons": self.reasons or [],
            "response_actions": self.response_actions or [],
            "quarantined": self.quarantined,
            "agent_status_after": self.agent_status_after,
            "alert_id": self.alert_id,
            "injection_detected": self.injection_detected,
            "scenario": self.scenario,
            # Where the request came from, when the caller says (e.g. "github-actions").
            "source": (self.context or {}).get("source") if isinstance(self.context, dict) else None,
            "message": self.message,
            "admin_action": self.admin_action,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.summary(),
            "agent_purpose": self.agent_purpose,
            "resource_class": self.resource_class,
            "arguments": self.arguments or {},
            "context": self.context or {},
            "explanation": self.explanation or {},
            "policy_result": self.policy_result,
            "llm_result": self.llm_result,
            "behavior_result": self.behavior_result,
            "capability_result": self.capability_result,
            "risk_breakdown": self.risk_breakdown,
            "recent_actions": self.recent_actions or [],
            "timings": self.timings or {},
        }


class BehaviorHistory(Base):
    """Rolling per-agent activity used by the behaviour engine."""

    __tablename__ = "behavior_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(80), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    tool: Mapped[str] = mapped_column(String(80))
    resource: Mapped[str] = mapped_column(String(200), default="")
    resource_class: Mapped[str] = mapped_column(String(60), default="")
    decision: Mapped[str] = mapped_column(String(10))
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    # Only blocks produced by the decision pipeline count toward the N-strikes rule
    # (calls rejected because the agent is already paused/quarantined do not).
    counted: Mapped[bool] = mapped_column(Boolean, default=True)
    sensitivity: Mapped[int] = mapped_column(Integer, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    # Baseline rows describe the agent's historical norm and survive session resets.
    baseline: Mapped[bool] = mapped_column(Boolean, default=False)
