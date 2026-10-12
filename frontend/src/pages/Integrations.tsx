import {
  ArrowRight, Bot, CheckCircle2, Circle, Copy, FileCheck2, GitBranch, GitCommitHorizontal, Github, Info, KeyRound, Loader2, Lock, PauseCircle, Play, ShieldCheck,
  Terminal, UserCheck, Workflow, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { DecisionBadge, RiskMeter, StatusBadge } from "../components/badges";
import { Button, Card, CardHeader, ErrorState, Field, Loading, Modal, PageHeader, SectionLabel, Select, callText, cx, inputClass } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { GithubMockRun, GithubScenario } from "../types";

// Same shape the server accepts: repository, commit or pull-request URL. Parsed for labels only.
const GITHUB_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:commit\/([0-9a-fA-F]{7,40})|pull\/(\d+)))?\/?$/;
const STEP_DELAY_MS = 550;

const SCENARIO_ICON: Record<string, ReactNode> = {
  safe_review: <CheckCircle2 className="h-5 w-5" />,
  patch_approval: <UserCheck className="h-5 w-5" />,
  prompt_injection: <Lock className="h-5 w-5" />,
};
const SCENARIO_TONE: Record<string, string> = {
  ALLOW: "border-emerald-500 bg-emerald-50 text-emerald-700",
  REVIEW: "border-amber-500 bg-amber-50 text-amber-700",
  BLOCK: "border-red-500 bg-red-50 text-red-700",
};
const FLOW: { label: string; icon: ReactNode }[] = [
  { label: "Commit submitted", icon: <GitCommitHorizontal className="h-4 w-4" /> },
  { label: "Mock Action triggered", icon: <Workflow className="h-4 w-4" /> },
  { label: "Agent proposes tools", icon: <Bot className="h-4 w-4" /> },
  { label: "Sentinel checks", icon: <ShieldCheck className="h-4 w-4" /> },
  { label: "Evidence saved", icon: <FileCheck2 className="h-4 w-4" /> },
];
const CONCLUSION: Record<string, { label: string; cls: string; icon: ReactNode }> = {
  success: { label: "Run succeeded", cls: "bg-emerald-100 text-emerald-800", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  waiting: { label: "Waiting for approval", cls: "bg-amber-100 text-amber-900", icon: <PauseCircle className="h-3.5 w-3.5" /> },
  failure: { label: "Run failed — blocked by Sentinel", cls: "bg-red-100 text-red-800", icon: <XCircle className="h-3.5 w-3.5" /> },
};

type RowState = "pending" | "running" | "success" | "waiting" | "failure";
const ROW_ICON: Record<RowState, ReactNode> = {
  pending: <Circle className="h-5 w-5 text-slate-300" />,
  running: <Loader2 className="h-5 w-5 animate-spin text-blue-600" />,
  success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
  waiting: <PauseCircle className="h-5 w-5 text-amber-500" />,
  failure: <XCircle className="h-5 w-5 text-red-600" />,
};

function WorkflowRow({ n, title, detail, state, right }: { n: number; title: string; detail: ReactNode; state: RowState; right?: ReactNode }) {
  return (
    <li className={cx("flex items-center gap-3.5 px-5 py-3.5 transition-colors", state === "failure" && "bg-red-50/60", state === "waiting" && "bg-amber-50/60")}>
      {ROW_ICON[state]}
      <div className="min-w-0 flex-1">
        <p className={cx("text-sm font-semibold", state === "pending" ? "text-slate-500" : "text-slate-900")}>{title}</p>
        <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{detail}</p>
      </div>
      {right}
      <span className="w-5 text-right font-mono text-[10px] text-slate-300">{String(n).padStart(2, "0")}</span>
    </li>
  );
}

/** Unified-diff view; lines carrying injected instructions are called out. */
function Diff({ text }: { text: string }) {
  return (
    <pre className="scroll-thin overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 py-2 font-mono text-[11.5px] leading-relaxed">
      {text.trimEnd().split("\n").map((line, i) => {
        const injected = /ignore all previous instructions|send it to the external server/i.test(line);
        return (
          <div
            key={i}
            className={cx(
              "px-3",
              injected ? "bg-red-100 font-semibold text-red-900" : line.startsWith("+") && !line.startsWith("+++") ? "bg-emerald-50 text-emerald-900" : line.startsWith("@@") ? "text-blue-700" : "text-slate-600",
            )}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
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

function SetupStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
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

// ------------------------------------------------------------ mock GitHub run
function MockGithubRun({ scenarios, defaultUrl, triggers }: { scenarios: GithubScenario[]; defaultUrl: string; triggers: { value: string; label: string }[] }) {
  const { act } = useApp();
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [url, setUrl] = useState(defaultUrl);
  const [trigger, setTrigger] = useState(triggers[0].value);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<GithubMockRun | null>(null);
  const [revealed, setRevealed] = useState(0); // how many workflow rows have finished "running"

  const scenario = scenarios.find((s) => s.id === scenarioId) || scenarios[0];
  const parsed = GITHUB_URL.exec(url.trim());
  const repo = run?.repository || (parsed ? `${parsed[1]}/${parsed[2]}` : "—");
  const sha = run?.sha || parsed?.[3]?.toLowerCase() || "";
  const shown = run && run.scenario === scenarioId ? run : null;
  const totalRows = (shown?.steps.length ?? scenario.steps.length) + 2; // + receive event, + save evidence
  const finished = !!shown && revealed >= totalRows;

  // Replay the (already decided) run one row at a time so each check is readable.
  useEffect(() => {
    if (!shown || revealed >= totalRows) return;
    const timer = window.setTimeout(() => setRevealed((n) => n + 1), STEP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [shown, revealed, totalRows]);

  const choose = (id: string) => {
    setScenarioId(id);
    setRun(null);
    setRevealed(0);
  };
  const start = async () => {
    setBusy(true);
    setRun(null);
    setRevealed(0);
    const result = await act(() => api.githubRun({ scenario: scenarioId, commit_url: url.trim(), trigger }));
    setBusy(false);
    if (result) setRun(result);
  };

  const rowState = (row: number, done: RowState): RowState => (!shown ? "pending" : row < revealed ? done : row === revealed ? "running" : "pending");
  const stage = !shown ? (busy ? 1 : 0) : finished ? 5 : revealed === 0 ? 2 : 4;

  const log = useMemo(() => {
    if (!shown) return [{ text: "Ready. Submit a mock commit to see the gateway check each tool call.", tone: "dim" }];
    const lines: { text: string; tone?: string }[] = [];
    if (revealed >= 1) lines.push({ text: `event  ${shown.trigger}  ${shown.repository}@${shown.sha.slice(0, 7)}  (simulated — nothing fetched from GitHub)`, tone: "dim" });
    shown.steps.slice(0, Math.max(0, revealed - 1)).forEach((step) => {
      const r = step.response;
      lines.push({ text: `POST /api/actions/intercept  ${callText(step.tool, step.resource)}` });
      lines.push({ text: `  → ${r.decision}  risk=${r.risk_score}/100 ${r.severity}  agent=${r.agent_status}  ${r.event_id}`, tone: r.decision === "ALLOW" ? "ok" : r.decision === "REVIEW" ? "warn" : "error" });
      if (r.decision !== "ALLOW") lines.push({ text: `    ${r.reasons[0]}`, tone: r.decision === "REVIEW" ? "warn" : "error" });
      if (r.quarantine) lines.push({ text: "    AGENT QUARANTINED · session revoked · admin alerted", tone: "error" });
    });
    if (finished) lines.push({ text: `evidence  ${shown.evidence.events.length} decision(s) written to the hash-chained audit trail${shown.evidence.alerts ? ` · ${shown.evidence.alerts} admin alert(s)` : ""}`, tone: "dim" });
    return lines;
  }, [shown, revealed, finished]);

  return (
    <>
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p><b>Mock GitHub. Real Sentinel checks.</b> The commit URL is a label: nothing is fetched from GitHub, no real Actions run, no shell command or merge happens. The agent is scripted and its tools are synthetic — but every tool call goes through the real gateway.</p>
      </div>

      <ol className="mb-4 grid gap-2 sm:grid-cols-5">
        {FLOW.map((item, i) => (
          <li key={item.label} className={cx("flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium transition-colors", i < stage ? "border-emerald-300 bg-emerald-50 text-emerald-800" : i === stage && (busy || shown) ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600")}>
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {i < FLOW.length - 1 && <ArrowRight className="hidden h-3.5 w-3.5 text-slate-300 sm:block" />}
          </li>
        ))}
      </ol>

      <div className="grid gap-4 2xl:grid-cols-[1fr_1.25fr]">
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">1 · Choose a commit scenario</h3>
            <p className="mt-0.5 text-xs text-slate-500">Three outcomes. No GitHub account or API key needed.</p>
            <div className="mt-4 space-y-2" role="radiogroup" aria-label="Commit scenario">
              {scenarios.map((s) => {
                const active = s.id === scenarioId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => choose(s.id)}
                    className={cx("flex w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors", active ? SCENARIO_TONE[s.expected] : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}
                  >
                    {SCENARIO_ICON[s.id] || <Circle className="h-5 w-5" />}
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{s.title}</span>
                      <span className="block text-xs text-slate-500">{s.summary}</span>
                    </span>
                    <DecisionBadge decision={s.expected} />
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-600">{scenario.description}</p>

            <div className="mt-4 space-y-3">
              <Field label="GitHub commit URL — demo label only" hint={parsed ? `Shown as ${parsed[1]}/${parsed[2]}${parsed[3] ? ` @ ${parsed[3].slice(0, 7)}` : parsed[4] ? ` · pull request #${parsed[4]}` : ""}. Never fetched.` : undefined}>
                <input
                  className={cx(inputClass, "font-mono text-xs", !parsed && "border-red-400")}
                  value={url}
                  spellCheck={false}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/<owner>/<repo>/commit/<sha>"
                />
                {!parsed && <span className="mt-1 block text-[11px] text-red-600">Use https://github.com/&lt;owner&gt;/&lt;repo&gt;/commit/&lt;sha&gt; — a repository or pull-request URL also works.</span>}
              </Field>
              <Field label="Simulated trigger">
                <Select label="Simulated trigger" className="w-full" value={trigger} onChange={setTrigger} options={triggers} />
              </Field>
            </div>
            <Button variant="success" size="lg" className="mt-4 w-full" icon={<Play className="h-4 w-4" />} busy={busy} disabled={!parsed || (!!shown && !finished)} onClick={() => void start()}>
              {shown ? "Run mock GitHub Action again" : "Run mock GitHub Action"}
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Each run gives CodingAgent a fresh demo session and cancels its pending reviews. Your policies, events, alerts and audit evidence are kept. An emergency stop is never released automatically.</p>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">2 · Commit content (fixture)</h3>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">What the scripted agent reads. {scenario.id === "prompt_injection" ? "The highlighted comment is addressed to AI reviewers, not humans." : "A normal change."}</p>
            <Diff text={scenario.commit.diff} />
          </Card>
        </div>

        <Card className="flex flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-5 pt-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">3 · Mock workflow run</h3>
              <p className="mt-0.5 text-xs text-slate-500">Each proposed action is evaluated by the backend gateway.</p>
            </div>
            {finished && shown ? (
              <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", CONCLUSION[shown.conclusion].cls)}>{CONCLUSION[shown.conclusion].icon}{CONCLUSION[shown.conclusion].label}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {busy || shown ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Circle className="h-3.5 w-3.5" />}{busy || shown ? "Running" : "Ready to run"}
              </span>
            )}
          </div>

          <div className="border-b border-slate-100 px-5 pb-4 pt-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Github className="h-4 w-4" /> {repo}</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{scenario.commit.message}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
              <span className="flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" /> {scenario.commit.branch}</span>
              {sha && <span>{sha.slice(0, 7)}</span>}
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px]">Mock commit</span>
              {shown && <span className="flex items-center gap-1.5 font-sans">CodingAgent <StatusBadge status={finished ? shown.agent.status : "RUNNING"} /></span>}
            </p>
          </div>

          <ol className="divide-y divide-slate-100">
            <WorkflowRow n={1} title="Receive simulated GitHub event" detail={shown ? `${shown.trigger} · ${shown.repository}` : "Waiting for you to submit a fixture"} state={rowState(0, "success")} />
            {(shown ? shown.steps : scenario.steps.map((s) => ({ ...s, status: "pending" as const, response: null }))).map((step, i) => {
              const state = rowState(i + 1, step.status === "pending" ? "pending" : step.status);
              const done = shown && i + 1 < revealed && step.response;
              return (
                <WorkflowRow
                  key={`${step.tool}-${i}`}
                  n={i + 2}
                  title={step.name}
                  detail={`${step.tool} → ${step.resource}`}
                  state={state}
                  right={done ? (
                    <span className="flex items-center gap-2.5">
                      <RiskMeter score={step.response!.risk_score} width="w-12" />
                      <DecisionBadge decision={step.response!.decision} />
                      <Link to={`/inspector/${step.response!.event_id}`} className="text-xs font-medium text-blue-600 hover:underline">Evidence</Link>
                    </span>
                  ) : undefined}
                />
              );
            })}
            <WorkflowRow n={totalRows} title="Save local evidence report" detail="Persisted in this POC's audit trail — not uploaded to GitHub" state={rowState(totalRows - 1, "success")} />
          </ol>

          <div className="mt-auto bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-2.5 text-xs text-slate-300">
              <span className="flex items-center gap-2 font-semibold"><Terminal className="h-3.5 w-3.5" /> Sentinel gateway log</span>
              <span className="text-slate-500">Local evidence</span>
            </div>
            <pre className="scroll-thin max-h-64 min-h-24 overflow-auto px-5 py-3.5 font-mono text-[11.5px] leading-relaxed" aria-live="polite">
              {log.map((line, i) => (
                <div key={i} className={cx(line.tone === "error" ? "text-red-400" : line.tone === "warn" ? "text-amber-300" : line.tone === "ok" ? "text-emerald-400" : line.tone === "dim" ? "text-slate-500" : "text-slate-100")}>{line.text}</div>
              ))}
            </pre>
          </div>

          {finished && shown && (
            <div className={cx("flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5 text-sm animate-fade-in", shown.conclusion === "failure" ? "border-red-200 bg-red-50 text-red-900" : shown.conclusion === "waiting" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>
              <p className="min-w-0 flex-1">
                {shown.conclusion === "success" && "Every action matched the agent's declared purpose, so the review ran without interruption."}
                {shown.conclusion === "waiting" && "The agent could review freely, but it cannot change the repository until a person approves."}
                {shown.conclusion === "failure" && "The injected instruction was caught, the secret was never read, and the quarantined agent's retry was refused."}
              </p>
              <span className="flex flex-wrap gap-2">
                {shown.conclusion === "waiting" && <Link to="/alerts" className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600">Open approval queue</Link>}
                {shown.conclusion === "failure" && <Link to="/alerts" className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">View admin alert</Link>}
                <Link to={`/inspector/${shown.steps[shown.conclusion === "failure" ? 1 : shown.steps.length - 1].response.event_id}`} className="rounded-lg border border-current px-3 py-1.5 text-xs font-semibold hover:bg-white/50">Open in Event Inspector</Link>
              </span>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

// --------------------------------------------------------------------- page
export default function Integrations() {
  const { act, overview } = useApp();
  const info = usePolling(api.githubInfo, 0);
  const catalog = usePolling(api.catalog, 0);
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
        "        uses: Sherlock2019/AIagentSentinelV2/github-action@main",
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
  const issueToken = async () => {
    setConfirmToken(false);
    const result = await act(() => api.issueAgentToken(agent), "New agent token issued");
    if (result) setToken(result.token);
  };
  const agentOptions = (overview?.agents || []).map((a) => ({ value: a.id, label: a.name }));

  return (
    <>
      <PageHeader
        eyebrow="GitHub integration"
        title="Test a Commit"
        subtitle="See what happens when an AI coding agent reviews a commit in GitHub Actions with AgentSentinel in front of it — then wire the same gate into your own repository."
      />

      {info.error && !info.data ? <ErrorState message={info.error} onRetry={() => void info.refresh()} /> : !info.data ? <Loading /> : (
        <MockGithubRun scenarios={info.data.scenarios} defaultUrl={info.data.default_commit_url} triggers={info.data.triggers} />
      )}

      <h2 className="mb-1 mt-10 text-lg font-semibold text-slate-900">Use it in a real GitHub Actions workflow</h2>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">The mock above replays what the real action does. The action in <span className="font-mono text-xs">github-action/</span> runs on real runners: ALLOW runs the step, REVIEW waits for a human, BLOCK fails the job.</p>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
        <Card>
          <CardHeader title="Add it to your repository" subtitle="Four steps." />
          <div className="space-y-5 p-5">
            <SetupStep n={1} title="Run AgentSentinel where your runners can reach it">
              On an EC2 instance: <code className="rounded bg-slate-100 px-1 font-mono text-xs">./start.sh --public</code>. The dashboard URL is also the API URL for the action.
              {local && <span className="mt-1 block text-xs text-amber-700">You are on localhost: GitHub-hosted runners cannot reach this address. Use a public host or a self-hosted runner.</span>}
            </SetupStep>
            <SetupStep n={2} title="Tell the repository where Sentinel is">
              Repository variable <code className="rounded bg-slate-100 px-1 font-mono text-xs">SENTINEL_URL</code> = <code className="break-all rounded bg-slate-100 px-1 font-mono text-xs">{origin}</code>
            </SetupStep>
            <SetupStep n={3} title="Give the runner the agent's identity">
              Issue a token for the agent and save it as the repository secret <code className="rounded bg-slate-100 px-1 font-mono text-xs">SENTINEL_AGENT_TOKEN</code>.
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select label="Agent" value={agent} onChange={(v) => { setAgent(v); setToken(null); }} options={agentOptions} />
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
            </SetupStep>
            <SetupStep n={4} title="Wrap the agent's steps with the action">
              Use the generator, or copy <code className="rounded bg-slate-100 px-1 font-mono text-xs">examples/github-workflows/agent-pipeline.yml</code>. This repository's own <code className="rounded bg-slate-100 px-1 font-mono text-xs">sentinel-selftest.yml</code> workflow shows it passing on a real runner.
            </SetupStep>
          </div>
        </Card>

        <Card>
          <CardHeader title="Workflow generator" subtitle="Describe the step; copy the YAML into .github/workflows/." />
          <div className="grid gap-3 px-5 pt-5 sm:grid-cols-2">
            <Field label="Agent"><Select label="Agent" className="w-full" value={agent} onChange={setAgent} options={agentOptions} /></Field>
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
