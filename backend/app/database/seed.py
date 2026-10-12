"""Database initialization + reproducible demo seeding.

    python -m app.database.seed            # create tables, seed only if empty
    python -m app.database.seed --reset    # wipe and re-seed
"""
from __future__ import annotations

import sys
from datetime import timedelta

from sqlalchemy.orm import Session

from app import clock
from app.database.db import Base, SessionLocal, init_db
from app.database.settings_store import DEFAULTS, update_settings
from app.models import Action, Agent, BehaviorHistory, CapabilityEdge, Policy
from app.schemas import InterceptRequest
from app.sentinel import gateway, policy_engine, quarantine
from app.simulator.demo_agents import DEMO_AGENTS, SERVICE_EDGES, WARMUP_TRAFFIC
from app.simulator.demo_tools import TOOLS


def _seed_static(db: Session) -> None:
    created = clock.utcnow() - timedelta(days=14)
    for spec in DEMO_AGENTS:
        db.add(Agent(
            id=spec["id"], name=spec["name"], purpose=spec["purpose"], owner=spec["owner"],
            environment=spec["environment"], risk_sensitivity=spec["risk_sensitivity"],
            session_token=quarantine.new_session_token(), is_demo=True, created_at=created,
        ))
        db.add(Policy(agent_id=spec["id"], doc=policy_engine.normalize(spec["policy"]), updated_at=created))

    downstream = {source for source, _, _ in SERVICE_EDGES}
    for tool in TOOLS.values():
        if tool.name not in downstream:  # tools that call services reach resources only through them
            db.add(CapabilityEdge(source=tool.name, target=tool.default_resource, access=tool.operation))
    for source, target, access in SERVICE_EDGES:
        db.add(CapabilityEdge(source=source, target=target, access=access))
    update_settings(db, dict(DEFAULTS))
    db.commit()


def _seed_history(db: Session) -> None:
    """Replay benign traffic through the real gateway so dashboards start with real data."""
    now = clock.utcnow()
    for minutes_ago, agent_id, task, tool, resource, arguments in WARMUP_TRAFFIC:
        with clock.frozen(now - timedelta(minutes=minutes_ago)):
            result = gateway.intercept(db, InterceptRequest(agent_id=agent_id, task=task, tool=tool, resource=resource, arguments=arguments), internal=True)
            assert result["decision"] == "ALLOW", f"warm-up action {tool} unexpectedly {result['decision']}"

    # One historical human-approval round trip (refund approved four hours ago).
    with clock.frozen(now - timedelta(minutes=238)):
        held = gateway.intercept(db, InterceptRequest(
            agent_id="customer-support-agent", task="Refund a duplicate charge", tool="refund_customer",
            resource="payments/refund/ORDER-7702", arguments={"order_id": "ORDER-7702", "amount": 42.5, "currency": "USD"},
        ), internal=True)
    with clock.frozen(now - timedelta(minutes=235)):
        gateway.resolve_approval(db, db.get(Action, held["action_id"]), approve=True, actor="admin")

    # Everything so far is the agents' historical norm.
    db.query(BehaviorHistory).update({BehaviorHistory.baseline: True})
    for agent in db.query(Agent).all():
        agent.risk_score = min(agent.risk_score, 14)
        agent.current_task = "Idle"
    db.commit()


def seed(db: Session, reset: bool = False) -> bool:
    """Returns True if data was written."""
    init_db()
    if reset:
        # Delete rows rather than dropping tables so concurrent readers never see a missing table.
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(table.delete())
        db.commit()
    if db.query(Agent).count() > 0:
        return False
    _seed_static(db)
    _seed_history(db)
    return True


def main() -> None:
    reset = "--reset" in sys.argv
    with SessionLocal() as db:
        wrote = seed(db, reset=reset)
        agents = db.query(Agent).count()
    print(f"[seed] {'seeded' if wrote else 'already seeded'} — {agents} agents ready")


if __name__ == "__main__":
    main()
