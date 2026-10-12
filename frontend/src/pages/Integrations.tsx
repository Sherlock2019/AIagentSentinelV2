import { CheckCircle2, CircleDot, Copy, GitBranch, KeyRound, PauseCircle, Play, ShieldCheck, Workflow, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { DecisionBadge, RiskMeter, StatusBadge } from "../components/badges";
import { Button, Card, CardHeader, Field, Modal, PageHeader, SectionLabel, Select, callText, cx, inputClass } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { PipelineJob, PipelineRun } from "../types";

const OUTCOME: Record<string, { icon: ReactNode; label: string; tone: string }> = {
  success: { icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, label: "Succeeded", tone: "text-emerald-700" },
  waiting: { icon: <PauseCircle className="h-5 w-5 text-amber-500" />, label: "Waiting for approval", tone: "text-amber-700" },
  failure: { icon: <XCircle className="h-5 w-5 text-red-600" />, label: "Failed", tone: "text-red-700" },
};

/** What the runner's log shows for this step — built from the real gateway response. */
function logLines(job: PipelineJob): { text: string; tone?: "error" | "dim" | "ok" | "warn" }[] {
  const r = job.response;
  const lines: { text: string; tone?: "error" | "dim" | "ok" | "warn" }[] = [
    { text: "▶ Run your-org/agentsentinel/github-action@main", tone: "dim" },
    { text: `[sentinel] ${r.decision}  risk=${r.risk_score}/100 (${r.severity})  agent=${r.agent_status}  event=${r.event_id}` },
    ...r.reasons.slice(0, 3).map((reason) => ({ text: `[sentinel]   - ${reason}` })),
  ];
  if (r.decision === "ALLOW") {
    lines.push({ text: `$ ${job.run}`, tone: "ok" }, { text: "(command executed)", tone: "dim" });
  } else if (r.decision === "REVIEW") {
    lines.push(
      { text: "[sentinel] Held for human approval. Approve or reject it in the dashboard (waiting up to 900s)", tone: "warn" },
      { text: `(${job.run} has NOT run — the job is paused)`, tone: "dim" },
    );
  } else {
    lines.push(
      { text: `Error: AgentSentinel blocked this step: ${callText(job.tool, job.resource)} — ${r.reasons[0]}`, tone: "error" },
      { text: `(${job.run} was never executed)`, tone: "dim" },
      { text: "Process completed with exit code 1.", tone: "error" },
    );
  }
  return lines;
}

function JobRow({ job, index }: { job: PipelineJob; index: number }) {
  const outcome = OUTCOME[job.outcome];
  return (
    <li className="animate-slide-up px-5 py-4" style={{ animationDelay: `${index * 120}ms`, animationFillMode: "both" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {outcome.icon}
          <div>
            <p className="text-sm font-semibold text-slate-900">{job.job} <span className="font-normal text-slate-500">· {job.name}</span></p>
            <p className={cx("text-xs font-medium", outcome.tone)}>{outcome.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <RiskMeter score={job.response.risk_score} />
          <DecisionBadge decision={job.response.decision} />
          <Link to={`/inspector/${job.response.event_id}`} className="text-xs font-medium text-blue-600 hover:underline">Evidence →</Link>
        </div>
      </div>
      <pre className="scroll-thin mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11.5px] leading-relaxed">
        {logLines(job).map((line, i) => (
          <div key={i} className={cx(line.tone === "error" ? "text-red-400" : line.tone === "dim" ? "text-slate-500" : line.tone === "ok" ? "text-emerald-400" : line.tone === "warn" ? "text-amber-300" : "text-slate-100")}>
            {line.text}
          </div>
        ))}
      </pre>
      {job.outcome === "waiting" && (
        <p className="mt-2 text-xs text-slate-600">
          In a real run this job stays paused until someone decides. Try it: open the <Link to="/alerts" className="font-medium text-blue-600 hover:underline">approval queue</Link> and approve or reject it.
        </p>
      )}
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-slate-600">{children}</div>
      </div>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const { notify } = useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      notify(`${label} copied`, "ok");
    } catch {
      notify("Copy failed — select the text and copy it manually", "error");
    }
  };
  return (
    <div className="relative">
      <pre className="scroll-thin overflow-x-auto rounded-lg bg-slate-900 p-4 pr-24 font-mono text-[12px] leading-relaxed text-slate-100">{code}</pre>
      <Button size="sm" className="absolute right-2.5 top-2.5" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copy()}>Copy</Button>
    </div>
  );
}

export default function Integrations() {
  const { act, overview } = useApp();
  const info = usePolling(api.githubInfo, 0);
  const catalog = usePolling(api.catalog, 0);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState("coding-agent");
  const [tool, setTool] = useState("deploy_prod");
  const [resource, setResource] = useState("production/my-service");
  const [onReview, setOnReview] = useState("wait");
  const [command, setCommand] = useState("./deploy.sh");
  const [confirmToken, setConfirmToken] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://<sentinel-host>:5173";
  const local = /localhost|127\.0\.0\.1/.test(origin);
  const workflow = useMemo(
    () =>
      [
        "name: Guarded AI agent step",
        "on: [pull_request, workflow_dispatch]",
        "",
        "jobs:",
        "  guarded:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - name: Ask AgentSentinel before the agent acts",
        "        uses: your-org/agentsentinel/github-action@main",
        "        with:",
        "          sentinel-url: ${{ vars.SENTINEL_URL }}",
        "          agent-token: ${{ secrets.SENTINEL_AGENT_TOKEN }}",
        `          agent-id: ${agent}`,
        `          tool: ${tool || "<tool>"}`,
        `          resource: ${resource || "<resource>"}`,
        `          on-review: ${onReview}`,
        `          run: ${command || "echo allowed"}`,
      ].join("\n"),
    [agent, tool, resource, onReview, command],
  );

  const runDemo = async () => {
    setBusy(true);
    const result = await act(api.githubDemo);
    setBusy(false);
    if (result) setRun(result);
  };
  const issueToken = async () => {
    setConfirmToken(false);
    const result = await act(() => api.issueAgentToken(agent), "New agent token issued");
    if (result) setToken(result.token);
  };

  return (
    <>
      <PageHeader
        eyebrow="Integrations"
        title="GitHub Actions"
        subtitle="Put AgentSentinel in front of AI agents that work in your CI/CD pipeline. The step asks Sentinel first: ALLOW runs it, REVIEW waits for a human, BLOCK fails the job."
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader
          icon={<Workflow className="h-4 w-4" />}
          title="CI/CD demo — a pull-request pipeline with an AI coding agent"
          subtitle="Simulated runner, real decisions: each job submits exactly what the GitHub Action submits, through the real gateway."
          action={<Button variant="primary" icon={<Play className="h-4 w-4" />} busy={busy} onClick={() => void runDemo()}>{run ? "Run pipeline again" : "Run pipeline demo"}</Button>}
        />
        {!run ? (
          <div className="grid gap-3 p-5 md:grid-cols-3">
            {(info.data?.demo_pipeline || []).map((job, i) => (
              <div key={job.job} className="rounded-lg border border-slate-200 p-4">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><CircleDot className="h-3.5 w-3.5" /> Job {i + 1} · {job.job}</p>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">{job.name}</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-600">{callText(job.tool, job.resource)}</p>
                <p className="mt-2 font-mono text-xs text-slate-400">$ {job.run}</p>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-600">
              <span className="flex items-center gap-1.5 font-semibold text-slate-800"><GitBranch className="h-3.5 w-3.5" /> {run.repository}</span>
              <span>Guarded AI agent pipeline · run #{run.run_id.slice(0, 6)}</span>
              <span>pull_request · refs/pull/128/merge</span>
              <span className="flex items-center gap-1.5">acting as {run.agent.name} <StatusBadge status={run.agent.status} /></span>
            </div>
            <ol className="divide-y divide-slate-100">{run.jobs.map((job, i) => <JobRow key={`${run.run_id}-${job.job}`} job={job} index={i} />)}</ol>
            <div className="flex items-start gap-3 border-t border-slate-100 bg-emerald-50 px-5 py-3.5 text-sm text-emerald-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>The agent ran its tests, could not change code without a person, and could not deploy at all — and every decision is in the <Link to="/audit" className="font-semibold underline">audit trail</Link> with the repository and run attached.</p>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
        <Card>
          <CardHeader title="Add it to your repository" subtitle="Four steps." />
          <div className="space-y-5 p-5">
            <Step n={1} title="Run AgentSentinel where your runners can reach it">
              On an EC2 instance: <code className="rounded bg-slate-100 px-1 font-mono text-xs">./start.sh --public</code>. The dashboard URL is also the API URL for the action.
              {local && <span className="mt-1 block text-xs text-amber-700">You are on localhost: GitHub-hosted runners cannot reach this address. Use a public host or a self-hosted runner.</span>}
            </Step>
            <Step n={2} title="Tell the repository where Sentinel is">
              Repository variable <code className="rounded bg-slate-100 px-1 font-mono text-xs">SENTINEL_URL</code> = <code className="break-all rounded bg-slate-100 px-1 font-mono text-xs">{origin}</code>
            </Step>
            <Step n={3} title="Give the runner the agent's identity">
              Issue a token for the agent and save it as the repository secret <code className="rounded bg-slate-100 px-1 font-mono text-xs">SENTINEL_AGENT_TOKEN</code>.
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select label="Agent" value={agent} onChange={(v) => { setAgent(v); setToken(null); }} options={(overview?.agents || []).map((a) => ({ value: a.id, label: a.name }))} />
                <Button icon={<KeyRound className="h-4 w-4" />} onClick={() => setConfirmToken(true)}>Issue agent token</Button>
              </div>
              {token && (
                <div className="mt-3">
                  <CodeBlock code={token} label="Token" />
                  <p className="mt-1.5 text-xs text-amber-700">Shown once. Quarantining or killing the agent revokes it — a compromised agent's CI credential dies with it.</p>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Token enforcement is <b>{info.data?.require_agent_token ? "ON" : "OFF"}</b> on this server
                {info.data?.require_agent_token ? "." : " — set REQUIRE_AGENT_TOKEN=true in .env before exposing Sentinel to runners."}
              </p>
            </Step>
            <Step n={4} title="Wrap the agent's steps with the action">
              Use the generator on the right, or copy <code className="rounded bg-slate-100 px-1 font-mono text-xs">examples/github-workflows/agent-pipeline.yml</code>.
            </Step>
          </div>
        </Card>

        <Card>
          <CardHeader title="Workflow generator" subtitle="Describe the step; copy the YAML into .github/workflows/." />
          <div className="grid gap-3 px-5 pt-5 sm:grid-cols-2">
            <Field label="Agent"><Select label="Agent" className="w-full" value={agent} onChange={setAgent} options={(overview?.agents || []).map((a) => ({ value: a.id, label: a.name }))} /></Field>
            <Field label="Tool the step uses">
              <input className={cx(inputClass, "font-mono")} list="integration-tools" value={tool} onChange={(e) => setTool(e.target.value.trim())} />
              <datalist id="integration-tools">{(catalog.data?.tools || []).map((t) => <option key={t.name} value={t.name} />)}</datalist>
            </Field>
            <Field label="Resource"><input className={cx(inputClass, "font-mono")} value={resource} onChange={(e) => setResource(e.target.value.trim())} /></Field>
            <Field label="When Sentinel asks for human approval">
              <Select label="On review" className="w-full" value={onReview} onChange={setOnReview} options={[{ value: "wait", label: "wait — pause the job until approved" }, { value: "fail", label: "fail — stop the job" }, { value: "pass", label: "pass — continue (not recommended)" }]} />
            </Field>
            <div className="sm:col-span-2"><Field label="Command to run only if allowed"><input className={cx(inputClass, "font-mono")} value={command} onChange={(e) => setCommand(e.target.value)} /></Field></div>
          </div>
          <div className="p-5"><CodeBlock code={workflow} label="Workflow" /></div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <SectionLabel>Where this fits</SectionLabel>
        <div className="mt-2 grid gap-5 text-sm leading-relaxed text-slate-600 md:grid-cols-2">
          <p><b className="text-slate-900">Good for:</b> AI agents that act inside CI/CD — coding agents, release bots, automated fixers. The gate fails closed (if Sentinel is unreachable the step fails), records the repository, run and actor with each decision, and exposes <span className="font-mono text-xs">decision</span>, <span className="font-mono text-xs">risk-score</span> and <span className="font-mono text-xs">event-id</span> as step outputs.</p>
          <p><b className="text-slate-900">Know the limit:</b> a workflow step is a checkpoint the pipeline chooses to call. It protects the steps you wrap, not an agent that reaches tools some other way. For runtime agents, route the tools themselves through the gateway so there is no path around it.</p>
        </div>
      </Card>

      <Modal
        open={confirmToken}
        onClose={() => setConfirmToken(false)}
        title="Issue a new agent token?"
        footer={<><Button onClick={() => setConfirmToken(false)}>Cancel</Button><Button variant="primary" icon={<KeyRound className="h-4 w-4" />} onClick={() => void issueToken()}>Issue token</Button></>}
      >
        <p className="text-sm text-slate-600">This rotates the session token for <b>{overview?.agents.find((a) => a.id === agent)?.name || agent}</b>. Any runner still using the previous token will be refused until you update its secret.</p>
      </Modal>
    </>
  );
}
