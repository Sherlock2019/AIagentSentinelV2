"""API-level behaviour: kill switch, capability graph, approvals, policies, scenarios."""
import pytest

from app.simulator.scenarios import SCENARIOS

CS, CODING = "customer-support-agent", "coding-agent"


def intercept(client, agent_id, tool, resource="", **extra):
    return client.post("/api/actions/intercept", json={"agent_id": agent_id, "tool": tool, "resource": resource, **extra}).json()


def test_health(client):
    assert client.get("/health").json() == {"status": "healthy", "gateway": "online", "database": "online", "ai_provider": "mock"}


def test_seeded_agents(client):
    agents = client.get("/api/agents").json()
    assert {a["name"] for a in agents} == {"CustomerSupportAgent", "ResearchAgent", "CodingAgent", "FinanceAgent"}
    assert all(a["status"] == "RUNNING" for a in agents)


def test_global_kill_switch_blocks_all_agents(client):
    assert client.post("/api/system/emergency-stop").status_code == 200
    agents = client.get("/api/agents").json()
    assert all(a["status"] == "DISABLED" for a in agents)
    for agent in agents:
        result = intercept(client, agent["id"], "search_kb", "knowledge_base/x")
        assert result["decision"] == "BLOCK"
    # Releasing brings back only what the emergency stop disabled.
    client.post("/api/system/emergency-stop/release")
    assert intercept(client, CS, "search_kb", "knowledge_base/x")["decision"] == "ALLOW"


def test_agent_level_kill_and_restore(client):
    assert client.post(f"/api/agents/{CS}/kill").json()["status"] == "DISABLED"
    assert intercept(client, CS, "search_kb", "knowledge_base/x")["decision"] == "BLOCK"
    assert client.post(f"/api/agents/{CS}/resume").json()["status"] == "RUNNING"
    assert intercept(client, CS, "search_kb", "knowledge_base/x")["decision"] == "ALLOW"


def test_pause_blocks_then_resume(client):
    client.post(f"/api/agents/{CS}/pause")
    assert intercept(client, CS, "search_kb", "knowledge_base/x")["decision"] == "BLOCK"
    client.post(f"/api/agents/{CS}/resume")
    assert intercept(client, CS, "search_kb", "knowledge_base/x")["decision"] == "ALLOW"


def test_admin_can_restore_quarantined_agent_from_alert(client):
    blocked = intercept(client, CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    assert blocked["agent_status"] == "QUARANTINED"
    alert = client.post(f"/api/alerts/{blocked['alert_id']}/restore-agent").json()
    assert (alert["status"], alert["agent_state"]) == ("RESOLVED", "RUNNING")
    assert intercept(client, CODING, "read_repo", "source_repo/storefront")["decision"] == "ALLOW"


def test_capability_graph_identifies_transitive_dangerous_path(client):
    graph = client.get(f"/api/capabilities/{CS}").json()
    finding = next(f for f in graph["findings"] if f["transitive"])
    assert finding["nodes"] == ["CustomerSupportAgent", "workflow_api", "admin_endpoint", "customer_database"]
    assert (finding["access"], finding["severity"]) == ("WRITE", "CRITICAL")
    dangerous = {e["id"] for e in graph["edges"] if e["status"] == "dangerous"}
    assert {"workflow_api->admin_endpoint", "admin_endpoint->customer_database"} <= dangerous
    # The legitimate read path through the CRM stays green.
    assert next(e for e in graph["edges"] if e["id"] == "workflow_api->crm_service")["status"] == "intended"


def test_tool_chain_escape_is_blocked_but_safe_route_is_allowed(client):
    escape = intercept(client, CS, "workflow_api", "workflow/customer-sync", arguments={"endpoint": "admin_endpoint"})
    assert escape["decision"] == "BLOCK"
    assert escape["event"]["capability_result"]["transitive"] is True
    assert escape["event"]["policy_result"]["verdict"] == "ALLOW"  # policy alone would have missed it
    safe = intercept(client, CS, "workflow_api", "workflow/crm-lookup", arguments={"endpoint": "crm_service"})
    assert safe["decision"] == "ALLOW"


def test_human_approval_executes_tool(client):
    held = intercept(client, CS, "refund_customer", "payments/refund/ORDER-9")
    assert held["decision"] == "REVIEW"
    assert [a["id"] for a in client.get("/api/actions/pending").json()] == [held["action_id"]]
    approved = client.post(f"/api/actions/{held['action_id']}/approve").json()
    assert approved["action"]["status"] == "APPROVED"
    assert approved["action"]["result"]["simulated"] is True
    assert client.post(f"/api/actions/{held['action_id']}/approve").status_code == 409


def test_policy_validation_rejects_bad_yaml(client):
    bad = client.put(f"/api/policies/{CS}", json={"yaml": "agent: CustomerSupportAgent\nallow: not-a-list\nbogus: 1\n"})
    assert bad.status_code == 422
    errors = bad.json()["detail"]["errors"]
    assert any("allow" in e for e in errors) and any("bogus" in e for e in errors)


def test_policy_update_changes_enforcement(client):
    assert intercept(client, CS, "summarize", "workspace/notes")["decision"] == "BLOCK"
    policy = next(p for p in client.get("/api/policies").json() if p["agent_id"] == CS)["policy"]
    policy["allow"].append("summarize")
    policy["resources"]["allow"].append("workspace")
    saved = client.put(f"/api/policies/{CS}", json={"policy": policy})
    assert saved.status_code == 200 and saved.json()["version"] == 2
    client.post(f"/api/agents/{CS}/resume") if client.get(f"/api/agents/{CS}").json()["status"] != "RUNNING" else None
    assert intercept(client, CS, "summarize", "workspace/notes")["decision"] == "ALLOW"


def test_create_agent_and_enforce_its_policy(client):
    created = client.post("/api/agents", json={
        "name": "HrHelperAgent", "purpose": "Answer HR policy questions.", "owner": "People Ops",
        "allowed_tools": ["search_kb"], "denied_tools": ["read_secret"], "allowed_resources": ["knowledge_base"],
    })
    assert created.status_code == 201 and created.json()["id"] == "hr-helper-agent"
    assert intercept(client, "hr-helper-agent", "search_kb", "knowledge_base/leave-policy")["decision"] == "ALLOW"
    assert intercept(client, "hr-helper-agent", "read_secret", "VAULT_ROOT_TOKEN")["quarantine"] is True


def test_metrics_and_audit_export(client):
    intercept(client, CODING, "read_prod_secret", "AWS_PRODUCTION_TOKEN")
    totals = client.get("/api/metrics").json()["totals"]
    assert totals["blocked"] == 1 and totals["quarantined_agents"] == 1 and totals["top_risky_tool"] == "read_prod_secret"
    csv_export = client.get("/api/audit/export?format=csv")
    assert csv_export.status_code == 200 and "read_prod_secret" in csv_export.text
    assert client.get("/api/audit").json()["integrity"]["valid"] is True


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_every_scenario_is_deterministic(client, scenario):
    """Each red-team scenario yields its documented outcome in mock mode — twice in a row."""
    for _ in range(2):
        result = client.post("/api/redteam/run", json={"scenario_id": scenario.id}).json()
        assert result["final_decision"] == scenario.expected_decision
        assert result["agent_status"] == scenario.expected_agent_status
        assert result["passed"] is True
