import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, Bot, Database, Server, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { SeverityBadge } from "../components/badges";
import { Card, ErrorState, Loading, PageHeader, SectionLabel, Select, cx } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { CapStatus, CapabilityGraph } from "../types";

const STATUS: Record<CapStatus, { stroke: string; node: string; label: string }> = {
  intended: { stroke: "#10b981", node: "border-emerald-300 bg-emerald-50 text-emerald-900", label: "Intended" },
  approval: { stroke: "#f59e0b", node: "border-amber-300 bg-amber-50 text-amber-900", label: "Approval required" },
  denied: { stroke: "#94a3b8", node: "border-slate-300 bg-slate-100 text-slate-500 border-dashed", label: "Denied by policy" },
  dangerous: { stroke: "#dc2626", node: "border-red-400 bg-red-50 text-red-900", label: "Unintended / dangerous" },
};
const ICONS = { agent: Bot, tool: Wrench, service: Server, resource: Database };
const COLUMN_X = { agent: 0, tool: 260, service: 520, resource: 780 };
const ROW_GAP = 58;

type CapData = { label: string; kind: keyof typeof ICONS; status: CapStatus; onPath: boolean; dimmed: boolean };

function CapNode({ data }: NodeProps<Node<CapData>>) {
  const Icon = ICONS[data.kind];
  return (
    <div
      className={cx(
        "flex w-52 items-center gap-2 rounded-lg border-2 px-3 py-2 text-xs font-semibold shadow-sm transition-opacity",
        data.kind === "agent" ? "border-slate-900 bg-slate-900 text-white" : STATUS[data.status].node,
        data.onPath && "ring-4 ring-red-200",
        data.dimmed && "opacity-30",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-slate-400" />
      <Icon className="h-4 w-4 shrink-0" />
      <span className={cx("truncate", data.kind !== "agent" && "font-mono")}>{data.label}</span>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-slate-400" />
    </div>
  );
}
const nodeTypes = { cap: CapNode };

function layout(graph: CapabilityGraph, focus: string[] | null): { nodes: Node<CapData>[]; edges: Edge[] } {
  const focusSet = focus ? new Set(focus) : null;
  const columns: Record<string, string[]> = { agent: [], tool: [], service: [], resource: [] };
  graph.nodes.forEach((n) => columns[n.type].push(n.id));
  const tallest = Math.max(...Object.values(columns).map((c) => c.length));
  const nodes: Node<CapData>[] = graph.nodes.map((n) => {
    const column = columns[n.type];
    const offset = ((tallest - column.length) * ROW_GAP) / 2; // centre shorter columns
    return {
      id: n.id,
      type: "cap",
      position: { x: COLUMN_X[n.type], y: offset + column.indexOf(n.id) * ROW_GAP },
      data: { label: n.label, kind: n.type, status: n.status, onPath: !!focusSet?.has(n.id) && n.type !== "agent", dimmed: !!focusSet && !focusSet.has(n.id) },
      draggable: true,
    };
  });
  const edges: Edge[] = graph.edges.map((e) => {
    const onPath = !!focusSet && focusSet.has(e.source) && focusSet.has(e.target) && e.status === "dangerous";
    const color = STATUS[e.status].stroke;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.access === "CALLS" ? undefined : e.access,
      animated: e.status === "dangerous",
      style: { stroke: color, strokeWidth: e.status === "dangerous" ? 2.5 : 1.5, strokeDasharray: e.status === "denied" ? "5 4" : undefined, opacity: focusSet && !onPath ? 0.2 : 1 },
      labelStyle: { fontSize: 10, fontWeight: 700, fill: color },
      labelBgStyle: { fill: "#fff" },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    };
  });
  return { nodes, edges };
}

export default function CapabilityMap() {
  const { overview } = useApp();
  const [params, setParams] = useSearchParams();
  const agentId = params.get("agent") || "customer-support-agent";
  const graph = usePolling(() => api.capabilities(agentId), 0, [agentId]);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => setFocus(null), [agentId]);
  // Draw attention to the first finding as soon as the graph loads.
  useEffect(() => {
    if (graph.data?.agent.id === agentId && graph.data.findings.length) setFocus(0);
  }, [graph.data, agentId]);

  const current = graph.data?.agent.id === agentId ? graph.data : null;
  const flow = useMemo(() => (current ? layout(current, focus !== null ? current.findings[focus]?.node_ids ?? null : null) : null), [current, focus]);

  return (
    <>
      <PageHeader
        title="Capability Map"
        subtitle="Policies say which tools an agent may call. This map shows what those tools can actually reach."
        actions={<Select label="Agent" value={agentId} onChange={(v) => setParams({ agent: v })} options={(overview?.agents || []).map((a) => ({ value: a.id, label: a.name }))} />}
      />
      {graph.error && !current ? <ErrorState message={graph.error} onRetry={() => void graph.refresh()} /> : !current || !flow ? <Loading /> : (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-100 px-5 py-3">
              {(Object.keys(STATUS) as CapStatus[]).map((key) => (
                <span key={key} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <span className="h-0.5 w-5 rounded" style={{ background: STATUS[key].stroke }} /> {STATUS[key].label}
                </span>
              ))}
              <span className="ml-auto text-xs text-slate-400">Agent → tools → services → resources</span>
            </div>
            <div style={{ height: 560 }}>
              <ReactFlow key={agentId} nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.3} nodesConnectable={false} proOptions={{ hideAttribution: true }} onPaneClick={() => setFocus(null)}>
                <Background color="#e2e8f0" gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <SectionLabel>Declared intent</SectionLabel>
              <p className="mt-1 text-base font-semibold text-slate-900">{current.agent.name}</p>
              <p className="text-sm text-slate-500">{current.agent.purpose}</p>
            </Card>
            {current.findings.length === 0 ? (
              <Card className="flex items-start gap-3 p-5">
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">No unintended capability path</p>
                  <p className="mt-1 text-xs text-slate-500">Everything this agent's permitted tools can reach is within its declared resources.</p>
                </div>
              </Card>
            ) : (
              current.findings.map((finding, i) => (
                <button key={finding.label} type="button" onClick={() => setFocus(focus === i ? null : i)} className="block w-full text-left">
                  <Card className={cx("border-red-300 p-5 transition-shadow", focus === i && "ring-4 ring-red-100")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-bold tracking-wide text-red-700"><AlertTriangle className="h-4 w-4" /> {finding.title}</span>
                      <SeverityBadge severity={finding.severity} />
                    </div>
                    <div className="mt-3 grid grid-cols-[5.5rem_1fr] gap-y-1.5 text-sm">
                      <span className="text-xs text-slate-500">Declared</span>
                      <span className="font-mono text-xs font-semibold text-emerald-700">{finding.declared}</span>
                      <span className="text-xs text-slate-500">Reachable</span>
                      <span className="font-mono text-xs font-semibold text-red-700">{finding.resource} {finding.access}</span>
                    </div>
                    <ol className="mt-3 space-y-1 rounded-lg bg-red-50 p-3 font-mono text-xs text-red-900">
                      {finding.nodes.map((node, depth) => (
                        <li key={node} style={{ paddingLeft: depth * 12 }}>{depth > 0 && "→ "}{node}{depth === finding.nodes.length - 1 && ` ${finding.access}`}</li>
                      ))}
                    </ol>
                    <p className="mt-3 text-xs text-slate-600">{finding.recommendation}</p>
                    <p className="mt-2 text-[11px] font-medium text-blue-600">{focus === i ? "Click to show the full map" : "Click to highlight this path"}</p>
                  </Card>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
