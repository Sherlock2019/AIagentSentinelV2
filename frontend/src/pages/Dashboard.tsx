import { Activity, AlertTriangle, Ban, Bot, Eye, Lock, Power, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ApprovalQueue } from "../components/AgentWidgets";
import { DecisionBadge, Gauge, RiskMeter, StatusBadge } from "../components/badges";
import { Button, Card, CardHeader, Empty, ErrorState, Loading, Modal, PageHeader, Td, Th, callText, cx, formatTime, timeAgo } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";

const HEALTH_COLOR: Record<string, string> = { HEALTHY: "#0ca30c", ELEVATED: "#d99a00", "AT RISK": "#ec835a", CRITICAL: "#d03b3b" };

function Kpi({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: string }) {
  return (
    <Card className="flex items-center gap-3 px-3.5 py-4">
      <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tone)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-tight text-slate-900">{value}</div>
        <div className="text-[10.5px] font-semibold uppercase leading-tight tracking-wide text-slate-500">{label}</div>
      </div>
    </Card>
  );
}

export const PRODUCT_MESSAGE = [
  "Define what they are allowed to do.",
  "Intercept what they try to do.",
  "Verify their intent.",
  "Block unauthorized actions.",
  "Keep humans in control.",
];

export default function Dashboard() {
  const { overview, online, act, refreshOverview } = useApp();
  const navigate = useNavigate();
  const [confirmStop, setConfirmStop] = useState(false);
  const pending = usePolling(api.pending, 3000);
  const events = usePolling(() => api.events({ limit: 7 }), 3000);

  if (!overview) return online === false ? <ErrorState message="Backend offline — cannot reach the Sentinel Gateway" /> : <Loading label="Connecting to Sentinel Gateway…" />;
  const { kpis, health, agents } = overview;
  const refresh = () => {
    void refreshOverview();
    void pending.refresh();
    void events.refresh();
  };

  return (
    <>
      <PageHeader
        eyebrow="AI Agent Security Operations Center"
        title="AgentSentinel"
        subtitle="Every important agent action is checked before it reaches the real world."
        actions={
          <Button variant="danger" size="lg" icon={<Power className="h-4 w-4" />} disabled={overview.emergency_stop_active} onClick={() => setConfirmStop(true)}>
            EMERGENCY STOP ALL AGENTS
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Active agents" value={kpis.active_agents} icon={<Bot className="h-5 w-5" />} tone="bg-blue-50 text-blue-600" />
        <Kpi label="Safe agents" value={kpis.safe_agents} icon={<ShieldCheck className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" />
        <Kpi label="Under review" value={kpis.under_review} icon={<Eye className="h-5 w-5" />} tone="bg-amber-50 text-amber-600" />
        <Kpi label="Quarantined" value={kpis.quarantined} icon={<Lock className="h-5 w-5" />} tone={kpis.quarantined ? "bg-red-600 text-white" : "bg-slate-100 text-slate-500"} />
        <Kpi label="Blocked today" value={kpis.blocked_today} icon={<Ban className="h-5 w-5" />} tone="bg-red-50 text-red-600" />
        <Kpi label="Critical alerts" value={kpis.critical_alerts} icon={<AlertTriangle className="h-5 w-5" />} tone={kpis.critical_alerts ? "bg-red-600 text-white" : "bg-slate-100 text-slate-500"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card className="flex flex-col items-center justify-center px-5 py-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Global risk score</p>
          <Gauge value={health.score} color={HEALTH_COLOR[health.label] || "#64748b"} label="Fleet health" sublabel={health.label} />
          <p className="mt-3 text-center text-xs text-slate-500">100 = healthy. Agent risk, containment and open critical alerts lower it.</p>
        </Card>
        <Card className="flex flex-col justify-center border-slate-900 bg-slate-900 px-7 py-6 text-white">
          <p className="text-lg font-semibold tracking-wide">AI AGENTS SHOULD NOT POLICE THEMSELVES.</p>
          <ul className="mt-3 grid gap-x-8 gap-y-1.5 text-sm text-slate-300 sm:grid-cols-2">
            {PRODUCT_MESSAGE.map((line, i) => (
              <li key={line} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">{i + 1}</span>
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => navigate("/how-it-works")}>How it works</Button>
            <Button size="sm" className="border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800" onClick={() => navigate("/redteam")}>Open Red Team Lab</Button>
          </div>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          icon={<Activity className="h-4 w-4" />}
          title="Live agent status"
          subtitle="Updates every 3 seconds"
          action={<span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600"><span className="live-dot h-2 w-2 rounded-full bg-current" /> LIVE</span>}
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr><Th>Agent</Th><Th>Purpose</Th><Th>Current task</Th><Th>Risk score</Th><Th>Status</Th><Th>Actions/min</Th><Th>Blocked</Th><Th>Last activity</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agents.map((agent) => (
                <tr
                  key={agent.id}
                  onClick={() => navigate(`/agents?agent=${agent.id}`)}
                  className={cx("cursor-pointer transition-colors hover:bg-slate-50", agent.status === "QUARANTINED" && "bg-red-50/60 hover:bg-red-50")}
                >
                  <Td className="font-semibold text-slate-900">{agent.name}</Td>
                  <Td className="max-w-56 truncate text-slate-500">{agent.purpose}</Td>
                  <Td className="max-w-56 truncate">{agent.current_task}</Td>
                  <Td><RiskMeter score={agent.risk_score} /></Td>
                  <Td><StatusBadge status={agent.display_status} /></Td>
                  <Td className="tabular-nums">{agent.actions_per_min}</Td>
                  <Td className={cx("tabular-nums", agent.blocked_today > 0 && "font-semibold text-red-600")}>{agent.blocked_today}</Td>
                  <Td className="whitespace-nowrap text-slate-500">{timeAgo(agent.last_activity)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ApprovalQueue pending={pending.data || []} onChange={refresh} />
        <Card>
          <CardHeader icon={<Eye className="h-4 w-4" />} title="Latest security decisions" action={<Link to="/monitor" className="text-xs font-medium text-blue-600 hover:underline">Open live monitor</Link>} />
          {(events.data || []).length === 0 ? (
            <Empty title="No activity yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(events.data || []).map((event) => (
                <li key={event.id}>
                  <Link to={`/inspector/${event.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                    <span className="w-16 shrink-0 font-mono text-xs text-slate-400">{formatTime(event.timestamp)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-500">{event.kind === "SYSTEM" ? "AgentSentinel" : event.agent_name}</span>
                      <span className="block truncate font-mono text-sm text-slate-800">{event.kind === "SYSTEM" ? event.message : callText(event.tool, event.resource)}</span>
                    </span>
                    <DecisionBadge decision={event.decision} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        tone="danger"
        title="Emergency stop ALL agents?"
        footer={
          <>
            <Button onClick={() => setConfirmStop(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon={<Power className="h-4 w-4" />}
              onClick={() => {
                setConfirmStop(false);
                void act(api.emergencyStop, "Emergency stop activated — all agents disabled").then(refresh);
              }}
            >
              Yes, stop all agents
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Every running agent is immediately <b>DISABLED</b>, all sessions are revoked, pending actions are cancelled and the gateway refuses every
          future action until an administrator releases the stop.
        </p>
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">POC note: this only changes simulated agent state. No real infrastructure is shut down.</p>
      </Modal>
    </>
  );
}
