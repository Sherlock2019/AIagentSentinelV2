import { ArrowRight, CheckCircle2, Lock, PlayCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useApp } from "../hooks/useApp";
import type { ScenarioResult } from "../types";
import { DecisionBadge, RiskMeter } from "./badges";
import { Button, Modal, callText, cx } from "./ui";

interface Results { safe?: ScenarioResult; review?: ScenarioResult; block?: ScenarioResult; kept?: boolean }
interface DemoStep {
  title: string;
  /** Runs when the step is entered: may call the API and navigate. */
  enter: (results: Results) => Promise<void>;
  body: (results: Results) => ReactNode;
  cta?: string;
}

interface DemoApi { start: () => void; active: boolean }
const DemoContext = createContext<DemoApi>({ start: () => undefined, active: false });
export const useDemo = () => useContext(DemoContext);

function Outcome({ result }: { result?: ScenarioResult }) {
  if (!result) return null;
  const last = result.steps[result.steps.length - 1];
  const req = last.request as { tool: string; resource: string };
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{result.agent.name}</p>
      <p className="mt-0.5 break-all font-mono text-sm text-slate-900">{callText(req.tool, req.resource)}</p>
      <div className="mt-2 flex items-center gap-3">
        <DecisionBadge decision={last.response.decision} large />
        <RiskMeter score={last.response.risk_score} width="w-24" />
      </div>
    </div>
  );
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { notify, refreshOverview } = useApp();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<Results>({});
  const ref = useRef<Results>({});

  const steps = useMemo<DemoStep[]>(() => {
    const save = (patch: Results) => {
      ref.current = { ...ref.current, ...patch };
      setResults(ref.current);
    };
    const blockedEvent = () => ref.current.block?.final_event_id;
    return [
      {
        title: "A healthy fleet of agents",
        enter: async () => {
          await api.resetDemo();
          navigate("/");
        },
        body: () => <>Four AI agents are registered. Each has a <b>declared purpose</b> and a policy listing exactly which tools it may use. Everything is green. Every tool call they make will pass through AgentSentinel first.</>,
      },
      {
        title: "A normal action is allowed",
        enter: async () => {
          save({ safe: await api.runScenario("safe_action") });
          navigate("/monitor");
        },
        body: (r) => <>CustomerSupportAgent searches the knowledge base. It matches its purpose and its policy, so Sentinel lets it through in milliseconds.<Outcome result={r.safe} /></>,
      },
      {
        title: "A sensitive action needs a human",
        enter: async () => {
          save({ review: await api.runScenario("payment_request") });
          navigate("/");
        },
        body: (r) => <>FinanceAgent wants to create a payment request. That is legitimate but moves money, so Sentinel <b>holds it</b> — nothing runs until an administrator approves it in the approval queue.<Outcome result={r.review} /></>,
      },
      {
        title: "An agent goes off-script",
        enter: async () => {
          save({ block: await api.runScenario("secret_access") });
          navigate("/monitor");
        },
        body: (r) => <>Asked to <i>“review this application source code”</i>, CodingAgent instead tries to read a production AWS credential. Sentinel stops the call <b>before it reaches anything</b>.<Outcome result={r.block} /></>,
      },
      {
        title: "Risk score reaches CRITICAL",
        enter: async () => navigate("/"),
        body: (r) => {
          const event = r.block?.steps[0].response.event;
          return (
            <>
              Four independent signals agree. The fleet health score drops and the agent's row turns red.
              {event?.risk_breakdown && (
                <ul className="mt-3 space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                  <li className="flex justify-between"><span>Policy risk</span><b>{event.risk_breakdown.components.policy}</b></li>
                  <li className="flex justify-between"><span>LLM safety risk</span><b>{event.risk_breakdown.components.llm}</b></li>
                  <li className="flex justify-between"><span>Behaviour anomaly</span><b>{event.risk_breakdown.components.behavior}</b></li>
                  <li className="flex justify-between"><span>Resource sensitivity</span><b>{event.risk_breakdown.components.resource_sensitivity}</b></li>
                  <li className="flex justify-between border-t border-red-200 pt-1.5 text-red-800"><b>FINAL RISK</b><b>{event.risk_score} / 100 — {event.severity}</b></li>
                </ul>
              )}
            </>
          );
        },
      },
      {
        title: "Agent automatically quarantined",
        enter: async () => navigate("/agents"),
        body: () => (
          <>
            Secret access is a deterministic trigger: no human had to react.
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-bold tracking-wide text-white"><Lock className="h-4 w-4" /> AGENT QUARANTINED</div>
            <p className="mt-2">Its session is revoked, pending actions are cancelled and every future call is refused.</p>
          </>
        ),
      },
      {
        title: "Admin alert generated",
        enter: async () => navigate("/alerts"),
        body: () => <>A CRITICAL alert reaches the administrator on the dashboard, plus simulated email, Slack and webhook channels — with the reasons and Sentinel's response attached.</>,
      },
      {
        title: "Open the Event Inspector",
        enter: async () => navigate(`/inspector/${blockedEvent() ?? ""}`),
        body: () => <>One screen shows the whole decision: the <b>context</b>, the <b>attempted action</b>, and what each engine found — policy checks, LLM safety scores, behaviour anomaly and the final risk.</>,
      },
      {
        title: "Why was this blocked?",
        enter: async () => {
          navigate(`/inspector/${blockedEvent() ?? ""}`);
          window.setTimeout(() => document.getElementById("why")?.scrollIntoView({ behavior: "smooth", block: "center" }), 500);
        },
        body: (r) => (
          <ol className="list-decimal space-y-1.5 pl-5">
            {(r.block?.steps[0].response.event.explanation.steps || []).map((step) => <li key={step}>{step}</li>)}
          </ol>
        ),
      },
      {
        title: "The hidden path: capability map",
        enter: async () => navigate("/capabilities?agent=customer-support-agent"),
        body: () => <>Policies list tools, not what tools can <i>reach</i>. CustomerSupportAgent is read-only on customer data, yet <span className="font-mono text-xs">workflow_api → admin_endpoint → CustomerDB WRITE</span> exists. Sentinel finds this unintended path and blocks calls that use it.</>,
      },
      {
        title: "The human decides",
        cta: "KEEP QUARANTINED",
        enter: async () => navigate("/alerts"),
        body: () => <>Sentinel contained the agent; a person makes the final call. The administrator reviews the evidence and chooses to keep CodingAgent quarantined.</>,
      },
    ];
  }, [navigate]);

  const goTo = useCallback(
    async (next: number) => {
      setBusy(true);
      try {
        await steps[next].enter(ref.current);
        setIndex(next);
        void refreshOverview();
      } catch (err) {
        notify(err instanceof Error ? err.message : "Demo step failed", "error");
      } finally {
        setBusy(false);
      }
    },
    [steps, notify, refreshOverview],
  );

  const start = useCallback(() => {
    ref.current = {};
    setResults({});
    setDone(false);
    setActive(true);
    setIndex(0);
    void goTo(0);
  }, [goTo]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const alertId = ref.current.block?.steps[0].response.alert_id;
      if (alertId) await api.alertAction(alertId, "keep-quarantined");
      ref.current = { ...ref.current, kept: true };
      setResults(ref.current);
      void refreshOverview();
      setDone(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Demo step failed", "error");
    } finally {
      setBusy(false);
    }
  }, [notify, refreshOverview]);

  const close = () => {
    setActive(false);
    setDone(false);
  };

  const step = steps[index];
  const last = index === steps.length - 1;
  const runs = [results.safe, results.review, results.block].filter(Boolean) as ScenarioResult[];
  const count = (decision: "ALLOW" | "REVIEW" | "BLOCK") => runs.reduce((n, r) => n + r.counts[decision], 0);
  const summary = [
    { label: "actions", value: runs.reduce((n, r) => n + r.steps.length, 0) },
    { label: "allowed", value: count("ALLOW") },
    { label: "reviewed", value: count("REVIEW") },
    { label: "blocked", value: count("BLOCK") },
    { label: "agent quarantined", value: runs.filter((r) => r.quarantined).length },
    { label: "admin alert", value: runs.reduce((n, r) => n + r.alerts, 0) },
  ];

  return (
    <DemoContext.Provider value={{ start, active }}>
      {children}
      {active && !done && (
        <aside className="fixed bottom-5 right-5 z-40 w-[26rem] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-slide-up" aria-live="polite">
          <header className="flex items-center justify-between bg-slate-900 px-4 py-2.5 text-white">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]"><PlayCircle className="h-4 w-4 text-blue-400" /> Guided demo · step {index + 1} of {steps.length}</span>
            <button type="button" onClick={close} aria-label="Exit demo" className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
          </header>
          <div className="h-1 bg-slate-200"><div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
          <div className="scroll-thin max-h-[52vh] overflow-y-auto px-4 py-4">
            <h3 className="text-base font-semibold text-slate-900">{step.title}</h3>
            <div className={cx("mt-2 text-sm leading-relaxed text-slate-600", busy && "opacity-50")}>{step.body(results)}</div>
          </div>
          <footer className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
            <button type="button" onClick={close} className="text-xs font-medium text-slate-500 hover:text-slate-700">Exit demo</button>
            {last ? (
              <Button variant="danger" busy={busy} icon={<Lock className="h-4 w-4" />} onClick={() => void finish()}>{step.cta}</Button>
            ) : (
              <Button variant="primary" busy={busy} onClick={() => void goTo(index + 1)}>Next <ArrowRight className="h-4 w-4" /></Button>
            )}
          </footer>
        </aside>
      )}
      <Modal
        open={active && done}
        onClose={close}
        title="DEMO COMPLETE"
        footer={<><Button onClick={() => { close(); navigate("/redteam"); }}>Try the Red Team Lab</Button><Button variant="primary" onClick={close}>Done</Button></>}
      >
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800">
          <CheckCircle2 className="h-6 w-6 shrink-0" />
          <p className="text-sm font-medium">Every action was checked before it reached the real world — and a human made the final call.</p>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3">
          {summary.map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 px-3 py-3 text-center">
              <dd className="text-3xl font-semibold text-slate-900">{item.value}</dd>
              <dt className="mt-0.5 text-xs text-slate-500">{item.label}</dt>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">AI agents should not police themselves.</p>
      </Modal>
    </DemoContext.Provider>
  );
}
