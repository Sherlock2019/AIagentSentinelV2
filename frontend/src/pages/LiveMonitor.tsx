import { Activity, ChevronRight, Shield } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { DecisionBadge, RiskMeter, SeverityBadge } from "../components/badges";
import { Button, Card, Empty, ErrorState, Loading, PageHeader, Select, callText, cx, formatTime, inputClass } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";

const ANY = { value: "", label: "All" };

export default function LiveMonitor() {
  const { overview, isEngineer } = useApp();
  const [agent, setAgent] = useState("");
  const [decision, setDecision] = useState("");
  const [severity, setSeverity] = useState("");
  const [tool, setTool] = useState("");
  const [since, setSince] = useState("");
  const events = usePolling(
    () => api.events({ agent_id: agent, decision, severity, tool, since_minutes: since ? Number(since) : undefined, limit: 150 }),
    2000,
    [agent, decision, severity, tool, since],
  );
  const filtered = Boolean(agent || decision || severity || tool || since);
  const clear = () => { setAgent(""); setDecision(""); setSeverity(""); setTool(""); setSince(""); };

  return (
    <>
      <PageHeader
        title="Live Monitor"
        subtitle="Every action that reaches the gateway, and every response Sentinel takes, in order."
        actions={<span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><span className="live-dot h-2 w-2 rounded-full bg-current" /> LIVE · 2s</span>}
      />
      <Card className="mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="text-xs font-medium text-slate-500">Agent
          <Select label="Agent" className="mt-1 block" value={agent} onChange={setAgent} options={[ANY, ...(overview?.agents || []).map((a) => ({ value: a.id, label: a.name }))]} />
        </label>
        <label className="text-xs font-medium text-slate-500">Decision
          <Select label="Decision" className="mt-1 block" value={decision} onChange={setDecision} options={[ANY, ...["ALLOW", "REVIEW", "BLOCK", "INFO"].map((v) => ({ value: v, label: v === "INFO" ? "SYSTEM" : v }))]} />
        </label>
        <label className="text-xs font-medium text-slate-500">Severity
          <Select label="Severity" className="mt-1 block" value={severity} onChange={setSeverity} options={[ANY, ...["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: v }))]} />
        </label>
        <label className="text-xs font-medium text-slate-500">Tool
          <input className={cx(inputClass, "mt-1 block w-44")} placeholder="e.g. read_prod_secret" value={tool} onChange={(e) => setTool(e.target.value.trim())} />
        </label>
        <label className="text-xs font-medium text-slate-500">Time
          <Select label="Time window" className="mt-1 block" value={since} onChange={setSince} options={[{ value: "", label: "All time" }, { value: "5", label: "Last 5 min" }, { value: "60", label: "Last hour" }, { value: "360", label: "Last 6 hours" }]} />
        </label>
        {filtered && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
        <span className="ml-auto text-xs text-slate-400">{events.data?.length ?? 0} events</span>
      </Card>

      {events.error && !events.data ? <ErrorState message={events.error} onRetry={() => void events.refresh()} /> : !events.data ? <Loading /> : events.data.length === 0 ? (
        <Card><Empty icon={<Activity className="h-8 w-8" />} title="No events match these filters" action={filtered ? <Button size="sm" onClick={clear}>Clear filters</Button> : undefined} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <ol className="divide-y divide-slate-100">
            {events.data.map((event) => {
              const system = event.kind === "SYSTEM";
              const fresh = Date.now() - new Date(event.timestamp).getTime() < 6000;
              return (
                <li key={event.id} className={cx(fresh && event.decision === "BLOCK" && "animate-flash", fresh && event.decision !== "BLOCK" && "animate-fade-in")}>
                  <Link to={`/inspector/${event.id}`} className={cx("flex items-center gap-4 px-5 py-3 hover:bg-slate-50", system && "bg-slate-50/70")}>
                    <span className="w-[4.5rem] shrink-0 font-mono text-xs text-slate-400">{formatTime(event.timestamp)}</span>
                    <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", system ? "bg-slate-900 text-white" : event.decision === "BLOCK" ? "bg-red-100 text-red-600" : event.decision === "REVIEW" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-600")}>
                      {system ? <Shield className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-500">{system ? `AgentSentinel · ${event.agent_name}` : event.agent_name}</span>
                      <span className={cx("block truncate text-sm text-slate-900", !system && "font-mono")}>{system ? event.message : callText(event.tool, event.resource)}</span>
                      {!system && event.decision !== "ALLOW" && <span className="block truncate text-xs text-slate-500">{event.reasons[0]}</span>}
                    </span>
                    {!system && isEngineer && <span className="hidden md:block"><RiskMeter score={event.risk_score} /></span>}
                    {!system && <span className="hidden lg:block"><SeverityBadge severity={event.severity} /></span>}
                    <span className="w-24 text-right"><DecisionBadge decision={event.decision} /></span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </>
  );
}
