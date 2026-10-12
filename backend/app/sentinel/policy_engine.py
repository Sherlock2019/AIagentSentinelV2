"""Deterministic policy enforcement — the PRIMARY control in AgentSentinel.

Security decisions made here are never negotiable by a model:

    DENY  >  REQUIRE_APPROVAL  >  ALLOW

and anything that is not explicitly listed is denied (default deny).
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import yaml

from app.schemas import PolicyCheck, PolicyResult
from app.simulator.demo_tools import CRITICAL_CATEGORIES, classify_resource, get_tool, resource_sensitivity

QUARANTINE_RULES = [
    "secret_access",
    "iam_modification",
    "audit_tampering",
    "sentinel_bypass",
    "critical_exfiltration",
    "repeated_blocks",
]
_TOP_LEVEL_KEYS = {"agent", "purpose", "allow", "require_approval", "deny", "resources", "network", "limits", "quarantine_rules"}
_TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
# Resource classes whose access is a critical trigger whenever policy denies it.
_CRITICAL_RESOURCES = {
    "production_secrets": "secret_access",
    "iam": "iam_modification",
    "audit_log": "audit_tampering",
    "sentinel_policy": "sentinel_bypass",
}
_RESOURCE_LABEL = {
    "production_secrets": "Secret access prohibited",
    "iam": "IAM modification prohibited",
    "audit_log": "Tampering with audit logging prohibited",
    "sentinel_policy": "Agents may not modify or bypass Sentinel policy",
}


# ------------------------------------------------------------- policy documents
def empty_policy(agent_name: str) -> dict[str, Any]:
    return {
        "agent": agent_name,
        "purpose": [],
        "allow": [],
        "require_approval": [],
        "deny": [],
        "resources": {"allow": [], "deny": []},
        "network": {"allow": []},
        "limits": {"rate_per_minute": 30, "cost_per_minute_usd": 1.0},
        "quarantine_rules": list(QUARANTINE_RULES),
    }


def normalize(doc: dict[str, Any]) -> dict[str, Any]:
    """Fill defaults and de-duplicate so every engine sees the same shape."""
    base = empty_policy(str(doc.get("agent", "")))

    def _list(value: Any) -> list[str]:
        if isinstance(value, str):
            value = [value]
        return list(dict.fromkeys(str(v).strip() for v in (value or []) if str(v).strip()))

    base["purpose"] = _list(doc.get("purpose"))
    for key in ("allow", "require_approval", "deny"):
        base[key] = _list(doc.get(key))
    resources = doc.get("resources") or {}
    base["resources"] = {"allow": _list(resources.get("allow")), "deny": _list(resources.get("deny"))}
    base["network"] = {"allow": _list((doc.get("network") or {}).get("allow"))}
    limits = doc.get("limits") or {}
    base["limits"] = {
        "rate_per_minute": limits.get("rate_per_minute", 30),
        "cost_per_minute_usd": limits.get("cost_per_minute_usd", 1.0),
    }
    if "quarantine_rules" in doc:
        base["quarantine_rules"] = _list(doc.get("quarantine_rules"))
    return base


def to_yaml(doc: dict[str, Any]) -> str:
    return yaml.safe_dump(doc, sort_keys=False, default_flow_style=False)


def parse_yaml(text: str) -> tuple[dict[str, Any] | None, list[str]]:
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        return None, [f"YAML syntax error: {str(exc).splitlines()[0]}"]
    if not isinstance(doc, dict):
        return None, ["Policy must be a YAML mapping (key: value pairs)."]
    return doc, []


def validate(doc: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). A policy with errors is never saved."""
    errors: list[str] = []
    warnings: list[str] = []

    for key in doc:
        if key not in _TOP_LEVEL_KEYS:
            errors.append(f"Unknown key '{key}'. Allowed keys: {', '.join(sorted(_TOP_LEVEL_KEYS))}.")
    if not str(doc.get("agent") or "").strip():
        errors.append("'agent' is required.")

    def _str_list(path: str, value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            errors.append(f"'{path}' must be a list of strings.")
            return []
        return value

    _str_list("purpose", doc.get("purpose"))
    tool_lists = {key: _str_list(key, doc.get(key)) for key in ("allow", "require_approval", "deny")}
    for key, tools in tool_lists.items():
        for tool in tools:
            if not _TOOL_NAME.match(tool):
                errors.append(f"'{key}' contains an invalid tool name '{tool}' (use lowercase snake_case).")

    for section in ("resources", "network", "limits"):
        if doc.get(section) is not None and not isinstance(doc[section], dict):
            errors.append(f"'{section}' must be a mapping.")
    resources = doc.get("resources") if isinstance(doc.get("resources"), dict) else {}
    res_allow = _str_list("resources.allow", resources.get("allow"))
    res_deny = _str_list("resources.deny", resources.get("deny"))
    network = doc.get("network") if isinstance(doc.get("network"), dict) else {}
    _str_list("network.allow", network.get("allow"))

    limits = doc.get("limits") if isinstance(doc.get("limits"), dict) else {}
    rate = limits.get("rate_per_minute", 30)
    cost = limits.get("cost_per_minute_usd", 1.0)
    if isinstance(rate, bool) or not isinstance(rate, int) or rate < 1:
        errors.append("'limits.rate_per_minute' must be a positive integer.")
    if isinstance(cost, bool) or not isinstance(cost, (int, float)) or cost <= 0:
        errors.append("'limits.cost_per_minute_usd' must be a positive number.")

    for rule in _str_list("quarantine_rules", doc.get("quarantine_rules")):
        if rule not in QUARANTINE_RULES:
            errors.append(f"Unknown quarantine rule '{rule}'. Known rules: {', '.join(QUARANTINE_RULES)}.")

    # Conflicts are legal but worth surfacing: the stricter rule always wins.
    deny = set(tool_lists["deny"])
    for tool in sorted(deny & (set(tool_lists["allow"]) | set(tool_lists["require_approval"]))):
        warnings.append(f"'{tool}' is both permitted and denied — DENY wins.")
    for tool in sorted(set(tool_lists["allow"]) & set(tool_lists["require_approval"])):
        warnings.append(f"'{tool}' is in allow and require_approval — approval is required.")
    for res in sorted(set(res_allow) & set(res_deny)):
        warnings.append(f"Resource '{res}' is both allowed and denied — DENY wins.")
    if not tool_lists["allow"] and not tool_lists["require_approval"]:
        warnings.append("No tools are permitted: every action from this agent will be blocked.")
    return errors, warnings


# ------------------------------------------------------------------- evaluation
def match_resource(entries: list[str], resource_class: str, operation: str) -> bool:
    """Entries are 'class' (any operation) or 'class:OPERATION'."""
    op = operation.upper()
    for entry in entries:
        cls, _, entry_op = entry.partition(":")
        if cls in ("*", resource_class) and (not entry_op or entry_op.upper() == op):
            return True
    return False


def extract_hosts(arguments: dict[str, Any]) -> list[str]:
    hosts = []
    for value in arguments.values():
        if isinstance(value, str) and re.match(r"^https?://", value.strip(), re.I):
            host = urlparse(value.strip()).hostname
            if host:
                hosts.append(host.lower())
    return hosts


def evaluate(policy: dict[str, Any], tool: str, resource: str, operation: str, arguments: dict[str, Any]) -> PolicyResult:
    spec = get_tool(tool)
    resource_class = classify_resource(resource, arguments, default=spec.default_resource)
    sensitivity = resource_sensitivity(resource_class)
    checks: list[PolicyCheck] = []
    violations: list[str] = []

    # 1. Tool authorization. Explicit DENY is checked first so it always wins.
    if tool in policy["deny"]:
        tool_status = "FAIL"
        detail = f"'{tool}' is explicitly denied by policy"
        violations.append(f"Tool '{tool}' is explicitly denied by policy")
    elif tool in policy["require_approval"]:
        tool_status, detail = "APPROVAL", f"'{tool}' requires human approval"
    elif tool in policy["allow"]:
        tool_status, detail = "PASS", f"'{tool}' is on the allow list"
    else:
        tool_status = "FAIL"
        detail = f"'{tool}' is not registered for this agent (default deny)"
        violations.append(f"Tool '{tool}' is not authorized for this agent (default deny)")
    checks.append(PolicyCheck(name="Tool Allowed", status=tool_status, detail=detail))

    # 2. Resource authorization.
    res = policy["resources"]
    if match_resource(res["deny"], resource_class, operation):
        res_status = "FAIL"
        detail = f"{operation} on '{resource_class}' is denied by policy"
        violations.append(_RESOURCE_LABEL.get(resource_class, f"{operation} access to '{resource_class}' is prohibited"))
    elif match_resource(res["allow"], resource_class, operation):
        res_status, detail = "PASS", f"{operation} on '{resource_class}' is permitted"
    elif tool_status == "FAIL":
        res_status, detail = "FAIL", f"'{resource_class}' is outside this agent's declared resources"
        if resource_class in _CRITICAL_RESOURCES:
            violations.append(_RESOURCE_LABEL[resource_class])
    else:
        # Permitted tool pointed at a resource nobody listed: fail safe -> human approval.
        res_status, detail = "WARN", f"'{resource_class}' is not listed for this agent — approval required (default deny)"
    checks.append(PolicyCheck(name="Resource Allowed", status=res_status, detail=detail))

    # 3. Network destinations.
    allowed_hosts = {h.lower() for h in policy["network"]["allow"]}
    bad_hosts = [h for h in extract_hosts(arguments) if h not in allowed_hosts]
    if bad_hosts:
        net_status = "FAIL"
        detail = f"Destination {', '.join(bad_hosts)} is not an approved network destination"
        violations.append(f"Network destination '{bad_hosts[0]}' is not approved")
    else:
        net_status, detail = "PASS", "No unapproved network destination"
    checks.append(PolicyCheck(name="Network Destination", status=net_status, detail=detail))

    # 4. Purpose alignment (deterministic view: is this within the declared intent?).
    aligned = tool_status in ("PASS", "APPROVAL") and res_status != "FAIL" and net_status == "PASS"
    if not aligned:
        violations.append("Action does not match the agent's declared purpose")
    checks.append(
        PolicyCheck(
            name="Purpose Alignment",
            status="PASS" if aligned else "FAIL",
            detail="Within declared intent" if aligned else "Outside the agent's declared intent",
        )
    )

    if "FAIL" in (tool_status, res_status, net_status):
        verdict = "DENY"
    elif tool_status == "APPROVAL" or res_status == "WARN":
        verdict = "REQUIRE_APPROVAL"
    else:
        verdict = "ALLOW"

    # Deterministic critical triggers: these bypass scoring entirely.
    triggers: list[str] = []
    if verdict == "DENY":
        if spec.category in CRITICAL_CATEGORIES:
            triggers.append(CRITICAL_CATEGORIES[spec.category])
        if resource_class in _CRITICAL_RESOURCES:
            triggers.append(_CRITICAL_RESOURCES[resource_class])
    triggers = list(dict.fromkeys(triggers))

    if verdict == "DENY":
        risk = 100 if triggers else (85 if spec.known else 75)
    elif verdict == "REQUIRE_APPROVAL":
        risk = 45
    else:
        risk = 5

    return PolicyResult(
        verdict=verdict,
        risk=risk,
        checks=checks,
        violations=violations,
        critical=bool(triggers),
        critical_triggers=triggers,
        tool_category=spec.category,
        resource_class=resource_class,
        resource_sensitivity=sensitivity,
    )
