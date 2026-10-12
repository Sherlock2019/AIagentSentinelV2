import { Lock, Pause, Play, Power, RotateCcw, UserCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useApp } from "../hooks/useApp";
import type { Agent, PendingAction } from "../types";
import { RiskMeter } from "./badges";
import { Button, Card, CardHeader, Empty, Modal, callText, timeAgo } from "./ui";

/** Agent-level containment controls: PAUSE / QUARANTINE / KILL, and RESUME / RESTORE. */
export function AgentControls({ agent, onChange }: { agent: Agent; onChange: () => void }) {
  const { act } = useApp();
  const [confirmKill, setConfirmKill] = useState(false);
  const run = async (action: "pause" | "resume" | "quarantine" | "kill", message: string) => {
    await act(() => api.agentControl(agent.id, action), message);
    onChange();
  };
  const live = agent.status === "RUNNING" || agent.status === "REVIEW";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {live && <Button size="sm" icon={<Pause className="h-3.5 w-3.5" />} onClick={() => void run("pause", `${agent.name} paused`)}>Pause</Button>}
      {agent.status === "PAUSED" && <Button size="sm" variant="success" icon={<Play className="h-3.5 w-3.5" />} onClick={() => void run("resume", `${agent.name} resumed`)}>Resume</Button>}
      {(live || agent.status === "PAUSED") && <Button size="sm" variant="warning" icon={<Lock className="h-3.5 w-3.5" />} onClick={() => void run("quarantine", `${agent.name} quarantined`)}>Quarantine</Button>}
      {(agent.status === "QUARANTINED" || agent.status === "DISABLED") && (
        <Button size="sm" variant="success" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void run("resume", `${agent.name} restored with a new session`)}>Restore</Button>
      )}
      {agent.status !== "DISABLED" && <Button size="sm" variant="danger" icon={<Power className="h-3.5 w-3.5" />} onClick={() => setConfirmKill(true)}>Kill</Button>}
      <Modal
        open={confirmKill}
        onClose={() => setConfirmKill(false)}
        tone="danger"
        title={`Kill ${agent.name}?`}
        footer={
          <>
            <Button onClick={() => setConfirmKill(false)}>Cancel</Button>
            <Button variant="danger" icon={<Power className="h-4 w-4" />} onClick={() => { setConfirmKill(false); void run("kill", `${agent.name} killed`); }}>Kill agent</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">The agent is marked <b>DISABLED</b>, its session token is invalidated, pending actions are cancelled and every future gateway call is refused. In this POC nothing outside the simulation is touched.</p>
      </Modal>
    </div>
  );
}

/** Human-in-the-loop queue: actions Sentinel is holding until an administrator decides. */
export function ApprovalQueue({ pending, onChange }: { pending: PendingAction[]; onChange: () => void }) {
  const { act } = useApp();
  const resolve = async (id: string, verdict: "approve" | "reject") => {
    await act(() => api.resolveAction(id, verdict), verdict === "approve" ? "Approved — tool executed" : "Rejected — nothing executed");
    onChange();
  };
  return (
    <Card>
      <CardHeader icon={<UserCheck className="h-4 w-4" />} title="Human approval queue" subtitle="Held actions. Nothing runs until a person decides." />
      {pending.length === 0 ? (
        <Empty title="No actions waiting for approval" hint="Approval-required tools (refunds, payments, patches) appear here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {pending.map((action) => (
            <li key={action.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 animate-fade-in">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">{action.agent_name} · {timeAgo(action.timestamp)}</p>
                <p className="mt-0.5 break-all font-mono text-sm text-slate-900">{callText(action.tool, action.resource)}</p>
                <p className="mt-0.5 text-xs text-slate-500">{action.reasons[0]}</p>
              </div>
              <div className="flex items-center gap-2">
                <RiskMeter score={action.risk_score} />
                {action.event_id && <Link to={`/inspector/${action.event_id}`} className="text-xs font-medium text-blue-600 hover:underline">Inspect</Link>}
                <Button size="sm" variant="success" onClick={() => void resolve(action.id, "approve")}>Approve</Button>
                <Button size="sm" onClick={() => void resolve(action.id, "reject")}>Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
