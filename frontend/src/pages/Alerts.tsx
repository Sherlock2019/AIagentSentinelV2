import { Bell, Check, Lock, Mail, MessageSquare, RotateCcw, Search, Webhook } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ApprovalQueue } from "../components/AgentWidgets";
import { RiskMeter, SeverityBadge, StatusBadge } from "../components/badges";
import { Button, Card, Empty, ErrorState, JsonBlock, Loading, PageHeader, SectionLabel, Segmented, callText, cx, formatDateTime, timeAgo } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { Alert } from "../types";

const CHANNEL_ICON: Record<string, ReactNode> = {
  dashboard: <Bell className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  slack: <MessageSquare className="h-3.5 w-3.5" />,
  webhook: <Webhook className="h-3.5 w-3.5" />,
};
const BORDER: Record<string, string> = { CRITICAL: "border-l-red-600", HIGH: "border-l-orange-500", WARNING: "border-l-amber-400", INFO: "border-l-slate-300" };

function AlertCard({ alert, onChange }: { alert: Alert; onChange: () => void }) {
  const { act, isEngineer } = useApp();
  const [showChannels, setShowChannels] = useState(false);
  const run = async (action: Parameters<typeof api.alertAction>[1], message: string) => {
    await act(() => api.alertAction(alert.id, action), message);
    onChange();
  };
  const hasAgent = alert.agent_id !== "*";
  const contained = alert.agent_state === "QUARANTINED" || alert.agent_state === "DISABLED" || alert.agent_state === "PAUSED";
  const resolved = alert.status === "RESOLVED";
  const fresh = Date.now() - new Date(alert.created_at).getTime() < 8000;

  return (
    <Card className={cx("overflow-hidden border-l-4", BORDER[alert.severity] || BORDER.INFO, fresh && "animate-slide-up", resolved && "opacity-75")}>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={alert.severity} />
            <span className="text-sm font-semibold text-slate-900">{alert.agent_name}</span>
            <span className="text-xs text-slate-400" title={formatDateTime(alert.created_at)}>{timeAgo(alert.created_at)}</span>
          </div>
          <span className={cx("rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", alert.status === "OPEN" ? "bg-red-100 text-red-700" : alert.status === "RESOLVED" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
            {alert.status}{alert.admin_action && alert.status === "RESOLVED" ? ` · ${alert.admin_action}` : ""}
          </span>
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-[1.2fr_1.4fr_1fr]">
          <div>
            <SectionLabel>Requested action</SectionLabel>
            <p className="mt-1 break-all font-mono text-sm font-semibold text-slate-900">{alert.tool ? callText(alert.tool, alert.resource) : alert.title}</p>
            {alert.tool && <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">Risk score <RiskMeter score={alert.risk_score} /></p>}
          </div>
          <div>
            <SectionLabel>Why</SectionLabel>
            <ul className="mt-1 space-y-0.5">
              {alert.reasons.slice(0, isEngineer ? 6 : 3).map((reason) => (
                <li key={reason} className="flex gap-1.5 text-sm text-slate-700"><span className="text-red-500">•</span>{reason}</li>
              ))}
            </ul>
          </div>
          <div>
            <SectionLabel>Sentinel response</SectionLabel>
            <ul className="mt-1 space-y-0.5">
              {alert.sentinel_response.map((line) => <li key={line} className="text-xs font-semibold tracking-wide text-slate-800">{line}</li>)}
            </ul>
            {hasAgent && <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">Agent now <StatusBadge status={alert.agent_state} /></p>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} disabled={alert.status !== "OPEN"} onClick={() => void run("acknowledge", "Alert acknowledged")}>Acknowledge</Button>
          <Button size="sm" icon={<Search className="h-3.5 w-3.5" />} disabled={resolved || alert.status === "INVESTIGATING"} onClick={() => void run("investigate", "Investigation opened")}>Investigate</Button>
          {hasAgent && <Button size="sm" variant="danger" icon={<Lock className="h-3.5 w-3.5" />} disabled={resolved} onClick={() => void run("keep-quarantined", `${alert.agent_name} kept quarantined`)}>Keep quarantined</Button>}
          {hasAgent && <Button size="sm" variant="success" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={!contained} onClick={() => void run("restore-agent", `${alert.agent_name} restored`)}>Restore agent</Button>}
          <span className="flex-1" />
          {alert.event_id && <Link to={`/inspector/${alert.event_id}`} className="text-xs font-medium text-blue-600 hover:underline">Open in Event Inspector →</Link>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notified via</span>
          {alert.channels.map((channel) => (
            <span key={channel.channel} className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]", channel.status === "DISABLED" ? "border-slate-200 text-slate-300 line-through" : "border-slate-200 bg-slate-50 text-slate-600")}>
              {CHANNEL_ICON[channel.channel]} {channel.channel} <span className="text-slate-400">· {channel.status.toLowerCase()}</span>
            </span>
          ))}
          <button type="button" className="text-[11px] font-medium text-blue-600 hover:underline" onClick={() => setShowChannels((v) => !v)}>
            {showChannels ? "Hide" : "View"} simulated payloads
          </button>
        </div>
        {showChannels && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {alert.channels.filter((c) => c.payload && c.channel !== "dashboard").map((channel) => (
              <div key={channel.channel}>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold capitalize text-slate-600">{CHANNEL_ICON[channel.channel]} {channel.channel} ({channel.status.toLowerCase()})</p>
                <JsonBlock value={channel.payload} maxHeight="12rem" />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function Alerts() {
  const { refreshOverview } = useApp();
  const alerts = usePolling(api.alerts, 3000);
  const pending = usePolling(api.pending, 3000);
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "CRITICAL" | "HIGH">("ALL");
  const refresh = () => {
    void alerts.refresh();
    void pending.refresh();
    void refreshOverview();
  };
  const list = (alerts.data || []).filter((a) => filter === "ALL" || (filter === "OPEN" ? a.status === "OPEN" : a.severity === filter));

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="What Sentinel stopped, why, what it did about it — and what the administrator decided."
        actions={<Segmented value={filter} onChange={setFilter} options={[{ value: "ALL", label: "All" }, { value: "OPEN", label: "Open" }, { value: "CRITICAL", label: "Critical" }, { value: "HIGH", label: "High" }]} />}
      />
      {(pending.data || []).length > 0 && <div className="mb-4"><ApprovalQueue pending={pending.data || []} onChange={refresh} /></div>}
      {alerts.error && !alerts.data ? <ErrorState message={alerts.error} onRetry={refresh} /> : !alerts.data ? <Loading /> : list.length === 0 ? (
        <Card><Empty icon={<Bell className="h-8 w-8" />} title={filter === "ALL" ? "No alerts — all agents are behaving" : "No alerts match this filter"} hint="Run a scenario in the Red Team Lab to see Sentinel raise one." /></Card>
      ) : (
        <div className="space-y-3">{list.map((alert) => <AlertCard key={alert.id} alert={alert} onChange={refresh} />)}</div>
      )}
    </>
  );
}
