"""Capability-path analysis.

Policies say which tools an agent may call. They do not say what those tools can
reach. This engine walks the capability graph (tool -> service -> resource) and
flags paths that give an agent an effect its policy forbids, e.g.

    CustomerSupportAgent -> workflow_api -> admin_endpoint -> customer_database (WRITE)

even though the agent may never call customer_db_write directly.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from app.models import Agent, CapabilityEdge
from app.schemas import CapabilityResult
from app.sentinel.policy_engine import match_resource
from app.simulator.demo_tools import RESOURCE_CLASSES, TOOLS, resource_sensitivity

_ROUTE_ARGS = ("endpoint", "route", "service", "target")
_MAX_DEPTH = 6


def _adjacency(db: Session) -> dict[str, list[CapabilityEdge]]:
    graph: dict[str, list[CapabilityEdge]] = defaultdict(list)
    for edge in db.query(CapabilityEdge).order_by(CapabilityEdge.id).all():
        graph[edge.source].append(edge)
    return graph


def _resource_status(policy: dict[str, Any], resource: str, access: str) -> str:
    if match_resource(policy["resources"]["deny"], resource, access):
        return "dangerous"
    if match_resource(policy["resources"]["allow"], resource, access):
        return "intended"
    return "approval"  # unlisted -> default deny -> needs a human


def _paths_from(graph: dict[str, list[CapabilityEdge]], start: str) -> list[list[CapabilityEdge]]:
    """Every simple path from `start` to a resource node."""
    found: list[list[CapabilityEdge]] = []

    def walk(node: str, trail: list[CapabilityEdge], seen: set[str]) -> None:
        if len(trail) >= _MAX_DEPTH:
            return
        for edge in graph.get(node, []):
            if edge.target in seen:
                continue
            path = [*trail, edge]
            if edge.target in RESOURCE_CLASSES:
                found.append(path)
            else:
                walk(edge.target, path, seen | {edge.target})

    walk(start, [], {start})
    return found


def _describe(agent_name: str, tool: str, path: list[CapabilityEdge]) -> dict[str, Any]:
    last = path[-1]
    return {
        "nodes": [agent_name, tool, *[e.target for e in path]],
        "resource": last.target,
        "access": last.access,
        "label": " → ".join([agent_name, tool, *[e.target for e in path[:-1]], f"{last.target} {last.access}"]),
    }


def check_request(db: Session, agent: Agent, policy: dict[str, Any], tool: str, arguments: dict[str, Any]) -> CapabilityResult:
    """Runtime check for one call: does THIS call reach something forbidden downstream?"""
    graph = _adjacency(db)
    hops = [e for e in graph.get(tool, []) if e.target not in RESOURCE_CLASSES]
    if not hops:
        return CapabilityResult()  # tool touches resources directly; policy engine covers it

    requested = next((str(arguments[k]) for k in _ROUTE_ARGS if arguments.get(k)), None)
    if requested and requested not in {e.target for e in hops}:
        return CapabilityResult(
            verdict="REVIEW",
            risk=60,
            summary=f"'{tool}' was asked to call unknown route '{requested}' — not in the capability graph (default deny).",
            max_sensitivity=50,
        )

    dangerous: list[dict[str, Any]] = []
    for hop in hops:
        if requested and hop.target != requested:
            continue
        for tail in _paths_from(graph, hop.target):
            path = [hop, *tail]
            if _resource_status(policy, path[-1].target, path[-1].access) == "dangerous":
                dangerous.append(_describe(agent.name, tool, path))

    if not dangerous:
        return CapabilityResult(summary=f"'{tool}' route reaches only resources this agent is allowed to use.")

    sensitivity = max(resource_sensitivity(p["resource"]) for p in dangerous)
    if requested:
        # The call explicitly routes through the dangerous hop: block it.
        return CapabilityResult(
            verdict="BLOCK",
            risk=95,
            transitive=True,
            paths=dangerous,
            summary=f"UNINTENDED TRANSITIVE CAPABILITY: {dangerous[0]['label']}",
            max_sensitivity=sensitivity,
        )
    # No route specified: the dangerous path is reachable but not proven -> human decides.
    return CapabilityResult(
        verdict="REVIEW",
        risk=60,
        transitive=True,
        paths=dangerous,
        summary=f"'{tool}' can reach a forbidden resource and no route was specified: {dangerous[0]['label']}",
        max_sensitivity=sensitivity,
    )


def build_graph(db: Session, agent: Agent, policy: dict[str, Any]) -> dict[str, Any]:
    """Full reachability map for the Capability Map UI."""
    graph = _adjacency(db)
    order = {"intended": 0, "approval": 1, "denied": 2, "dangerous": 3}
    nodes: dict[str, dict[str, Any]] = {
        agent.id: {"id": agent.id, "label": agent.name, "type": "agent", "status": "intended", "depth": 0}
    }
    edges: dict[tuple[str, str], dict[str, Any]] = {}
    findings: list[dict[str, Any]] = []

    def node(node_id: str, depth: int, status: str) -> None:
        kind = "tool" if node_id in TOOLS else "resource" if node_id in RESOURCE_CLASSES else "service"
        existing = nodes.get(node_id)
        if existing is None:
            nodes[node_id] = {"id": node_id, "label": node_id, "type": kind, "status": status, "depth": depth}
        else:
            existing["depth"] = max(existing["depth"], depth)
            if order[status] > order[existing["status"]]:
                existing["status"] = status

    def edge(source: str, target: str, access: str, status: str) -> None:
        key = (source, target)
        if key not in edges or order[status] > order[edges[key]["status"]]:
            edges[key] = {"id": f"{source}->{target}", "source": source, "target": target, "access": access, "status": status}

    for tool, base in [(t, "intended") for t in policy["allow"]] + [(t, "approval") for t in policy["require_approval"]]:
        if tool in policy["deny"]:
            continue  # DENY wins
        node(tool, 1, base)
        edge(agent.id, tool, "CALLS", base)
        for path in _paths_from(graph, tool):
            status = _resource_status(policy, path[-1].target, path[-1].access)
            if status == "intended" and base == "approval":
                status = "approval"
            previous = tool
            for depth, step in enumerate(path, start=2):
                is_last = step is path[-1]
                node(step.target, depth, status if (is_last or status != "intended") else "intended")
                edge(previous, step.target, step.access, status)
                previous = step.target
            if status == "dangerous":
                edge(agent.id, tool, "CALLS", "dangerous")
                transitive = len(path) > 1
                finding = _describe(agent.name, tool, path)
                finding.update(
                    title="UNINTENDED CAPABILITY PATH DETECTED" if transitive else "PERMITTED TOOL REACHES A DENIED RESOURCE",
                    severity="CRITICAL",
                    transitive=transitive,
                    node_ids=[agent.id, tool, *[e.target for e in path]],
                    declared=_declared(policy, path[-1].target),
                    recommendation="Sentinel blocks calls that route through this path and requires human approval when the route is unspecified.",
                )
                findings.append(finding)

    for tool in policy["deny"]:
        node(tool, 1, "denied")
        edge(agent.id, tool, "DENIED", "denied")

    return {
        "agent": {"id": agent.id, "name": agent.name, "purpose": agent.purpose},
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "findings": findings,
    }


def _declared(policy: dict[str, Any], resource: str) -> str:
    allowed = [e.partition(":")[2] or "ANY" for e in policy["resources"]["allow"] if e.partition(":")[0] == resource]
    return f"{resource}: {', '.join(allowed)} only" if allowed else f"{resource}: no access declared"
