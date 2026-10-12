import {
  ArrowUpCircle, CheckCircle2, EyeOff, FileLock2, FlaskConical, KeyRound, Loader, Network, Play, Repeat, Send, ShieldCheck, Syringe, Terminal, Upload, UserCheck, XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { DecisionBadge, RiskMeter, StatusBadge } from "../components/badges";
import { DecisionBanner, PipelineSteps, WhyPanel } from "../components/EventInspectorView";
import { Button, Card, CardHeader, ErrorState, Field, Loading, PageHeader, SectionLabel, Select, callText, cx, inputClass } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { EventDetail, InterceptResponse, Scenario, ScenarioResult } from "../types";

const ICONS: Record<string, ReactNode> = {
  check: <ShieldCheck className="h-5 w-5" />,
  "user-check": <UserCheck className="h-5 w-5" />,
  terminal: <Terminal className="h-5 w-5" />,
  key: <KeyRound className="h-5 w-5" />,
  syringe: <Syringe className="h-5 w-5" />,
  "arrow-up": <ArrowUpCircle className="h-5 w-5" />,
  upload: <Upload className="h-5 w-5" />,
  repeat: <Repeat className="h-5 w-5" />,
  network: <Network className="h-5 w-5" />,
  loader: <Loader className="h-5 w-5" />,
  "file-lock": <FileLock2 className="h-5 w-5" />,
  "eye-off": <EyeOff className="h-5 w-5" />,
};
const EXPECT_TONE: Record<string, string> = { ALLOW: "bg-emerald-50 text-emerald-600", REVIEW: "bg-amber-50 text-amber-600", BLOCK: "bg-red-50 text-red-600" };

interface StepView { index: number; note: string; response: InterceptResponse }

/** Long runs (the runaway loop) collapse to head … tail so the interesting steps stay visible. */
function condense(steps: StepView[]): (StepView | { skipped: number })[] {
  if (steps.length <= 6) return steps;
  return [...steps.slice(0, 2), { skipped: steps.length - 5 }, ...steps.slice(-3)];
}

function ResultPanel({ title, subtitle, steps, verdict }: { title: string; subtitle: string; steps: StepView[]; verdict?: ReactNode }) {
  const { isEngineer } = useApp();
  const [selected, setSelected] = useState(steps.length - 1);
  const event: EventDetail = steps[Math.min(selected, steps.length - 1)].response.event;
  return (
    <div className="space-y-4 animate-slide-up">
      <Card>
        <CardHeader title={title} subtitle={subtitle} action={verdict} />
        <ol className="divide-y divide-slate-100">
          {condense(steps).map((step, i) =>
            "skipped" in step ? (
              <li key={`skip-${i}`} className="px-5 py-2 text-center text-xs text-slate-400">… {step.skipped} more identical calls, all allowed while risk climbs …</li>
            ) : (
              <li key={step.index}>
                <button
                  type="button"
                  onClick={() => setSelected(step.index - 1)}
                  className={cx("flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50", selected === step.index - 1 && "bg-blue-50 hover:bg-blue-50")}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{step.index}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm text-slate-900">{callText(step.response.event.tool, step.response.event.resource)}</span>
                    {step.note && <span className="block text-xs text-slate-500">{step.note}</span>}
                  </span>
                  <RiskMeter score={step.response.risk_score} />
                  <DecisionBadge decision={step.response.decision} />
                  {step.response.quarantine && <StatusBadge status="QUARANTINED" />}
                  {step.response.agent_status === "PAUSED" && <StatusBadge status="PAUSED" />}
                </button>
              </li>
            ),
          )}
        </ol>
      </Card>

      <DecisionBanner event={event} />
      <Card className="px-4 py-3.5">
        <SectionLabel>Detection steps — step {Math.min(selected, steps.length - 1) + 1}</SectionLabel>
        <div className="mt-2.5"><PipelineSteps key={event.id} event={event} animate /></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <ul className="flex flex-wrap gap-1.5">
            {event.response_actions.map((action) => <li key={action} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700">{action}</li>)}
          </ul>
          <Link to={`/inspector/${event.id}`} className="text-xs font-medium text-blue-600 hover:underline">{isEngineer ? "Open full evaluation in Event Inspector →" : "See the full story →"}</Link>
        </div>
      </Card>
      <WhyPanel event={event} />
    </div>
  );
}

function CustomConsole({ onResult }: { onResult: (r: InterceptResponse) => void }) {
  const { overview, act } = useApp();
  const catalog = usePolling(api.catalog, 0);
  const [agent, setAgent] = useState("coding-agent");
  const [task, setTask] = useState("Review this application source code.");
  const [tool, setTool] = useState("deploy_prod");
  const [resource, setResource] = useState("production/storefront");
  const [args, setArgs] = useState("{}");
  const [busy, setBusy] = useState(false);
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(args || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const send = async () => {
    if (!parsed) return;
    setBusy(true);
    const result = await act(() => api.intercept({ agent_id: agent, task, tool: tool.trim(), resource: resource.trim(), arguments: parsed! }));
    setBusy(false);
    if (result) onResult(result);
  };
  return (
    <Card>
      <CardHeader icon={<Send className="h-4 w-4" />} title="Custom action console" subtitle="Send any action to POST /api/actions/intercept. The agent's current state applies (a quarantined agent stays blocked)." />
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Agent"><Select label="Agent" className="w-full" value={agent} onChange={setAgent} options={(overview?.agents || []).map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="Tool">
          <input className={cx(inputClass, "font-mono")} list="tool-catalog" value={tool} onChange={(e) => setTool(e.target.value)} />
          <datalist id="tool-catalog">{(catalog.data?.tools || []).map((t) => <option key={t.name} value={t.name} />)}</datalist>
        </Field>
        <Field label="Resource"><input className={cx(inputClass, "font-mono")} value={resource} onChange={(e) => setResource(e.target.value)} /></Field>
        <Field label="User task"><input className={inputClass} value={task} onChange={(e) => setTask(e.target.value)} /></Field>
        <Field label="Arguments (JSON object)" hint={parsed ? undefined : "Not a valid JSON object"}>
          <input className={cx(inputClass, "font-mono", !parsed && "border-red-400")} value={args} onChange={(e) => setArgs(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end border-t border-slate-100 px-5 py-3">
        <Button variant="primary" icon={<Send className="h-4 w-4" />} busy={busy} disabled={!parsed || !tool.trim()} onClick={() => void send()}>Submit to gateway</Button>
      </div>
    </Card>
  );
}

export default function RedTeamLab() {
  const { act, isEngineer, overview } = useApp();
  const scenarios = usePolling(api.scenarios, 0);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [custom, setCustom] = useState<InterceptResponse | null>(null);

  const run = async (scenario: Scenario) => {
    setRunning(scenario.id);
    const outcome = await act(() => api.runScenario(scenario.id));
    setRunning(null);
    if (outcome) {
      setCustom(null);
      setResult(outcome);
      window.setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  };

  if (scenarios.error && !scenarios.data) return <ErrorState message={scenarios.error} onRetry={() => void scenarios.refresh()} />;
  if (!scenarios.data) return <Loading />;
  const agentName = (id: string) => overview?.agents.find((a) => a.id === id)?.name || id;

  return (
    <>
      <PageHeader title="Red Team Lab" subtitle="Launch attacks against the agents and watch Sentinel respond. Each one runs through the real decision pipeline." />
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
        <p><b>Simulated only.</b> Tools, secrets, databases and destinations are synthetic — nothing real is touched. Each run starts the target agent in a fresh session so results are reproducible.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {scenarios.data.filter((s) => s.in_lab).map((scenario) => (
          <Card key={scenario.id} className={cx("flex flex-col p-4 transition-shadow hover:shadow-md", result?.scenario.id === scenario.id && "ring-2 ring-blue-400")}>
            <div className="flex items-start gap-3">
              <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", EXPECT_TONE[scenario.expected_decision])}>{ICONS[scenario.icon] || ICONS.check}</span>
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-wide text-slate-900">{scenario.label}</p>
                <p className="text-xs text-slate-500">{agentName(scenario.agent_id)}</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-600">{scenario.description}</p>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-[11px] text-slate-500">Expected: <b className="text-slate-700">{scenario.expected_summary}</b></span>
              <Button size="sm" variant="primary" icon={<Play className="h-3.5 w-3.5" />} busy={running === scenario.id} disabled={running !== null} onClick={() => void run(scenario)}>Run</Button>
            </div>
          </Card>
        ))}
      </div>

      <div id="result" className="mt-6 scroll-mt-4">
        {result && (
          <ResultPanel
            key={result.final_event_id}
            title={`${result.scenario.label} — ${result.agent.name}`}
            subtitle={`Threat: ${result.scenario.threat} · ${result.steps.length} action(s) submitted · agent is now ${result.agent_status}`}
            steps={result.steps}
            verdict={
              <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", result.passed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800")}>
                {result.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {result.passed ? "Matches expected outcome" : "Unexpected outcome"}: {result.scenario.expected_summary}
              </span>
            }
          />
        )}
      </div>

      {isEngineer && (
        <div className="mt-6 space-y-4">
          <CustomConsole onResult={(r) => { setResult(null); setCustom(r); }} />
          {custom && <ResultPanel key={custom.event_id} title="Custom action result" subtitle={`Agent is now ${custom.agent_status}`} steps={[{ index: 1, note: "", response: custom }]} />}
        </div>
      )}
    </>
  );
}
