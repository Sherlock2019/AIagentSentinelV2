#!/usr/bin/env python3
"""AgentSentinel gate for CI/CD (GitHub Actions or any shell).

Submits a proposed action to the Sentinel Gateway BEFORE it runs and turns the
decision into an exit code:

    ALLOW   -> exit 0 (and run the wrapped command, if one was given)
    REVIEW  -> fail, pass, or wait for a human to approve in the dashboard
    BLOCK   -> exit 1; the wrapped command never runs

Standard library only, so it runs on a bare runner with no installs.

    python sentinel_gate.py --url http://sentinel:5173 --agent coding-agent \
        --tool deploy_prod --resource production/storefront -- ./deploy.sh
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

EXIT_ALLOWED, EXIT_BLOCKED, EXIT_NOT_APPROVED, EXIT_UNREACHABLE = 0, 1, 2, 3
ICON = {"ALLOW": "✅", "REVIEW": "🟡", "BLOCK": "⛔"}


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def parse_args(argv: list[str]) -> tuple[argparse.Namespace, list[str]]:
    command: list[str] = []
    if "--" in argv:
        split = argv.index("--")
        argv, command = argv[:split], argv[split + 1 :]
    p = argparse.ArgumentParser(description="Ask AgentSentinel before a CI/CD step runs.")
    p.add_argument("--url", default=env("SENTINEL_URL"), help="Sentinel base URL (dashboard or API origin)")
    p.add_argument("--agent", default=env("SENTINEL_AGENT_ID"), help="Registered agent id, e.g. coding-agent")
    p.add_argument("--tool", default=env("SENTINEL_TOOL"), help="Tool the step is about to use, e.g. deploy_prod")
    p.add_argument("--resource", default=env("SENTINEL_RESOURCE"))
    p.add_argument("--operation", default=env("SENTINEL_OPERATION"))
    p.add_argument("--task", default=env("SENTINEL_TASK"), help="What the agent was asked to do")
    p.add_argument("--arguments", default=env("SENTINEL_ARGUMENTS", "{}"), help="JSON object of tool arguments")
    p.add_argument("--context", default=env("SENTINEL_CONTEXT", "{}"), help="JSON object of extra context")
    p.add_argument("--token", default=env("SENTINEL_AGENT_TOKEN"), help="Agent session token (keep it in a secret)")
    p.add_argument("--on-review", default=env("SENTINEL_ON_REVIEW", "fail"), choices=["fail", "wait", "pass"])
    p.add_argument("--review-timeout", type=int, default=int(env("SENTINEL_REVIEW_TIMEOUT", "600")), help="Seconds to wait for approval")
    p.add_argument("--on-error", default=env("SENTINEL_ON_ERROR", "fail"), choices=["fail", "pass"],
                   help="If Sentinel is unreachable: 'fail' (fail closed, default) or 'pass'")
    p.add_argument("--run", default=env("SENTINEL_RUN"), help="Shell command to run only if the action is allowed")
    return p.parse_args(argv), command


def json_object(text: str, name: str) -> dict:
    try:
        value = json.loads(text or "{}")
    except json.JSONDecodeError as exc:
        sys.exit(f"::error title=AgentSentinel::'{name}' is not valid JSON: {exc}")
    if not isinstance(value, dict):
        sys.exit(f"::error title=AgentSentinel::'{name}' must be a JSON object")
    return value


def call(url: str, body: dict | None = None, timeout: int = 20) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method="POST" if data else "GET", headers={"Content-Type": "application/json", "User-Agent": "agentsentinel-gate/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def ci_context() -> dict:
    """Where this request came from — recorded with the event for the audit trail."""
    fields = {
        "repository": "GITHUB_REPOSITORY", "workflow": "GITHUB_WORKFLOW", "job": "GITHUB_JOB", "run_id": "GITHUB_RUN_ID",
        "actor": "GITHUB_ACTOR", "ref": "GITHUB_REF", "sha": "GITHUB_SHA", "event": "GITHUB_EVENT_NAME",
    }
    context = {key: env(var) for key, var in fields.items() if env(var)}
    context["source"] = "github-actions" if env("GITHUB_ACTIONS") == "true" else "ci"
    if env("GITHUB_SERVER_URL") and context.get("repository") and context.get("run_id"):
        context["run_url"] = f"{env('GITHUB_SERVER_URL')}/{context['repository']}/actions/runs/{context['run_id']}"
    return context


def set_outputs(values: dict) -> None:
    path = env("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}={str(value).replace(chr(10), ' ')}\n")


def write_summary(args: argparse.Namespace, result: dict, final: str, note: str) -> None:
    path = env("GITHUB_STEP_SUMMARY")
    if not path:
        return
    event_url = f"{args.url.rstrip('/')}/inspector/{result['event_id']}"
    lines = [
        f"### {ICON.get(final, '')} AgentSentinel: {final} — `{args.tool}({result['event']['resource']})`",
        "",
        "| | |",
        "| --- | --- |",
        f"| Agent | `{args.agent}` |",
        f"| Decision | **{result['decision']}**{' → ' + note if note else ''} |",
        f"| Risk score | {result['risk_score']} / 100 ({result['severity']}) |",
        f"| Agent state | {result['agent_status']} |",
        f"| Sentinel response | {', '.join(result['response_actions'])} |",
        f"| Evidence | [Open in Event Inspector]({event_url}) |",
        "",
        "**Why**",
        "",
        *[f"{i}. {step}" for i, step in enumerate(result["event"].get("explanation", {}).get("steps") or result["reasons"], start=1)],
        "",
    ]
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def wait_for_human(args: argparse.Namespace, action_id: str) -> str:
    """Poll until an administrator approves or rejects the held action."""
    base = args.url.rstrip("/")
    deadline = time.time() + args.review_timeout
    print(f"[sentinel] Held for human approval. Approve or reject it at {base}/alerts (waiting up to {args.review_timeout}s)", flush=True)
    while time.time() < deadline:
        time.sleep(5)
        try:
            status = call(f"{base}/api/actions/{action_id}")["status"]
        except (urllib.error.URLError, OSError, ValueError):
            continue  # transient: keep waiting, the deadline still applies
        if status != "PENDING_APPROVAL":
            return status
    return "TIMEOUT"


def main() -> int:
    args, command = parse_args(sys.argv[1:])
    for name in ("url", "agent", "tool"):
        if not getattr(args, name):
            sys.exit(f"::error title=AgentSentinel::Missing required input '{name}'")

    body = {
        "agent_id": args.agent, "tool": args.tool, "resource": args.resource, "operation": args.operation,
        "task": args.task or f"CI step in {env('GITHUB_WORKFLOW') or 'pipeline'}",
        "arguments": json_object(args.arguments, "arguments"),
        "context": {**json_object(args.context, "context"), **ci_context()},
    }
    if args.token:
        body["session_token"] = args.token

    try:
        result = call(f"{args.url.rstrip('/')}/api/actions/intercept", body)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        print(f"::error title=AgentSentinel refused the request::HTTP {exc.code}: {detail}")
        set_outputs({"decision": "ERROR", "allowed": "false"})
        return EXIT_UNREACHABLE  # an unknown agent / bad request is never allowed through
    except (urllib.error.URLError, OSError, ValueError) as exc:
        if args.on_error == "pass":
            print(f"::warning title=AgentSentinel unreachable::{exc} — continuing because on-error=pass")
            set_outputs({"decision": "UNAVAILABLE", "allowed": "true"})
            return run_command(args, command)
        print(f"::error title=AgentSentinel unreachable::{exc} — failing closed (set on-error: pass to override)")
        set_outputs({"decision": "UNAVAILABLE", "allowed": "false"})
        return EXIT_UNREACHABLE

    decision, final, note = result["decision"], result["decision"], ""
    print(f"[sentinel] {decision}  risk={result['risk_score']}/100 ({result['severity']})  agent={result['agent_status']}  event={result['event_id']}")
    for reason in result["reasons"]:
        print(f"[sentinel]   - {reason}")

    if decision == "REVIEW":
        if args.on_review == "pass":
            final, note = "ALLOW", "allowed by on-review=pass"
        elif args.on_review == "wait":
            status = wait_for_human(args, result["action_id"])
            final = "ALLOW" if status == "APPROVED" else "BLOCK"
            note = f"human decision: {status}"
            print(f"[sentinel] {note}")
        else:
            note = "human approval required (on-review=fail)"

    allowed = final == "ALLOW"
    set_outputs({
        "decision": decision, "final-decision": final, "allowed": str(allowed).lower(), "risk-score": result["risk_score"],
        "severity": result["severity"], "event-id": result["event_id"], "agent-status": result["agent_status"],
        "inspector-url": f"{args.url.rstrip('/')}/inspector/{result['event_id']}",
    })
    write_summary(args, result, final, note)

    if not allowed:
        title = "AgentSentinel blocked this step" if decision == "BLOCK" else "AgentSentinel: human approval required"
        print(f"::error title={title}::{args.tool}({result['event']['resource']}) — {result['reasons'][0]}{' — ' + note if note else ''}")
        if result.get("quarantine"):
            print(f"::error title=Agent quarantined::{args.agent} is quarantined; every further step is refused until an administrator restores it.")
        return EXIT_BLOCKED if decision == "BLOCK" else EXIT_NOT_APPROVED
    return run_command(args, command)


def run_command(args: argparse.Namespace, command: list[str]) -> int:
    """Run the guarded command. Reached only after an ALLOW (or an explicit pass)."""
    if command:
        return subprocess.call(command)
    if args.run:
        return subprocess.call(["bash", "-eo", "pipefail", "-c", args.run])
    return EXIT_ALLOWED


if __name__ == "__main__":
    sys.exit(main())
