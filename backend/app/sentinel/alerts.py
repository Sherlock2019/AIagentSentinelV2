"""Admin alerting. Email / Slack / webhook are SIMULATED: payloads are stored and
shown in the UI. A real webhook POST happens only if ALERT_WEBHOOK_URL is set
AND the webhook channel is enabled in settings."""
from __future__ import annotations

from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.clock import iso, new_id, utcnow
from app.config import settings
from app.models import Alert

ADMIN_EMAIL = "secops@agentsentinel.demo"
SLACK_CHANNEL = "#ai-agent-alerts"


def _deliveries(alert: Alert, enabled: dict[str, bool]) -> list[dict[str, Any]]:
    attempt = f"{alert.tool}({alert.resource})" if alert.tool else alert.title
    reasons = "\n".join(f"  - {r}" for r in alert.reasons) or "  - (none)"
    response = ", ".join(alert.sentinel_response) or "LOGGED"
    body = (
        f"Severity: {alert.severity}\nAgent: {alert.agent_name}\nAttempt: {attempt}\n"
        f"Risk score: {alert.risk_score}/100\nReasons:\n{reasons}\nSentinel response: {response}\n"
        f"Agent state: {alert.agent_state}"
    )
    payloads: dict[str, dict[str, Any]] = {
        "dashboard": {"alert_id": alert.id, "title": alert.title},
        "email": {"to": ADMIN_EMAIL, "subject": f"[AgentSentinel][{alert.severity}] {alert.title}", "body": body},
        "slack": {
            "channel": SLACK_CHANNEL,
            "text": f":rotating_light: *{alert.severity}* — {alert.agent_name}: `{attempt}` → {response}",
        },
        "webhook": {
            "url": settings.alert_webhook_url or "(not configured — simulated only)",
            "json": {
                "alert_id": alert.id,
                "severity": alert.severity,
                "agent": alert.agent_name,
                "attempt": attempt,
                "risk_score": alert.risk_score,
                "reasons": alert.reasons,
                "response": alert.sentinel_response,
            },
        },
    }
    deliveries = []
    for channel, payload in payloads.items():
        if not enabled.get(channel, False):
            deliveries.append({"channel": channel, "status": "DISABLED", "payload": None})
            continue
        status = "DELIVERED" if channel == "dashboard" else "SIMULATED"
        if channel == "webhook" and settings.alert_webhook_url:
            try:
                httpx.post(settings.alert_webhook_url, json=payload["json"], timeout=3).raise_for_status()
                status = "SENT"
            except Exception as exc:  # alerting must never break enforcement
                status = f"FAILED ({type(exc).__name__})"
        deliveries.append({"channel": channel, "status": status, "payload": payload, "at": iso(utcnow())})
    return deliveries


def create_alert(
    db: Session,
    *,
    agent_id: str,
    agent_name: str,
    severity: str,
    title: str,
    channels: dict[str, bool],
    event_id: Optional[str] = None,
    tool: str = "",
    resource: str = "",
    reasons: Optional[list[str]] = None,
    risk_score: int = 0,
    sentinel_response: Optional[list[str]] = None,
    agent_state: str = "",
) -> Alert:
    alert = Alert(
        id=new_id("alr"),
        event_id=event_id,
        agent_id=agent_id,
        agent_name=agent_name,
        severity=severity,
        title=title,
        tool=tool,
        resource=resource,
        reasons=reasons or [],
        risk_score=risk_score,
        sentinel_response=sentinel_response or [],
        agent_state=agent_state,
        created_at=utcnow(),
    )
    alert.channels = _deliveries(alert, channels)
    db.add(alert)
    db.flush()
    return alert
