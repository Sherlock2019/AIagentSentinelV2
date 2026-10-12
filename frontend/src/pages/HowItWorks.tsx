import { Background, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity, ArrowRight, Ban, Bell, Bot, Brain, ClipboardList, Database, Eye, Fingerprint, Gauge as GaugeIcon, Lock, MousePointerClick, Scale, ScrollText, Shield, ShieldCheck,
  Target, UserCheck, Wrench, X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, PageHeader, SectionLabel, Segmented, cx } from "../components/ui";
import { PRODUCT_MESSAGE } from "./Dashboard";

type PathKey = "normal" | "review" | "danger";
type Tone = "slate" | "blue" | "green" | "amber" | "red";

interface Explain { what: string; why: string; input: string; output: string; example: ReactNode }
interface Spec { id: string; label: string; sub: string; icon: ReactNode; tone: Tone; x: number; y: number; explain: Explain }

const yes = (items: string[]) => items.map((i) => <li key={i} className="text-emerald-700">✓ {i}</li>);
const no = (items: string[]) => items.map((i) => <li key={i} className="text-red-700">✕ {i}</li>);

const NODES: Spec[] = [
  {
    id: "agent", label: "AI Agent", sub: "LangGraph / MCP / custom", icon: <Bot className="h-4 w-4" />, tone: "slate", x: 0, y: 190,
    explain: {
      what: "Plans work and proposes tool calls. It never executes a tool directly.",
      why: "Agents can be wrong, manipulated by injected text, or simply over-eager. They should not be the ones deciding what is safe.",
      input: "A user request and whatever content it retrieves.",
      output: "A proposed action: tool, resource, operation and arguments.",
      example: <>CodingAgent, asked to “review this source code”, proposes <code>read_prod_secret("AWS_PRODUCTION_TOKEN")</code>.</>,
    },
  },
  {
    id: "gateway", label: "Sentinel Gateway", sub: "Intercepts every action", icon: <Shield className="h-4 w-4" />, tone: "blue", x: 230, y: 190,
    explain: {
      what: "The single choke point. Every important action is submitted here before anything runs.",
      why: "A guard that only watches logs notices damage after it happened. Sitting in the execution path means unsafe actions never reach a real system.",
      input: "The proposed action plus the agent's identity and session.",
      output: "A decision — ALLOW, REVIEW or BLOCK — and only then, maybe, a tool call.",
      example: <><code>POST /api/actions/intercept</code> → authenticate the agent, load its declared intent, run the checks, decide.</>,
    },
  },
  {
    id: "policy", label: "Policy Engine", sub: "Deterministic rules", icon: <ScrollText className="h-4 w-4" />, tone: "blue", x: 460, y: 30,
    explain: {
      what: "Checks deterministic rules describing what the agent is allowed to do. DENY beats REQUIRE_APPROVAL beats ALLOW; anything unlisted is denied.",
      why: "Security boundaries must be predictable and reviewable. No model — however confident — can talk its way past an explicit rule.",
      input: "Tool, resource, operation, arguments and the agent's policy.",
      output: "ALLOW, REQUIRE_APPROVAL or DENY, with the exact rule that fired.",
      example: (
        <>
          CustomerSupportAgent may:
          <ul className="mt-1 font-mono text-xs">{yes(["search knowledge base", "read support ticket", "create ticket"])}</ul>
          It may not:
          <ul className="mt-1 font-mono text-xs">{no(["execute shell", "read secrets", "modify IAM", "delete customer data"])}</ul>
        </>
      ),
    },
  },
  {
    id: "judge", label: "LLM Safety Judge", sub: "Semantic intent check", icon: <Brain className="h-4 w-4" />, tone: "blue", x: 460, y: 190,
    explain: {
      what: "A second model scores the action for intent alignment, authorization, data exposure, injection, privilege and necessity (1–5 each).",
      why: "Rules cannot see meaning. The judge notices when a permitted tool is being used for an off-task purpose. It is advisory: it can make Sentinel stricter, never more lenient.",
      input: "Agent purpose, user request, the action, recent history and the applicable policy.",
      output: "Structured JSON scores plus a recommended decision and a one-line summary.",
      example: <>“This action is unrelated to the agent purpose and accesses a production secret.” → intent 1/5, data exposure 5/5, recommend BLOCK.</>,
    },
  },
  {
    id: "behavior", label: "Behavior Monitor", sub: "Anomaly vs. normal", icon: <Activity className="h-4 w-4" />, tone: "blue", x: 460, y: 350,
    explain: {
      what: "Compares this action with the agent's recent and historical behaviour and produces an anomaly score from 0 to 100.",
      why: "Some attacks are only visible as a pattern: a runaway loop, repeated retries of a blocked action, or a sudden jump to sensitive resources.",
      input: "The agent's rolling action history, rate and cost limits.",
      output: "An anomaly score with named signals (rate, repetition, sequence, unusual resource, looping…).",
      example: <>Normal: <code>search_kb → search_kb → create_ticket</code>. Suspicious: <code>search_kb → read_secret → export_data</code>.</>,
    },
  },
  {
    id: "risk", label: "Risk Engine", sub: "LOW · MEDIUM · HIGH · CRITICAL", icon: <GaugeIcon className="h-4 w-4" />, tone: "blue", x: 690, y: 190,
    explain: {
      what: "Fuses policy risk, LLM risk, behaviour risk, resource sensitivity and irreversibility into one 0–100 score and picks the decision.",
      why: "One explainable number lets a human see at a glance how serious an event is — and why.",
      input: "The three engine results plus resource sensitivity and reversibility.",
      output: "Score, severity and decision. Certain violations are CRITICAL regardless of the score.",
      example: <>Policy 100 · LLM 99 · Behaviour 91 · Sensitivity 100 → <b>98 / 100 CRITICAL</b> → BLOCK.</>,
    },
  },
  {
    id: "tool", label: "Tool / API / MCP", sub: "The real world", icon: <Wrench className="h-4 w-4" />, tone: "green", x: 1150, y: 30,
    explain: {
      what: "The actual tool, API, MCP server, database or cloud service.",
      why: "This is where real consequences happen, so it is only reachable through an ALLOW decision or an approved review.",
      input: "An action Sentinel allowed, or one a human approved.",
      output: "The tool result, returned to the agent.",
      example: <>In this POC every tool is simulated — no real system is ever called.</>,
    },
  },
  {
    id: "approval", label: "Human Approval", sub: "A person decides", icon: <UserCheck className="h-4 w-4" />, tone: "amber", x: 920, y: 190,
    explain: {
      what: "Holds high-impact actions until an administrator approves or rejects them.",
      why: "Refunds, payments and code changes may be legitimate, but accountability for them should stay with a human.",
      input: "A held action with its risk score and reasons.",
      output: "Approved → the tool runs. Rejected → nothing happens.",
      example: <>FinanceAgent requests <code>create_payment_request</code> → held in the approval queue.</>,
    },
  },
  {
    id: "quarantine", label: "Quarantine", sub: "Block · isolate · kill", icon: <Lock className="h-4 w-4" />, tone: "red", x: 920, y: 350,
    explain: {
      what: "Blocks the action and, for critical violations, isolates the agent: session revoked, pending actions cancelled, all future calls refused.",
      why: "An agent that tried to read a secret should not get a second attempt with a different tool.",
      input: "A BLOCK decision with a critical trigger, or three blocked actions in 60 seconds.",
      output: "Agent state QUARANTINED (or DISABLED via the kill switch).",
      example: <>Secret access, IAM changes, disabling audit logs and bypassing Sentinel all quarantine immediately.</>,
    },
  },
  {
    id: "alert", label: "Alert Center", sub: "Notify administrators", icon: <Bell className="h-4 w-4" />, tone: "red", x: 1150, y: 350,
    explain: {
      what: "Tells administrators what happened, why it was blocked and what Sentinel already did.",
      why: "Containment buys time; a person still has to investigate and decide whether to restore the agent.",
      input: "The blocked event, its reasons and the response taken.",
      output: "Dashboard alert plus simulated email, Slack and webhook notifications.",
      example: <>CRITICAL — CodingAgent — <code>read_prod_secret</code> — BLOCKED, agent QUARANTINED.</>,
    },
  },
  {
    id: "audit", label: "Audit Log", sub: "Tamper-evident evidence", icon: <ClipboardList className="h-4 w-4" />, tone: "slate", x: 230, y: 350,
    explain: {
      what: "Records every decision — allowed, reviewed or blocked — in an append-only, hash-chained log.",
      why: "Security decisions need traceable evidence. Chaining each record to the previous one makes edits detectable.",
      input: "Every event that passes through the gateway and every admin action.",
      output: "An exportable trail (JSON / CSV) with an integrity check.",
      example: <>Change one old record and the Audit Trail page reports “tampering detected”.</>,
    },
  },
];

const CHECKS: [string, string][] = [["gateway", "policy"], ["gateway", "judge"], ["gateway", "behavior"], ["policy", "risk"], ["judge", "risk"], ["behavior", "risk"]];
const COMMON: [string, string][] = [["agent", "gateway"], ...CHECKS, ["gateway", "audit"]];
const PATHS: Record<PathKey, { label: string; color: string; edges: [string, string][]; steps: string[]; outcome: string }> = {
  normal: { label: "Normal path", color: "#10b981", edges: [...COMMON, ["risk", "tool"]], steps: ["Agent", "Gateway", "Safety checks", "ALLOW", "Tool"], outcome: "Low risk: the action runs immediately." },
  review: { label: "Review path", color: "#f59e0b", edges: [...COMMON, ["risk", "approval"], ["approval", "tool"]], steps: ["Agent", "Gateway", "REVIEW", "Admin", "Tool"], outcome: "High impact: held until a human approves." },
  danger: { label: "Dangerous path", color: "#dc2626", edges: [...COMMON, ["risk", "quarantine"], ["quarantine", "alert"]], steps: ["Agent", "Gateway", "BLOCK", "Quarantine", "Alert admin"], outcome: "Critical: blocked, agent isolated, admin alerted." },
};
const ALL_EDGES: { pair: [string, string]; label?: string; vertical?: boolean }[] = [
  { pair: ["agent", "gateway"] },
  ...CHECKS.map((pair) => ({ pair })),
  { pair: ["risk", "tool"], label: "ALLOW" },
  { pair: ["risk", "approval"], label: "REVIEW" },
  { pair: ["approval", "tool"], label: "approved" },
  { pair: ["risk", "quarantine"], label: "BLOCK" },
  { pair: ["quarantine", "alert"] },
  { pair: ["gateway", "audit"], vertical: true },
];

const TONES: Record<Tone, string> = {
  slate: "border-slate-300 bg-white text-slate-800",
  blue: "border-blue-300 bg-blue-50 text-blue-900",
  green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  red: "border-red-300 bg-red-50 text-red-900",
};

type FlowData = { spec: Spec; active: boolean; selected: boolean };

function FlowNode({ data }: NodeProps<Node<FlowData>>) {
  const hidden = "!h-1 !w-1 !border-0 !bg-transparent";
  return (
    <div className={cx("w-44 rounded-xl border-2 px-3 py-2.5 shadow-sm transition-all", TONES[data.spec.tone], !data.active && "opacity-35", data.selected && "ring-4 ring-blue-300")}>
      <Handle type="target" position={Position.Left} id="l" className={hidden} />
      <Handle type="target" position={Position.Top} id="t" className={hidden} />
      <div className="flex items-center gap-2 text-[13px] font-semibold">{data.spec.icon}{data.spec.label}</div>
      <div className="mt-0.5 text-[11px] opacity-70">{data.spec.sub}</div>
      <Handle type="source" position={Position.Right} id="r" className={hidden} />
      <Handle type="source" position={Position.Bottom} id="b" className={hidden} />
    </div>
  );
}
const nodeTypes = { flow: FlowNode };

function Diagram() {
  const [path, setPath] = useState<PathKey>("danger");
  const [selected, setSelected] = useState<string>("gateway");
  const active = PATHS[path];
  const spec = NODES.find((n) => n.id === selected)!;

  const { nodes, edges } = useMemo(() => {
    const onPath = new Set(active.edges.map(([a, b]) => `${a}>${b}`));
    const activeNodes = new Set(active.edges.flat());
    const flowNodes: Node<FlowData>[] = NODES.map((n) => ({
      id: n.id, type: "flow", position: { x: n.x, y: n.y }, draggable: false,
      data: { spec: n, active: activeNodes.has(n.id), selected: n.id === selected },
    }));
    const flowEdges: Edge[] = ALL_EDGES.map(({ pair: [source, target], label, vertical }) => {
      const on = onPath.has(`${source}>${target}`);
      const color = on ? active.color : "#cbd5e1";
      return {
        id: `${source}>${target}`, source, target,
        sourceHandle: vertical ? "b" : "r", targetHandle: vertical ? "t" : "l",
        animated: on, label,
        style: { stroke: color, strokeWidth: on ? 2.5 : 1.5 },
        labelStyle: { fontSize: 10, fontWeight: 700, fill: on ? color : "#94a3b8" },
        labelBgStyle: { fill: "#f8fafc" },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        zIndex: on ? 1 : 0,
      };
    });
    return { nodes: flowNodes, edges: flowEdges };
  }, [active, selected]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <Segmented<PathKey> value={path} onChange={setPath} options={(Object.keys(PATHS) as PathKey[]).map((key) => ({ value: key, label: <><span className="h-2 w-2 rounded-full" style={{ background: PATHS[key].color }} />{PATHS[key].label}</> }))} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-700">
          {active.steps.map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="h-3 w-3 text-slate-400" />}
              <span className="rounded-md px-2 py-0.5" style={{ background: `${active.color}1f` }}>{step}</span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="relative bg-slate-50" style={{ height: 470 }}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.4} maxZoom={1.3}
            nodesDraggable={false} nodesConnectable={false} zoomOnScroll={false} preventScrolling={false} proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelected(node.id)}
          >
            <Background color="#e2e8f0" gap={22} />
          </ReactFlow>
          <p className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-1.5 rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
            <MousePointerClick className="h-3.5 w-3.5" /> Click any node for details · {active.outcome}
          </p>
        </div>
        <aside className="border-t border-slate-200 p-5" aria-live="polite">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">{spec.icon}{spec.label.toUpperCase()}</div>
          <div className="mt-3 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_0.8fr_1.2fr]">
            {(["what", "why", "input", "output"] as const).map((key) => (
              <div key={key}>
                <SectionLabel>{{ what: "What it does", why: "Why it exists", input: "Input", output: "Output" }[key]}</SectionLabel>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{spec.explain[key]}</p>
              </div>
            ))}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 md:col-span-2 xl:col-span-1">
              <SectionLabel>Example</SectionLabel>
              <div className="mt-1 text-sm leading-relaxed text-slate-700 [&_code]:rounded [&_code]:bg-slate-200 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs">{spec.explain.example}</div>
            </div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

const STEPS: { title: string; text: string; icon: ReactNode }[] = [
  { title: "Register intent", text: "Define what the agent is supposed to do.", icon: <Fingerprint className="h-5 w-5" /> },
  { title: "Intercept action", text: "Every important tool call passes through the gateway.", icon: <Shield className="h-5 w-5" /> },
  { title: "Evaluate", text: "Policy + LLM safety evaluator + behaviour analysis.", icon: <Eye className="h-5 w-5" /> },
  { title: "Decide", text: "Allow / Review / Block.", icon: <Scale className="h-5 w-5" /> },
  { title: "Respond", text: "Quarantine / kill / alert if necessary.", icon: <Ban className="h-5 w-5" /> },
  { title: "Audit", text: "Preserve evidence for investigation.", icon: <Database className="h-5 w-5" /> },
];

const PRINCIPLES: { title: string; text: string }[] = [
  { title: "Least privilege", text: "Give an agent only the capabilities required for its purpose." },
  { title: "Default deny", text: "Unknown tools and resources should not automatically execute." },
  { title: "Human accountability", text: "High-risk decisions remain under human control." },
  { title: "Separate policy from model", text: "AI models do not define their own permissions." },
  { title: "Audit everything", text: "Security decisions require traceable evidence." },
  { title: "Fail safe", text: "When the system cannot confidently determine whether a critical action is authorized, stop or request human approval." },
];

function IntentMismatch() {
  return (
    <Card className="overflow-hidden">
      <header className="border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-sm font-bold uppercase tracking-[0.1em] text-slate-800">Intended behavior vs actual behavior</h3>
      </header>
      <div className="grid items-stretch gap-4 p-5 lg:grid-cols-[1fr_auto_1fr_auto_1.1fr]">
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-800"><ShieldCheck className="h-4 w-4" /> Declared purpose</p>
          <p className="mt-2 text-lg font-semibold text-emerald-950">“Answer customer questions”</p>
          <ul className="mt-2 font-mono text-xs">{yes(["search_kb", "get_ticket", "create_ticket"])}</ul>
        </div>
        <div className="flex items-center justify-center text-sm font-bold text-slate-400">VS</div>
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-800"><Target className="h-4 w-4" /> Actual attempt</p>
          <p className="mt-2 text-lg font-semibold text-red-950">“Read AWS production secret”</p>
          <ul className="mt-2 font-mono text-xs">{no(["read_secret(AWS_PRODUCTION_TOKEN)"])}</ul>
        </div>
        <div className="flex items-center justify-center"><ArrowRight className="h-6 w-6 text-slate-400 max-lg:rotate-90" /></div>
        <div className="flex flex-col justify-center rounded-xl bg-red-600 p-4 text-white">
          <p className="flex items-center gap-2 text-sm font-bold tracking-wide"><X className="h-5 w-5" /> CRITICAL INTENT MISMATCH</p>
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold"><ArrowRight className="h-4 w-4" /> BLOCK</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold"><ArrowRight className="h-4 w-4" /> QUARANTINE</p>
        </div>
      </div>
    </Card>
  );
}

export default function HowItWorks() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="How AgentSentinel Protects AI Agents"
        subtitle="Every important agent action is checked before it reaches the real world."
        actions={<Button variant="primary" onClick={() => navigate("/redteam")}>See it block an attack</Button>}
      />

      <Card className="mb-4 grid gap-6 p-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
          <p><b className="text-slate-900">AgentSentinel protects AI agents at runtime.</b></p>
          <p>Instead of allowing an AI agent to directly execute tools or access systems, the agent submits each important action to the <b>Sentinel Gateway</b>.</p>
          <p>Sentinel evaluates deterministic policy, semantic intent, runtime behavior and resource sensitivity. The requested action is then <b className="text-emerald-700">ALLOWED</b>, sent for <b className="text-amber-700">HUMAN APPROVAL</b>, or <b className="text-red-700">BLOCKED</b>.</p>
          <p>Critical violations can automatically <b>QUARANTINE</b> or <b>DISABLE</b> the agent and alert administrators.</p>
        </div>
        <div className="grid gap-3 text-sm">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-red-700">Wrong — passive log viewer</p>
            <p className="mt-1.5 font-mono text-xs text-red-900">Agent → Tool executes → Sentinel notices later</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Correct — in the execution path</p>
            <p className="mt-1.5 font-mono text-xs text-emerald-900">Agent → Sentinel Gateway → Evaluate → ALLOW / REVIEW / BLOCK → only then execute</p>
          </div>
        </div>
      </Card>

      <Diagram />

      <div className="mt-4"><IntentMismatch /></div>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">Six steps, every time</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((step, i) => (
          <Card key={step.title} className="flex items-start gap-3.5 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">{step.icon}</span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Step {i + 1}</p>
              <p className="text-sm font-bold uppercase tracking-wide text-slate-900">{step.title}</p>
              <p className="mt-1 text-sm text-slate-600">{step.text}</p>
            </div>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">Security principles</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PRINCIPLES.map((principle) => (
          <Card key={principle.title} className="border-l-4 border-l-slate-900 p-5">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-900">{principle.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{principle.text}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-8 border-slate-900 bg-slate-900 px-8 py-8 text-center text-white">
        <p className="text-xl font-semibold tracking-wide">AI AGENTS SHOULD NOT POLICE THEMSELVES.</p>
        <ul className="mx-auto mt-4 max-w-md space-y-1.5 text-sm font-medium uppercase tracking-[0.1em] text-slate-300">
          {PRODUCT_MESSAGE.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </Card>
    </>
  );
}
