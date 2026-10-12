import { Download, Link2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { RiskMeter } from "../components/badges";
import { Card, Empty, ErrorState, Loading, PageHeader, Select, Td, Th, cx, formatDateTime, inputClass } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";

const DECISION_TONE = (decision: string) =>
  decision === "ALLOW" ? "bg-emerald-50 text-emerald-700" : decision === "REVIEW" ? "bg-amber-50 text-amber-800" : decision === "BLOCK" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600";

export default function AuditTrail() {
  const { overview, isEngineer } = useApp();
  const [agent, setAgent] = useState("");
  const [decision, setDecision] = useState("");
  const [tool, setTool] = useState("");
  const filters = { agent_id: agent, decision, tool };
  const audit = usePolling(() => api.audit(filters), 5000, [agent, decision, tool]);

  return (
    <>
      <PageHeader
        title="Audit Trail"
        subtitle="Every decision and every administrator action, appended to a hash-chained log. Editing history breaks the chain."
        actions={
          <>
            {(["json", "csv"] as const).map((format) => (
              <a
                key={format}
                href={api.auditExportUrl(format, filters)}
                download
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-4 w-4" /> Export {format.toUpperCase()}
              </a>
            ))}
          </>
        }
      />
      <Card className="mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="text-xs font-medium text-slate-500">Agent
          <Select label="Agent" className="mt-1 block" value={agent} onChange={setAgent} options={[{ value: "", label: "All" }, ...(overview?.agents || []).map((a) => ({ value: a.id, label: a.name }))]} />
        </label>
        <label className="text-xs font-medium text-slate-500">Decision
          <Select label="Decision" className="mt-1 block" value={decision} onChange={setDecision} options={[{ value: "", label: "All" }, ...["ALLOW", "REVIEW", "BLOCK", "STATE", "ADMIN", "HUMAN"].map((v) => ({ value: v, label: v }))]} />
        </label>
        <label className="text-xs font-medium text-slate-500">Tool
          <input className={cx(inputClass, "mt-1 block w-44")} placeholder="tool name" value={tool} onChange={(e) => setTool(e.target.value.trim())} />
        </label>
        {audit.data && (
          <span className={cx("ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold", audit.data.integrity.valid ? "bg-emerald-50 text-emerald-800" : "bg-red-600 text-white")}>
            {audit.data.integrity.valid ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {audit.data.integrity.valid ? `Hash chain verified · ${audit.data.integrity.records} records` : `TAMPERING DETECTED at record #${audit.data.integrity.broken_at_seq}`}
          </span>
        )}
      </Card>

      {audit.error && !audit.data ? <ErrorState message={audit.error} onRetry={() => void audit.refresh()} /> : !audit.data ? <Loading /> : audit.data.records.length === 0 ? (
        <Card><Empty title="No audit records match these filters" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  <Th>#</Th><Th>Timestamp</Th><Th>Agent</Th><Th>Requested tool</Th><Th>Resource</Th><Th>Policy</Th>
                  {isEngineer && <Th>LLM</Th>}{isEngineer && <Th>Behaviour</Th>}
                  <Th>Risk</Th><Th>Decision</Th><Th>Agent state</Th><Th>Alert</Th><Th>Admin action</Th>{isEngineer && <Th>Hash</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {audit.data.records.map((r) => (
                  <tr key={r.seq} className="hover:bg-slate-50" title={r.user_task ? `Task: ${r.user_task}\nArguments: ${r.arguments_summary}` : undefined}>
                    <Td className="font-mono text-xs text-slate-400">{r.seq}</Td>
                    <Td className="whitespace-nowrap font-mono text-xs">{formatDateTime(r.timestamp)}</Td>
                    <Td className="whitespace-nowrap">{r.agent_id}</Td>
                    <Td className="font-mono text-xs">{r.requested_tool || "—"}</Td>
                    <Td className="max-w-48 truncate font-mono text-xs">{r.resource || "—"}</Td>
                    <Td className="font-mono text-xs">{r.policy_result}</Td>
                    {isEngineer && <Td className="font-mono text-xs">{r.llm_result ? String(r.llm_result.recommended_decision) : "—"}</Td>}
                    {isEngineer && <Td className="tabular-nums">{r.behavior_score}</Td>}
                    <Td><RiskMeter score={r.final_risk} width="w-10" /></Td>
                    <Td><span className={cx("whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold", DECISION_TONE(r.decision))}>{r.decision}</span></Td>
                    <Td className="text-xs">{r.quarantine_state || "—"}</Td>
                    <Td className="text-xs">{r.alert_generated ? "Yes" : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs">{r.admin_action || "—"}</Td>
                    {isEngineer && (
                      <Td className="whitespace-nowrap font-mono text-[10px] text-slate-400">
                        <Link to={`/inspector/${r.event_id}`} className="inline-flex items-center gap-1 hover:text-blue-600" title={`prev ${r.prev_hash}\nhash ${r.hash}`}>
                          <Link2 className="h-3 w-3" />{r.hash.slice(0, 10)}…
                        </Link>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">Showing {audit.data.records.length} of {audit.data.total} records, newest first. Exports include every matching record.</p>
        </Card>
      )}
    </>
  );
}
