"""Typed request bodies and the typed results passed between Sentinel engines."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Decision = Literal["ALLOW", "REVIEW", "BLOCK"]


# ----------------------------------------------------------------- API requests
class InterceptRequest(BaseModel):
    agent_id: str
    task: str = ""
    tool: str = Field(min_length=1)
    resource: str = ""
    operation: str = ""
    arguments: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)
    session_token: Optional[str] = None


class AgentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    purpose: str = Field(min_length=3)
    owner: str = ""
    environment: str = "demo"
    allowed_tools: list[str] = Field(default_factory=list)
    approval_tools: list[str] = Field(default_factory=list)
    denied_tools: list[str] = Field(default_factory=list)
    allowed_resources: list[str] = Field(default_factory=list)
    denied_resources: list[str] = Field(default_factory=list)
    network_destinations: list[str] = Field(default_factory=list)
    rate_limit_per_min: int = Field(default=30, ge=1, le=10_000)
    cost_limit_per_min: float = Field(default=1.0, gt=0)
    risk_sensitivity: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"


class PolicyUpdate(BaseModel):
    yaml: Optional[str] = None
    policy: Optional[dict[str, Any]] = None


class RedTeamRun(BaseModel):
    scenario_id: str


class SettingsUpdate(BaseModel):
    threshold_medium: Optional[int] = Field(default=None, ge=1, le=99)
    threshold_high: Optional[int] = Field(default=None, ge=1, le=99)
    threshold_critical: Optional[int] = Field(default=None, ge=1, le=100)
    auto_quarantine_enabled: Optional[bool] = None
    blocked_retry_threshold: Optional[int] = Field(default=None, ge=2, le=20)
    global_policy_mode: Optional[Literal["ENFORCE", "STRICT"]] = None
    llm_judge_enabled: Optional[bool] = None
    alert_channels: Optional[dict[str, bool]] = None


# --------------------------------------------------------------- engine results
class PolicyCheck(BaseModel):
    name: str
    status: Literal["PASS", "FAIL", "APPROVAL", "WARN"]
    detail: str


class PolicyResult(BaseModel):
    verdict: Literal["ALLOW", "REQUIRE_APPROVAL", "DENY"]
    risk: int
    checks: list[PolicyCheck]
    violations: list[str] = Field(default_factory=list)
    critical: bool = False
    critical_triggers: list[str] = Field(default_factory=list)
    tool_category: str = ""
    resource_class: str = ""
    resource_sensitivity: int = 0


class CapabilityResult(BaseModel):
    verdict: Decision = "ALLOW"
    risk: int = 0
    transitive: bool = False
    paths: list[dict[str, Any]] = Field(default_factory=list)
    summary: str = "No downstream capability risk."
    max_sensitivity: int = 0


class BehaviorSignal(BaseModel):
    name: str
    score: int
    detail: str


class BehaviorResult(BaseModel):
    score: int
    signals: list[BehaviorSignal] = Field(default_factory=list)
    rate_exceeded: bool = False
    calls_last_minute: int = 0
    blocked_last_window: int = 0


class SafetyVerdict(BaseModel):
    """LLM safety judge output. Risk dimensions: 1 = safe, 5 = severe.
    intent_alignment and necessity are positive scales: 5 = fully aligned / necessary."""

    intent_alignment: int = 3
    authorization_risk: int = 3
    data_risk: int = 3
    injection_risk: int = 1
    privilege_risk: int = 1
    necessity: int = 3
    reversibility_risk: int = 1
    overall_risk: int = 3
    recommended_decision: Decision = "REVIEW"
    summary: str = ""
    # Filled in by the judge wrapper, never by the model:
    provider: str = "mock"
    available: bool = True
    degraded_reason: Optional[str] = None
    risk: int = 0
    injection_indicators: list[str] = Field(default_factory=list)


class RiskResult(BaseModel):
    score: int
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    components: dict[str, int]
    weights: dict[str, float]
    weighted_score: float
    multiplier: float = 1.0
    overrides: list[str] = Field(default_factory=list)
    formula: str = ""


class DecisionResult(BaseModel):
    decision: Decision
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    reasons: list[str]
    quarantine: bool = False
    quarantine_reason: str = ""
    pause: bool = False
    alert: bool = False
    drivers: list[str] = Field(default_factory=list)  # which engine forced the outcome
