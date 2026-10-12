"""Admin-tunable Sentinel settings, persisted in the system_settings table."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import SystemSetting

DEFAULTS: dict[str, Any] = {
    # Risk thresholds: score >= value enters that level.
    "threshold_medium": 30,
    "threshold_high": 55,
    "threshold_critical": 80,
    "auto_quarantine_enabled": True,
    "blocked_retry_threshold": 3,
    "blocked_retry_window_seconds": 60,
    # ENFORCE: MEDIUM risk is allowed and logged. STRICT: MEDIUM risk needs human approval.
    "global_policy_mode": "ENFORCE",
    "llm_judge_enabled": True,
    "alert_channels": {"dashboard": True, "email": True, "slack": True, "webhook": False},
    "emergency_stop_active": False,
}


def get_settings(db: Session) -> dict[str, Any]:
    merged = dict(DEFAULTS)
    for row in db.query(SystemSetting).all():
        merged[row.key] = row.value
    return merged


def update_settings(db: Session, changes: dict[str, Any]) -> dict[str, Any]:
    for key, value in changes.items():
        if key not in DEFAULTS:
            continue
        row = db.get(SystemSetting, key)
        if row:
            row.value = value
        else:
            db.add(SystemSetting(key=key, value=value))
    db.flush()
    return get_settings(db)
