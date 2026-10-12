import { Bot, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type AgentCreateBody } from "../api/client";
import { AgentControls } from "../components/AgentWidgets";
import { DecisionBadge, RiskMeter, StatusBadge } from "../components/badges";
import { Button, Card, Chip, ErrorState, Field, Loading, Modal, PageHeader, SectionLabel, Select, TagInput, callText, cx, formatDateTime, inputClass, timeAgo } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { Agent, AgentDetail, Catalog } from "../types";

const BLANK: AgentCreateBody = {
  name: "", purpose: "", owner: "", environment: "demo", allowed_tools: [], approval_tools: [], denied_tools: ["read_secret", "execute_shell", "modify_iam"],
  allowed_resources: [], denied_resources: ["production_secrets", "iam"], network_destinations: [], rate_limit_per_min: 30, cost_limit_per_min: 1, risk_sensitivity: "MEDIUM",
};

function RegisterAgentModal({ open, onClose, onCreated, catalog }: { open: boolean; onClose: () => void; onCreated: (agent: Agent) => void; catalog: Catalog | null }) {
  const { act } = useApp();
  const [form, setForm] = useState<AgentCreateBody>(BLANK);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AgentCreateBody>(key: K, value: AgentCreateBody[K]) => setForm((f) => ({ ...f, [key]: value }));
  const tools = catalog?.tools.map((t) => t.name) || [];
  const resources = catalog?.resources.map((r) => r.name) || [];
  const valid = form.name.trim().length >= 2 && form.purpose.trim().length >= 3;

  const submit = async () => {
    setBusy(true);
    const created = await act(() => api.createAgent({ ...form, name: form.name.trim() }), `${form.name.trim()} registered`);
    setBusy(false);
    if (created) {
      setForm(BLANK);
      onCreated(created);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Register an agent — declare its intent"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={() => void submit()}>Register agent</Button></>}
    >
      <p className="mb-4 text-sm text-slate-500">This definition becomes the agent's <b>declared intent</b>. Anything not listed is denied by default.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="HrHelperAgent" /></Field>
        <Field label="Owner"><input className={inputClass} value={form.owner} onChange={(e) => set("owner", e.target.value)} placeholder="People Ops" /></Field>
        <div className="sm:col-span-2">
          <Field label="Purpose"><input className={inputClass} value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Answer HR policy questions." /></Field>
        </div>
        <Field label="Environment">
          <Select label="Environment" className="w-full" value={form.environment} onChange={(v) => set("environment", v)} options={["demo", "staging-sim", "production-sim"].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Risk sensitivity" hint="HIGH scales this agent's risk scores up by 10%.">
          <Select label="Risk sensitivity" className="w-full" value={form.risk_sensitivity} onChange={(v) => set("risk_sensitivity", v)} options={["LOW", "MEDIUM", "HIGH"].map((v) => ({ value: v, label: v }))} />
        </Field>
        <div className="sm:col-span-2"><Field label="Allowed tools"><TagInput tone="green" values={form.allowed_tools} onChange={(v) => set("allowed_tools", v)} suggestions={tools} placeholder="search_kb" /></Field></div>
        <div className="sm:col-span-2"><Field label="Approval-required tools"><TagInput tone="amber" values={form.approval_tools} onChange={(v) => set("approval_tools", v)} suggestions={tools} placeholder="refund_customer" /></Field></div>
        <div className="sm:col-span-2"><Field label="Denied tools"><TagInput tone="red" values={form.denied_tools} onChange={(v) => set("denied_tools", v)} suggestions={tools} /></Field></div>
        <Field label="Allowed resources" hint="class or class:OPERATION"><TagInput tone="green" values={form.allowed_resources} onChange={(v) => set("allowed_resources", v)} suggestions={resources} placeholder="knowledge_base" /></Field>
        <Field label="Denied resources"><TagInput tone="red" values={form.denied_resources} onChange={(v) => set("denied_resources", v)} suggestions={resources} /></Field>
        <div className="sm:col-span-2"><Field label="Network destinations" hint="Approved external hosts. Empty = no outbound destinations."><TagInput tone="blue" values={form.network_destinations} onChange={(v) => set("network_destinations", v)} placeholder="api.partner.example" /></Field></div>
        <Field label="Rate limit (calls / minute)"><input type="number" min={1} className={inputClass} value={form.rate_limit_per_min} onChange={(e) => set("rate_limit_per_min", Math.max(1, Number(e.target.value) || 1))} /></Field>
        <Field label="Cost limit (USD / minute)"><input type="number" min={0.01} step={0.1} className={inputClass} value={form.cost_limit_per_min} onChange={(e) => set("cost_limit_per_min", Math.max(0.01, Number(e.target.value) || 0.01))} /></Field>
      </div>
    </Modal>
  );
}

function ToolList({ title, tools, tone }: { title: string; tools: string[]; tone: "green" | "amber" | "red" }) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tools.length ? tools.map((t) => <Chip key={t} tone={tone}>{t}</Chip>) : <span className="text-xs text-slate-400">none</span>}
      </div>
    </div>
  );
}

function AgentDetailPanel({ agentId, version }: { agentId: string; version: number }) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.agent(agentId).then((d) => !cancelled && (setDetail(d), setError(null))).catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [agentId, version]);

  if (error) return <ErrorState message={error} />;
  if (!detail || detail.id !== agentId) return <Loading />;
  const policy = detail.policy;
  return (
    <div className="grid gap-5 border-t border-slate-100 bg-slate-50/60 px-5 py-5 lg:grid-cols-3">
      <div className="space-y-4">
        <SectionLabel>Declared intent</SectionLabel>
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{detail.purpose}</p>
        {policy && (
          <>
            <ToolList title="Allowed" tools={policy.allow} tone="green" />
            <ToolList title="Approval required" tools={policy.require_approval} tone="amber" />
            <ToolList title="Never allowed" tools={policy.deny} tone="red" />
          </>
        )}
      </div>
      <div className="space-y-4">
        {policy && (
          <>
            <ToolList title="Allowed resources" tools={policy.resources.allow} tone="green" />
            <ToolList title="Denied resources" tools={policy.resources.deny} tone="red" />
            <div>
              <SectionLabel>Limits</SectionLabel>
              <p className="mt-1 text-sm text-slate-700">{policy.limits.rate_per_minute} calls/min · ${policy.limits.cost_per_minute_usd}/min · sensitivity {detail.risk_sensitivity}</p>
              <p className="mt-0.5 text-xs text-slate-500">Network: {policy.network.allow.join(", ") || "no outbound destinations"}</p>
            </div>
          </>
        )}
        <div>
          <SectionLabel>State history</SectionLabel>
          {detail.state_history.length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">No state changes — running since registration.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {detail.state_history.slice(0, 5).map((s) => (
                <li key={s.id} className="text-xs text-slate-600">
                  <span className="font-mono text-slate-400">{formatDateTime(s.timestamp)}</span> {s.from_state} → <b>{s.to_state}</b> by {s.actor}
                  <span className="block text-slate-500">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div>
        <SectionLabel>Recent activity</SectionLabel>
        <ul className="mt-1.5 space-y-1.5">
          {detail.recent_events.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs text-slate-700">{e.kind === "SYSTEM" ? e.message : callText(e.tool, e.resource)}</span>
              <DecisionBadge decision={e.decision} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Agents() {
  const agents = usePolling(api.agents, 3000);
  const catalog = usePolling(api.catalog, 0);
  const [params, setParams] = useSearchParams();
  const [registering, setRegistering] = useState(false);
  const [version, setVersion] = useState(0);
  const selected = params.get("agent");
  const select = (id: string | null) => setParams(id ? { agent: id } : {}, { replace: true });
  const refresh = () => {
    void agents.refresh();
    setVersion((v) => v + 1);
  };

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Each agent is registered with a declared intent. Sentinel enforces that intent on every action."
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setRegistering(true)}>Register agent</Button>}
      />
      {agents.error && !agents.data ? <ErrorState message={agents.error} onRetry={() => void agents.refresh()} /> : !agents.data ? <Loading /> : (
        <div className="space-y-3">
          {agents.data.map((agent) => (
            <Card key={agent.id} className={cx("overflow-hidden transition-colors", agent.status === "QUARANTINED" && "border-red-300", agent.status === "DISABLED" && "border-slate-400")}>
              <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <button type="button" onClick={() => select(selected === agent.id ? null : agent.id)} className="flex min-w-0 flex-1 items-center gap-3.5 text-left" aria-expanded={selected === agent.id}>
                  <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", agent.status === "QUARANTINED" ? "bg-red-600 text-white" : agent.status === "DISABLED" ? "bg-slate-800 text-white" : "bg-blue-50 text-blue-600")}>
                    <Bot className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-slate-900">{agent.name}</span>
                      <StatusBadge status={agent.display_status} />
                      {!agent.session_active && <span className="text-[11px] font-semibold uppercase text-red-600">session revoked</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate-500">{agent.purpose}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">{agent.owner || "No owner"} · {agent.environment} · last activity {timeAgo(agent.last_activity)}</span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-4">
                  <RiskMeter score={agent.risk_score} width="w-20" />
                  <AgentControls agent={agent} onChange={refresh} />
                </div>
              </div>
              {selected === agent.id && <AgentDetailPanel agentId={agent.id} version={version} />}
            </Card>
          ))}
        </div>
      )}
      <RegisterAgentModal
        open={registering}
        onClose={() => setRegistering(false)}
        catalog={catalog.data}
        onCreated={(agent) => {
          setRegistering(false);
          void agents.refresh();
          select(agent.id);
        }}
      />
    </>
  );
}
