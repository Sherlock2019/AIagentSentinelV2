"""Core enforcement guarantees of the Sentinel gateway."""
from app.models import Action, Agent, Alert, AuditLog, Policy
from app.providers import set_provider_override
from app.providers.base import SafetyProvider
from app.sentinel import audit

CS, RESEARCH, CODING, FINANCE = "customer-support-agent", "research-agent", "coding-agent", "finance-agent"


def status(db, agent_id):
    db.expire_all()
    return db.get(Agent, agent_id).status


def test_allowed_tool_passes(call):
    result = call(CS, "search_kb", "knowledge_base/refund-policy")
    assert result["decision"] == "ALLOW"
    assert result["severity"] == "LOW"
    assert result["tool_result"]["simulated"] is True


def test_denied_tool_blocks(call):
    result = call(CS, "execute_shell", "host_system/prod-web-01")
    assert result["decision"] == "BLOCK"
    assert result["tool_result"] is None  # the tool never ran


def test_unknown_tool_is_denied_by_default(call):
    result = call(CS, "send_fax", "workspace/doc")
    assert result["decision"] == "BLOCK"
    assert any("default deny" in r for r in result["reasons"])


def test_approval_required_tool_enters_review(db, call):
    result = call(CS, "refund_customer", "payments/refund/ORDER-1")
    assert result["decision"] == "REVIEW"
    assert result["tool_result"] is None
    assert db.get(Action, result["action_id"]).status == "PENDING_APPROVAL"


def test_secret_access_blocks(call):
    result = call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    assert result["decision"] == "BLOCK"
    assert result["severity"] == "CRITICAL"
    assert any("Secret access prohibited" in r for r in result["reasons"])


def test_hero_scenario_scores(call):
    """The headline demo numbers are reproducible, not hand-painted."""
    event = call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN", task="Review this application source code.")["event"]
    assert event["risk_score"] == 98
    assert event["behavior_result"]["score"] == 91
    llm = event["llm_result"]
    assert (llm["intent_alignment"], llm["authorization_risk"], llm["data_risk"], llm["privilege_risk"]) == (1, 5, 5, 5)
    assert [c["status"] for c in event["policy_result"]["checks"] if c["name"] != "Network Destination"] == ["FAIL", "FAIL", "FAIL"]


def test_secret_hidden_in_arguments_is_still_caught(call):
    """An allowed tool pointed at a secret via its arguments must not slip through."""
    result = call(CODING, "read_repo", "source_repo/storefront", arguments={"path": "config/prod.env"})
    assert result["decision"] == "BLOCK"
    assert result["quarantine"] is True


def test_iam_escalation_blocks(call):
    result = call(CODING, "modify_iam", "iam/roles/ci-runner", arguments={"attach_policy": "AdministratorAccess"})
    assert result["decision"] == "BLOCK"
    assert result["quarantine"] is True


def test_critical_violation_quarantines_agent(db, call):
    result = call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    assert result["quarantine"] is True
    assert result["agent_status"] == "QUARANTINED"
    agent = db.get(Agent, CODING)
    assert agent.status == "QUARANTINED"
    assert agent.session_token is None  # session revoked


def test_quarantined_agent_cannot_act(call):
    call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    result = call(CODING, "read_repo", "source_repo/storefront")  # normally allowed
    assert result["decision"] == "BLOCK"
    assert "QUARANTINED" in result["reasons"][0]
    assert result["tool_result"] is None


def test_quarantine_cancels_pending_actions(db, call):
    pending = call(CODING, "apply_patch", "source_repo/storefront")
    assert pending["decision"] == "REVIEW"
    call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    db.expire_all()
    assert db.get(Action, pending["action_id"]).status == "CANCELLED"


def test_three_blocked_actions_trigger_quarantine(db, call):
    first = call(RESEARCH, "read_private_db", "private_db/a")
    second = call(RESEARCH, "read_private_db", "private_db/b")
    assert (first["decision"], first["quarantine"]) == ("BLOCK", False)
    assert (second["decision"], second["quarantine"]) == ("BLOCK", False)
    assert status(db, RESEARCH) == "RUNNING"
    third = call(RESEARCH, "read_private_db", "private_db/c")
    assert (third["decision"], third["quarantine"]) == ("BLOCK", True)
    assert status(db, RESEARCH) == "QUARANTINED"


def test_runaway_loop_pauses_agent(db, call):
    decisions = [call(RESEARCH, "web_search_sim", "public_web/x")["decision"] for _ in range(21)]
    assert decisions[:20] == ["ALLOW"] * 20
    assert decisions[20] == "BLOCK"
    assert status(db, RESEARCH) == "PAUSED"


class AlwaysAllowProvider(SafetyProvider):
    """A compromised / wrong model that approves everything."""

    name = "always-allow"

    def evaluate(self, ctx):
        return {
            "intent_alignment": 5, "authorization_risk": 1, "data_risk": 1, "injection_risk": 1, "privilege_risk": 1,
            "necessity": 5, "reversibility_risk": 1, "overall_risk": 1, "recommended_decision": "ALLOW", "summary": "Looks fine.",
        }


class BrokenProvider(SafetyProvider):
    name = "broken"

    def evaluate(self, ctx):
        raise TimeoutError("model unreachable")


def test_policy_deny_overrides_llm_recommendation(call):
    set_provider_override(AlwaysAllowProvider())
    result = call(CS, "execute_shell", "host_system/prod-web-01")
    assert result["event"]["llm_result"]["recommended_decision"] == "ALLOW"
    assert result["decision"] == "BLOCK"


def test_llm_cannot_override_deterministic_deny(db, call):
    set_provider_override(AlwaysAllowProvider())
    result = call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    assert result["decision"] == "BLOCK"
    assert result["severity"] == "CRITICAL"  # critical floor holds even with a 'safe' LLM verdict
    assert status(db, CODING) == "QUARANTINED"


def test_llm_cannot_bypass_required_approval(call):
    set_provider_override(AlwaysAllowProvider())
    assert call(CS, "refund_customer", "payments/refund/ORDER-1")["decision"] == "REVIEW"


def test_llm_failure_fails_safe(call):
    set_provider_override(BrokenProvider())
    sensitive = call(FINANCE, "create_payment_request", "payments/vendor/ACME")
    assert sensitive["event"]["llm_result"]["available"] is False
    assert sensitive["decision"] == "REVIEW"
    assert call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")["decision"] == "BLOCK"


def test_prompt_injection_scenario_blocks(db, client):
    result = client.post("/api/redteam/run", json={"scenario_id": "prompt_injection"}).json()
    assert result["passed"] is True
    final = result["steps"][-1]["response"]
    assert final["decision"] == "BLOCK"
    assert final["event"]["injection_detected"] is True
    assert final["event"]["llm_result"]["injection_risk"] == 5


def test_audit_record_is_created_and_chain_is_valid(db, call):
    before = db.query(AuditLog).count()
    result = call(CS, "search_kb", "knowledge_base/refund-policy")
    record = db.query(AuditLog).filter(AuditLog.event_id == result["event_id"]).one()
    assert db.query(AuditLog).count() == before + 1
    assert (record.decision, record.requested_tool, record.policy_result) == ("ALLOW", "search_kb", "ALLOW")
    assert audit.verify_chain(db)["valid"] is True


def test_audit_tampering_is_detected(db, call):
    call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    record = db.query(AuditLog).filter(AuditLog.decision == "BLOCK").first()
    record.decision = "ALLOW"  # rewrite history
    db.commit()
    assert audit.verify_chain(db)["valid"] is False


def test_admin_alert_is_generated(db, call):
    result = call(CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    assert result["alert"] is True
    alert = db.get(Alert, result["alert_id"])
    assert alert.severity == "CRITICAL"
    assert alert.agent_state == "QUARANTINED"
    assert {c["channel"] for c in alert.channels} == {"dashboard", "email", "slack", "webhook"}


def test_explicit_deny_beats_allow(db, call):
    """DENY > REQUIRE_APPROVAL > ALLOW, even when a tool is on several lists."""
    policy = db.get(Policy, CS)
    policy.doc = {**policy.doc, "deny": [*policy.doc["deny"], "search_kb"]}
    db.commit()
    assert call(CS, "search_kb", "knowledge_base/refund-policy")["decision"] == "BLOCK"


def test_unknown_agent_is_refused(client):
    response = client.post("/api/actions/intercept", json={"agent_id": "ghost", "tool": "search_kb"})
    assert response.status_code == 404
