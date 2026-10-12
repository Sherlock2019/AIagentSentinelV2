import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, CircleSlash, Clock, Github, Info, Loader2, Package, Play, RotateCw, ShieldCheck, UserCheck, XCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { DecisionBadge, RiskMeter } from "../components/badges";
import { ACTION_REF, GithubSetup } from "../components/GithubSetup";
import { Button, Card, ErrorState, Loading, PageHeader, callText, cx } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { PipelineInfo, PipelineJob, PipelineRun } from "../types";

// ---------------------------------------------------------------- statuses
type St = "queued" | "running" | "success" | "failure" | "waiting" | "skipped";
const ST_ICON: Record<St, ReactNode> = {
  queued: <CircleDashed className="h-4 w-4 text-slate-400" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-amber-500" />,
  success: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  failure: <XCircle className="h-4 w-4 text-red-600" />,
  waiting: <Clock className="h-4 w-4 text-amber-600" />,
  skipped: <CircleSlash className="h-4 w-4 text-slate-400" />,
};
const ST_LABEL: Record<St, string> = { queued: "Queued", running: "In progress", success: "Success", failure: "Failure", waiting: "Waiting", skipped: "Skipped" };
const STEPS = ["Set up job", "Run actions/checkout@v4", "AgentSentinel gate", "Run guarded command", "Complete job"];
const GATE = 2;
const TICK_MS = 480;
type Override = "approved" | "rejected";

function jobStatus(job: PipelineJob, tick: number, override?: Override): St {
  if (tick < 1) return "queued";
  if (tick <= GATE) return "running";
  if (override === "approved") return tick < STEPS.length ? "running" : "success";
  if (override === "rejected") return "failure";
  if (job.outcome === "waiting") return "waiting";
  return tick < STEPS.length ? "running" : job.outcome;
}

function stepStatus(job: PipelineJob, step: number, tick: number, override?: Override): St {
  if (tick < step) return "queued";
  if (tick === step) {
    if (job.outcome === "waiting" && !override && step > GATE) return "queued";
    return "running";
  }
  const allowed = job.outcome === "success" || override === "approved";
  if (step === GATE) return job.response.decision === "ALLOW" || override === "approved" ? "success" : job.response.decision === "REVIEW" && !override ? "waiting" : "failure";
  if (step === GATE + 1) return allowed ? "success" : job.outcome === "waiting" && !override ? "queued" : "skipped";
  if (step === GATE + 2) return job.outcome === "waiting" && !override ? "queued" : "success";
  return "success";
}

function stepSeconds(job: PipelineJob, step: number): string {
  if (step === GATE) return `${Math.max(1, Math.round((job.response.event.timings?.total_ms || 0) / 100) / 10)}s`;
  return ["2s", "1s", "", job.tool === "run_tests" ? "6s" : "3s", "0s"][step];
}

// --------------------------------------------------------------- log lines
type Line = { text: string; tone?: "error" | "warn" | "ok" | "dim" | "cmd" };
function stepLog(job: PipelineJob, step: number, override?: Override): Line[] {
  const r = job.response;
  switch (step) {
    case 0:
      return [{ text: "Current runner version: '2.321.0'" }, { text: "Operating System: Ubuntu 24.04 LTS" }, { text: `Download action repository '${ACTION_REF}'`, tone: "dim" }];
    case 1:
      return [{ text: "Syncing repository: acme/storefront" }, { text: "Checking out the ref refs/pull/128/merge", tone: "dim" }];
    case GATE: {
      const lines: Line[] = [
        { text: `Run ${ACTION_REF}`, tone: "cmd" },
        { text: `  agent-id: coding-agent`, tone: "dim" },
        { text: `  tool: ${job.tool}`, tone: "dim" },
        { text: `  resource: ${job.resource}`, tone: "dim" },
        { text: `  on-review: ${job.on_review}`, tone: "dim" },
        { text: `[sentinel] ${r.decision}  risk=${r.risk_score}/100 (${r.severity})  agent=${r.agent_status}  event=${r.event_id}`, tone: r.decision === "ALLOW" ? "ok" : r.decision === "REVIEW" ? "warn" : "error" },
        ...r.reasons.slice(0, 4).map((reason) => ({ text: `[sentinel]   - ${reason}` })),
      ];
      if (r.decision === "REVIEW") {
        lines.push({ text: "[sentinel] Held for human approval. Approve or reject it in the dashboard (waiting up to 900s)", tone: "warn" });
        if (override) lines.push({ text: `[sentinel] human decision: ${override === "approved" ? "APPROVED" : "REJECTED"}`, tone: override === "approved" ? "ok" : "error" });
      }
      if (r.decision === "BLOCK" || override === "rejected") {
        lines.push({ text: `Error: ${r.decision === "BLOCK" ? "AgentSentinel blocked this step" : "AgentSentinel: human approval required"}: ${callText(job.tool, job.resource)} — ${r.reasons[0]}`, tone: "error" });
        lines.push({ text: `Error: Process completed with exit code ${r.decision === "BLOCK" ? 1 : 2}.`, tone: "error" });
      }
      return lines;
    }
    case GATE + 1:
      return job.outcome === "success" || override === "approved"
        ? [{ text: `Run ${job.run}`, tone: "cmd" }, { text: "(simulated — the command ran because Sentinel allowed it)", tone: "dim" }]
        : [{ text: "This step was skipped: AgentSentinel did not allow it, so the command never ran.", tone: "dim" }];
    default:
      return [{ text: "Cleaning up orphan processes", tone: "dim" }];
  }
}

const LOG_TONE: Record<string, string> = { error: "text-red-400", warn: "text-amber-300", ok: "text-emerald-400", dim: "text-slate-500", cmd: "text-sky-300" };

// ------------------------------------------------------------------ views
function JobLog({ job, tick, override }: { job: PipelineJob; tick: number; override?: Override }) {
  const [open, setOpen] = useState<Set<number>>(new Set([GATE]));
  const status = jobStatus(job, tick, override);
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0d1117] text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
        <div>
          <p className="text-sm font-semibold text-white">{job.job}</p>
          <p className="text-xs text-slate-400">{job.name} · {ST_LABEL[status].toLowerCase()}</p>
        </div>
        <Link to={`/inspector/${job.response.event_id}`} className="text-xs font-medium text-sky-400 hover:underline">Sentinel evidence →</Link>
      </div>
      <ol className="py-1.5">
        {STEPS.map((title, i) => {
          const st = stepStatus(job, i, tick, override);
          const visible = st !== "queued" && st !== "running";
          const label = i === GATE + 1 ? `Run ${job.run}` : title;
          return (
            <li key={title}>
              <button type="button" disabled={!visible} onClick={() => toggle(i)} className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] hover:bg-white/5 disabled:cursor-default">
                {visible ? (open.has(i) ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />) : <span className="w-3.5" />}
                {ST_ICON[st]}
                <span className={cx("flex-1", st === "queued" ? "text-slate-500" : "text-slate-200")}>{label}</span>
                {visible && st !== "skipped" && <span className="font-mono text-[11px] text-slate-500">{stepSeconds(job, i)}</span>}
              </button>
              {visible && open.has(i) && (
                <pre className="scroll-thin overflow-x-auto pb-2 font-mono text-[11.5px] leading-[1.65]">
                  {stepLog(job, i, override).map((line, n) => (
                    <div key={n} className="flex hover:bg-white/5">
                      <span className="w-14 shrink-0 select-none pr-3 text-right text-slate-600">{n + 1}</span>
                      <span className={cx("whitespace-pre", line.tone ? LOG_TONE[line.tone] : "text-slate-200")}>{line.text}</span>
                    </div>
                  ))}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function WorkflowGraph({ jobs, statusOf, onSelect }: { jobs: PipelineJob[] | PipelineInfo["jobs"]; statusOf: (i: number) => St; onSelect?: (i: number) => void }) {
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-slate-900">agent-pipeline.yml</p>
      <p className="text-xs text-slate-500">on: pull_request</p>
      <div className="mt-5 flex items-center gap-0 overflow-x-auto pb-1">
        <div className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">pull_request #128</div>
        <svg width="48" height={jobs.length * 52} className="shrink-0" aria-hidden>
          {jobs.map((_, i) => {
            const y = i * 52 + 22;
            const mid = (jobs.length * 52) / 2 - 4;
            return <path key={i} d={`M0 ${mid} C 24 ${mid}, 24 ${y}, 48 ${y}`} fill="none" stroke="#cbd5e1" strokeWidth="1.5" />;
          })}
        </svg>
        <div className="flex shrink-0 flex-col gap-2">
          {jobs.map((job, i) => {
            const st = statusOf(i);
            return (
              <button
                key={job.job}
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(i)}
                className={cx("flex h-11 w-72 items-center gap-2.5 rounded-lg border bg-white px-3 text-left shadow-sm transition-colors", onSelect && "hover:border-blue-400", st === "failure" ? "border-red-300" : st === "waiting" ? "border-amber-300" : "border-slate-300")}
              >
                {ST_ICON[st]}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">{job.job}</span>
                  <span className="block truncate font-mono text-[11px] text-slate-500">{callText(job.tool, job.resource)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function JobSummary({ job }: { job: PipelineJob }) {
  const r = job.response;
  const icon = r.decision === "ALLOW" ? "✅" : r.decision === "REVIEW" ? "🟡" : "⛔";
  return (
    <div className="border-t border-slate-100 px-5 py-4 first:border-t-0">
      <p className="text-xs text-slate-500">{job.job} summary</p>
      <p className="mt-1 text-[15px] font-semibold text-slate-900">{icon} AgentSentinel: {r.decision} — <span className="font-mono text-sm">{callText(job.tool, job.resource)}</span></p>
      <table className="mt-2 text-sm">
        <tbody className="[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1">
          <tr><td className="text-slate-500">Risk score</td><td><span className="flex items-center gap-2">{r.risk_score} / 100 ({r.severity}) <RiskMeter score={r.risk_score} width="w-14" /></span></td></tr>
          <tr><td className="text-slate-500">Agent state</td><td>{r.agent_status}</td></tr>
          <tr><td className="text-slate-500">Why</td><td>{r.reasons[0]}</td></tr>
          <tr><td className="text-slate-500">Evidence</td><td><Link to={`/inspector/${r.event_id}`} className="text-blue-600 hover:underline">Open in Event Inspector</Link></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function ActionsRun({ info }: { info: PipelineInfo }) {
  const { act } = useApp();
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  useEffect(() => {
    if (!run || tick >= STEPS.length) return;
    const timer = window.setTimeout(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearTimeout(timer);
  }, [run, tick]);

  const start = async () => {
    setBusy(true);
    const result = await act(api.pipelineRun);
    setBusy(false);
    if (result) {
      setRun(result);
      setTick(0);
      setSelected(null);
      setOverrides({});
    }
  };
  const decide = async (job: PipelineJob, verdict: "approve" | "reject") => {
    const ok = await act(() => api.resolveAction(job.response.action_id, verdict), verdict === "approve" ? "Approved — the job continues" : "Rejected — the job fails");
    if (ok !== undefined) setOverrides((o) => ({ ...o, [job.job]: verdict === "approve" ? "approved" : "rejected" }));
  };

  const statuses = run ? run.jobs.map((j) => jobStatus(j, tick, overrides[j.job])) : info.jobs.map(() => "queued" as St);
  const done = !!run && tick >= STEPS.length;
  const overall: St = !run ? "queued" : !done ? "running" : statuses.includes("failure") ? "failure" : statuses.includes("waiting") ? "waiting" : "success";
  const waiting = run?.jobs.find((_, i) => statuses[i] === "waiting");
  type Annotation = { level: "error" | "warning"; job: string; title: string; text: string };
  const annotations: Annotation[] = [];
  if (run && done) {
    run.jobs.forEach((j, i) => {
      if (statuses[i] === "failure") {
        annotations.push({ level: "error", job: j.job, title: j.response.decision === "BLOCK" ? "AgentSentinel blocked this step" : "AgentSentinel: human approval rejected", text: `${callText(j.tool, j.resource)} — ${j.response.reasons[0]}` });
      } else if (statuses[i] === "waiting") {
        annotations.push({ level: "warning", job: j.job, title: "AgentSentinel: human approval required", text: `${callText(j.tool, j.resource)} is held until an administrator decides.` });
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-[#f6f8fa] shadow-sm">
      {/* GitHub-style header */}
      <div className="border-b border-slate-300 bg-white px-5 pt-3">
        <p className="flex items-center gap-2 text-sm text-slate-600"><Github className="h-4 w-4" /> <span className="font-semibold text-slate-900">{info.repository}</span> <span className="text-slate-400">/</span> Actions</p>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 pb-4">
          <div className="flex items-start gap-2.5">
            <span className="mt-1">{ST_ICON[overall]}</span>
            <div>
              <p className="text-xl text-slate-900"><span className="font-semibold">Guarded AI agent pipeline</span> <span className="text-slate-400">#{run?.run_number ?? "—"}</span></p>
              <p className="mt-0.5 text-xs text-slate-500">
                {run ? <>pull_request <b className="text-slate-700">#128</b> · <span className="font-mono">{run.branch}</span> · triggered by <b className="text-slate-700">coding-agent[bot]</b></> : "This workflow has not run yet."}
              </p>
            </div>
          </div>
          <Button variant={run ? "secondary" : "success"} icon={run ? <RotateCw className="h-4 w-4" /> : <Play className="h-4 w-4" />} busy={busy} disabled={!!run && !done} onClick={() => void start()}>
            {run ? "Re-run all jobs" : "Run workflow"}
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-[13rem_1fr]">
        {/* run sidebar */}
        <aside className="border-b border-slate-300 bg-white p-3 md:border-b-0 md:border-r">
          <button type="button" onClick={() => setSelected(null)} className={cx("w-full rounded-md px-3 py-2 text-left text-sm", selected === null ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-50")}>Summary</button>
          <p className="mt-3 px-3 text-xs font-semibold text-slate-500">Jobs</p>
          {info.jobs.map((job, i) => (
            <button
              key={job.job}
              type="button"
              disabled={!run}
              onClick={() => setSelected(i)}
              className={cx("mt-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm disabled:cursor-default", selected === i ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-50")}
            >
              {ST_ICON[statuses[i]]} {job.job}
            </button>
          ))}
          <p className="mt-4 px-3 text-xs font-semibold text-slate-500">Run details</p>
          <p className="px-3 py-1.5 text-xs text-slate-500">Gate: <span className="font-mono">AgentSentinel</span></p>
        </aside>

        <div className="min-w-0 space-y-4 p-4">
          {!run && (
            <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>A simulated pull-request pipeline. Each job calls the AgentSentinel action before an AI coding agent acts. The runner is mocked; <b>every decision comes from the real gateway</b>.</p>
            </div>
          )}

          {selected !== null && run ? (
            <JobLog key={`${run.run_number}-${selected}`} job={run.jobs[selected]} tick={tick} override={overrides[run.jobs[selected].job]} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ["Triggered via", run ? "pull_request" : "—"],
                  ["Status", run ? ST_LABEL[overall] : "Not run"],
                  ["Total duration", run && done ? `${8 + run.jobs.length * 3}s` : "—"],
                  ["Artifacts", run && done ? "sentinel-evidence" : "—"],
                ].map(([label, value]) => (
                  <Card key={label} className="px-4 py-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className={cx("mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-slate-900", label === "Status" && overall === "failure" && "text-red-700", label === "Status" && overall === "waiting" && "text-amber-700")}>
                      {label === "Artifacts" && run && done && <Package className="h-3.5 w-3.5 text-slate-500" />}{value}
                    </p>
                  </Card>
                ))}
              </div>

              {waiting && (
                <Card className="border-amber-300 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <UserCheck className="mt-0.5 h-5 w-5 text-amber-600" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Review required — job <span className="font-mono">{waiting.job}</span> is waiting for AgentSentinel approval</p>
                        <p className="text-xs text-slate-600">CodingAgent wants to run <span className="font-mono">{callText(waiting.tool, waiting.resource)}</span>. Nothing runs until a person decides.</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="success" onClick={() => void decide(waiting, "approve")}>Approve and continue</Button>
                      <Button size="sm" onClick={() => void decide(waiting, "reject")}>Reject</Button>
                    </div>
                  </div>
                </Card>
              )}

              <WorkflowGraph jobs={run ? run.jobs : info.jobs} statusOf={(i) => statuses[i]} onSelect={run ? setSelected : undefined} />

              {annotations.length > 0 && (
                <Card>
                  <p className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">Annotations <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">{annotations.length}</span></p>
                  <ul className="divide-y divide-slate-100">
                    {annotations.map((a) => (
                      <li key={a.job} className="flex gap-3 px-5 py-3">
                        {a.level === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{a.job}: {a.title}</p>
                          <p className="font-mono text-xs text-slate-600">{a.text}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {run && done && <Card className="overflow-hidden">{run.jobs.map((job) => <JobSummary key={job.job} job={job} />)}</Card>}

              {run && done && (
                <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>The agent ran its tests, could not change code without a person, and could not deploy at all. Every decision is in the <Link to="/audit" className="font-semibold underline">audit trail</Link> with the repository and run attached.</p>
                </div>
              )}

              {run && (
                <div className="flex flex-wrap gap-2">
                  {run.jobs.map((job) => (
                    <span key={job.job} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
                      {job.job} <DecisionBadge decision={job.response.decision} />
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CICD() {
  const info = usePolling(api.pipelineInfo, 0);
  return (
    <>
      <PageHeader
        eyebrow="CI/CD integration"
        title="GitHub Actions"
        subtitle="Put AgentSentinel in front of AI agents that work in your CI/CD pipeline. The step asks Sentinel first: ALLOW runs it, REVIEW waits for a human, BLOCK fails the job."
      />
      {info.error && !info.data ? <ErrorState message={info.error} onRetry={() => void info.refresh()} /> : !info.data ? <Loading /> : <ActionsRun info={info.data} />}
      <h2 className="mb-1 mt-10 text-lg font-semibold text-slate-900">Use it in a real GitHub Actions workflow</h2>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">The run above shows what the action in <span className="font-mono text-xs">github-action/</span> does on a real runner. Here is how to add it to your repository.</p>
      <GithubSetup />
    </>
  );
}
