"""CI/CD integration: agent tokens, action polling, the pipeline demo and the gate CLI."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import settings

CODING = "coding-agent"
GATE = Path(__file__).resolve().parents[2] / "github-action" / "sentinel_gate.py"


def intercept(client, **body):
    return client.post("/api/actions/intercept", json={"agent_id": CODING, **body}).json()


def test_pipeline_demo_allows_tests_holds_patch_blocks_deploy(client):
    for _ in range(2):  # reproducible on repeat
        run = client.post("/api/integrations/github/pipeline/run").json()
        assert [(j["job"], j["response"]["decision"], j["outcome"], j["command_ran"]) for j in run["jobs"]] == [
            ("test", "ALLOW", "success", True),
            ("patch", "REVIEW", "waiting", False),
            ("deploy", "BLOCK", "failure", False),
        ]
        assert run["agent"]["status"] == "RUNNING"
    # The held patch is a real pending action an admin can approve.
    action_id = run["jobs"][1]["response"]["action_id"]
    assert client.post(f"/api/actions/{action_id}/approve").json()["action"]["status"] == "APPROVED"


def mock_run(client, scenario, **extra):
    return client.post("/api/integrations/github/run", json={"scenario": scenario, **extra})


@pytest.mark.parametrize(
    "scenario, decisions, conclusion, agent_status",
    [
        ("safe_review", ["ALLOW", "ALLOW", "ALLOW"], "success", "RUNNING"),
        ("patch_approval", ["ALLOW", "ALLOW", "ALLOW", "REVIEW"], "waiting", "RUNNING"),
        ("prompt_injection", ["ALLOW", "BLOCK", "BLOCK"], "failure", "QUARANTINED"),
    ],
)
def test_mock_github_run_outcomes(client, scenario, decisions, conclusion, agent_status):
    for _ in range(2):  # reproducible on repeat, even after a quarantine
        run = mock_run(client, scenario).json()
        assert [s["response"]["decision"] for s in run["steps"]] == decisions
        assert (run["conclusion"], run["agent"]["status"], run["matches_expected"]) == (conclusion, agent_status, True)


def test_mock_run_injection_is_detected_and_retry_is_refused(client):
    steps = mock_run(client, "prompt_injection").json()["steps"]
    assert steps[1]["response"]["event"]["injection_detected"] is True
    assert steps[1]["response"]["quarantine"] is True
    assert "QUARANTINED" in steps[2]["response"]["reasons"][0]  # the allowed tool no longer works


def test_mock_run_uses_the_github_url_as_a_label_only(client):
    run = mock_run(client, "safe_review", commit_url="https://github.com/acme/storefront/commit/ABCDEF1234567", trigger="pull_request").json()
    assert (run["repository"], run["sha"], run["trigger"]) == ("acme/storefront", "abcdef1234567", "pull_request")
    event = client.get(f"/api/events/{run['steps'][0]['response']['event_id']}").json()
    assert event["source"] == "github-actions" and event["context"]["repository"] == "acme/storefront"
    assert mock_run(client, "safe_review", commit_url="https://github.com/acme/storefront").json()["repository"] == "acme/storefront"
    for bad in ("not a url", "https://gitlab.com/acme/storefront", "https://github.com/acme"):
        assert mock_run(client, "safe_review", commit_url=bad).status_code == 422
    assert mock_run(client, "nope").status_code == 404


def test_ci_can_poll_a_held_action_until_a_human_decides(client):
    held = intercept(client, tool="apply_patch", resource="source_repo/x")
    assert client.get(f"/api/actions/{held['action_id']}").json()["status"] == "PENDING_APPROVAL"
    client.post(f"/api/actions/{held['action_id']}/approve")
    assert client.get(f"/api/actions/{held['action_id']}").json()["status"] == "APPROVED"
    assert client.get("/api/actions/act_missing").status_code == 404


def test_token_rotation_revokes_the_old_token(client):
    first = client.post(f"/api/integrations/agents/{CODING}/token").json()["token"]
    assert intercept(client, tool="run_tests", resource="ci_sandbox/x", session_token=first)["decision"] == "ALLOW"
    second = client.post(f"/api/integrations/agents/{CODING}/token").json()["token"]
    assert second != first
    stale = intercept(client, tool="run_tests", resource="ci_sandbox/x", session_token=first)
    assert stale["decision"] == "BLOCK" and "Invalid agent session token" in stale["reasons"][0]


def test_token_cannot_be_issued_for_a_quarantined_agent(client):
    intercept(client, tool="read_prod_secret", resource="AWS_PRODUCTION_TOKEN")
    assert client.post(f"/api/integrations/agents/{CODING}/token").status_code == 409


def test_require_agent_token_mode(client, monkeypatch):
    monkeypatch.setattr(settings, "require_agent_token", True)
    anonymous = intercept(client, tool="run_tests", resource="ci_sandbox/x")
    assert anonymous["decision"] == "BLOCK" and "token required" in anonymous["reasons"][0]
    token = client.post(f"/api/integrations/agents/{CODING}/token").json()["token"]
    assert intercept(client, tool="run_tests", resource="ci_sandbox/x", session_token=token)["decision"] == "ALLOW"
    # Sentinel's own simulator still works in this mode.
    assert client.post("/api/redteam/run", json={"scenario_id": "safe_action"}).json()["passed"] is True


@pytest.fixture()
def live_server(db):
    """A real HTTP server, because the gate CLI talks HTTP like a runner would."""
    import threading
    import time

    import uvicorn

    from app.main import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8765, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield "http://127.0.0.1:8765"
    server.should_exit = True
    thread.join(timeout=5)


def gate(url, tmp_path, *args, env_extra=None):
    out, summary = tmp_path / "out.txt", tmp_path / "summary.md"
    out.write_text(""), summary.write_text("")
    env = {"PATH": "/usr/bin:/bin", "GITHUB_ACTIONS": "true", "GITHUB_OUTPUT": str(out), "GITHUB_STEP_SUMMARY": str(summary),
           "GITHUB_REPOSITORY": "acme/storefront", "GITHUB_RUN_ID": "42", "GITHUB_SERVER_URL": "https://github.com", **(env_extra or {})}
    proc = subprocess.run([sys.executable, str(GATE), "--url", url, "--agent", CODING, *args], capture_output=True, text=True, env=env, timeout=60)
    outputs = dict(line.split("=", 1) for line in out.read_text().splitlines() if "=" in line)
    return proc, outputs, summary.read_text()


def test_gate_cli_allow_runs_the_command(live_server, tmp_path):
    marker = tmp_path / "ran"
    proc, outputs, summary = gate(live_server, tmp_path, "--tool", "run_tests", "--resource", "ci_sandbox/x", "--run", f"touch {marker}")
    assert proc.returncode == 0 and marker.exists()
    assert outputs["decision"] == "ALLOW" and outputs["allowed"] == "true"
    assert "AgentSentinel: ALLOW" in summary


def test_gate_cli_block_fails_and_never_runs_the_command(live_server, tmp_path):
    marker = tmp_path / "ran"
    proc, outputs, summary = gate(live_server, tmp_path, "--tool", "deploy_prod", "--resource", "production/x", "--run", f"touch {marker}")
    assert proc.returncode == 1 and not marker.exists()
    assert outputs["decision"] == "BLOCK" and outputs["allowed"] == "false"
    assert "::error title=AgentSentinel blocked this step" in proc.stdout
    assert "Open in Event Inspector" in summary


def test_gate_cli_review_fails_by_default_and_passes_json_arguments(live_server, tmp_path):
    proc, outputs, _ = gate(live_server, tmp_path, "--tool", "apply_patch", "--resource", "source_repo/x", "--arguments", json.dumps({"files": 3}))
    assert proc.returncode == 2 and outputs["decision"] == "REVIEW" and outputs["allowed"] == "false"


def test_gate_cli_fails_closed_when_sentinel_is_unreachable(tmp_path):
    marker = tmp_path / "ran"
    proc, outputs, _ = gate("http://127.0.0.1:9", tmp_path, "--tool", "run_tests", "--run", f"touch {marker}")
    assert proc.returncode == 3 and not marker.exists() and outputs["allowed"] == "false"
