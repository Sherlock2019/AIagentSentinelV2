import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { riskTone } from "../components/badges";
import { Card, CardHeader, ErrorState, Loading, PageHeader, Td, Th } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import type { Metrics as MetricsData } from "../types";

// Decisions and severities are STATES, so they use the reserved status palette (always with a label).
const DECISION = { allow: "#0ca30c", review: "#fab219", block: "#d03b3b" };
const SEVERITY: Record<string, string> = { LOW: "#0ca30c", MEDIUM: "#fab219", HIGH: "#ec835a", CRITICAL: "#d03b3b" };
const SERIES = { avg: "#2a78d6", max: "#eb6834" };
const AXIS = { fontSize: 11, fill: "#898781" };
const GRID = "#e1e0d9";
const tooltipStyle = { borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 4px 12px rgba(15,23,42,0.08)" };
const legendText = (value: string) => <span style={{ color: "#52514e", fontSize: 12 }}>{value}</span>;

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="truncate text-xl font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </Card>
  );
}

function ChartCard({ title, subtitle, children, table }: { title: string; subtitle: string; children: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={<button type="button" className="text-xs font-medium text-blue-600 hover:underline" onClick={() => setAsTable((v) => !v)}>{asTable ? "Show chart" : "Show table"}</button>}
      />
      <div className="h-64 px-3 py-3">{asTable ? <div className="scroll-thin h-full overflow-auto">{table}</div> : children}</div>
    </Card>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full">
      <thead><tr>{columns.map((c) => <Th key={c} className="!px-2 !py-1.5">{c}</Th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <Td key={j} className="!px-2 !py-1.5 text-xs tabular-nums">{cell}</Td>)}</tr>)}
      </tbody>
    </table>
  );
}

const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function Charts({ data }: { data: MetricsData }) {
  const series = data.series.map((b) => ({ ...b, label: hourLabel(b.t) }));
  const decisions = data.by_decision.filter((d) => d.value > 0);
  const severities = data.by_severity;
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <ChartCard title="Actions over time" subtitle={`Decisions per ${data.bucket_minutes} minutes, last 6 hours`} table={<DataTable columns={["Until", "Allow", "Review", "Block"]} rows={series.map((b) => [b.label, b.allow, b.review, b.block])} />}>
        <ResponsiveContainer>
          <BarChart data={series} barCategoryGap="28%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#c3c2b7" }} interval={1} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
            <Legend iconType="square" iconSize={9} formatter={legendText} />
            <Bar dataKey="allow" name="Allow" stackId="d" fill={DECISION.allow} stroke="#fff" strokeWidth={1} />
            <Bar dataKey="review" name="Review" stackId="d" fill={DECISION.review} stroke="#fff" strokeWidth={1} />
            <Bar dataKey="block" name="Block" stackId="d" fill={DECISION.block} stroke="#fff" strokeWidth={1} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Risk over time" subtitle="Average and peak risk score (0–100) per interval" table={<DataTable columns={["Until", "Average risk", "Peak risk"]} rows={series.map((b) => [b.label, b.avg_risk, b.max_risk])} />}>
        <ResponsiveContainer>
          <LineChart data={series}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#c3c2b7" }} interval={1} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 100]} width={28} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend iconType="plainline" formatter={legendText} />
            <Line type="monotone" dataKey="avg_risk" name="Average risk" stroke={SERIES.avg} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="max_risk" name="Peak risk" stroke={SERIES.max} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Decisions by type" subtitle={`${data.totals.total_actions} actions evaluated`} table={<DataTable columns={["Decision", "Count"]} rows={data.by_decision.map((d) => [d.name, d.value])} />}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={decisions} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="#fff" strokeWidth={2} label={({ name, value }) => `${name} ${value}`} labelLine={false} fontSize={11}>
              {decisions.map((d) => <Cell key={d.name} fill={DECISION[d.name.toLowerCase() as keyof typeof DECISION]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend iconType="square" iconSize={9} formatter={legendText} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Events by severity" subtitle="Risk level assigned to each action" table={<DataTable columns={["Severity", "Count"]} rows={severities.map((s) => [s.name, s.value])} />}>
        <ResponsiveContainer>
          <BarChart data={severities} barCategoryGap="35%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: "#c3c2b7" }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
            <Bar dataKey="value" name="Events" radius={[4, 4, 0, 0]} label={{ position: "top", fontSize: 11, fill: "#52514e" }}>
              {severities.map((s) => <Cell key={s.name} fill={SEVERITY[s.name]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Tool usage" subtitle="Top tools by call count, split by decision" table={<DataTable columns={["Tool", "Allow", "Review", "Block"]} rows={data.tool_usage.map((t) => [t.tool, t.allow, t.review, t.block])} />}>
        <ResponsiveContainer>
          <BarChart data={data.tool_usage} layout="vertical" barCategoryGap="22%">
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="tool" tick={{ ...AXIS, fontFamily: "ui-monospace, monospace" }} tickLine={false} axisLine={{ stroke: "#c3c2b7" }} width={132} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
            <Legend iconType="square" iconSize={9} formatter={legendText} />
            <Bar dataKey="allow" name="Allow" stackId="t" fill={DECISION.allow} stroke="#fff" strokeWidth={1} />
            <Bar dataKey="review" name="Review" stackId="t" fill={DECISION.review} stroke="#fff" strokeWidth={1} />
            <Bar dataKey="block" name="Block" stackId="t" fill={DECISION.block} stroke="#fff" strokeWidth={1} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Agent risk ranking" subtitle="Current risk score per agent (0–100)" table={<DataTable columns={["Agent", "Risk", "Blocked", "State"]} rows={data.agent_ranking.map((a) => [a.agent, a.risk, a.blocked, a.status])} />}>
        <ResponsiveContainer>
          <BarChart data={data.agent_ranking} layout="vertical" barCategoryGap="30%">
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="agent" tick={AXIS} tickLine={false} axisLine={{ stroke: "#c3c2b7" }} width={148} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
            <Bar dataKey="risk" name="Risk score" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "#52514e" }}>
              {data.agent_ranking.map((a) => <Cell key={a.agent} fill={riskTone(a.risk).hex} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

export default function Metrics() {
  const metrics = usePolling(api.metrics, 5000);
  if (metrics.error && !metrics.data) return <ErrorState message={metrics.error} onRetry={() => void metrics.refresh()} />;
  if (!metrics.data) return <Loading />;
  const t = metrics.data.totals;
  return (
    <>
      <PageHeader title="Metrics" subtitle="What the gateway has evaluated, decided and stopped." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total actions" value={t.total_actions} />
        <Stat label="Allowed" value={t.allowed} />
        <Stat label="Review" value={t.review} />
        <Stat label="Blocked" value={t.blocked} />
        <Stat label="Critical events" value={t.critical_events} />
        <Stat label="Quarantined agents" value={t.quarantined_agents} />
        <Stat label="Average risk" value={t.average_risk} hint="0–100 across all actions" />
        <Stat label="Top risky tool" value={<span className="font-mono text-base">{t.top_risky_tool || "—"}</span>} />
        <Stat label="Top risky agent" value={<span className="text-base">{t.top_risky_agent || "—"}</span>} />
        <Stat label="Injection detections" value={t.prompt_injection_detections} />
        <Stat label="Policy violations" value={t.policy_violations} />
        <Stat label="Tool abuse attempts" value={t.tool_abuse_attempts} />
      </div>
      <Charts data={metrics.data} />
    </>
  );
}
