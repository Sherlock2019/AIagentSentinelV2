import {
  Activity, AlertTriangle, Ban, Bell, Bot, Brain, CheckCircle2, ChevronRight, FileText, Lock, Network, ScrollText, Shield, Target, UserCheck, XCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../hooks/useApp";
import type { EventDetail } from "../types";
import { DecisionBadge, RiskMeter, SeverityBadge, riskTone } from "./badges";
import { Card, JsonBlock, SectionLabel, callText, cx, formatDateTime } from "./ui";

const DECISION_STYLE: Record<string, { bg: string; label: string; icon: ReactNode }> = {
  ALLOW: { bg: "bg-emerald-600", label: "ALLOWED", icon: <CheckCircle2 className="h-7 w-7" /> },
  REVIEW: { bg: "bg-amber-500", label: "HUMAN APPROVAL REQUIRED", icon: <UserCheck className="h-7 w-7" /> },
  BLOCK: { bg: "bg-red-600", label: "BLOCKED", icon: <Ban className="h-7 w-7" /> },
  INFO: { bg: "bg-slate-600", label: "SYSTEM EVENT", icon: <Shield className="h-7 w-7" /> },
};

const COMPONENT_LABELS: Record<string, string> = {
  policy: "Policy risk",
  llm: "LLM safety risk",
  behavior: "Behaviour risk",
  resource_sensitivity: "Resource sensitivity",
  irreversibility: "Irreversibility",
};

// ------------------------------------------------------------- pipeline strip
type StageTone = "ok" | "warn" | "bad" | "idle";
interface Stage { key: string; title: string; icon: ReactNode; tone: StageTone; finding: string }

function buildStages(event: EventDetail): Stage[] {
  const p = event.policy_result;
  const stages: Stage[] = [{ key: "gateway", title: "Gateway", icon: <Shield className="h-4 w-4" />, tone: "ok", finding: "Intercepted before execution" }];
  if (!p) {
    stages.push({ key: "state", title: "Agent state", icon: <Lock className="h-4 w-4" />, tone: "bad", finding: event.reasons[0] || "Agent is contained" });
  } else {
    const c = event.capability_result;
    const b = event.behavior_result;
    const l = event.llm_result;
    const r = event.risk_breakdown;
    stages.push({
      key: "policy", title: "Policy", icon: <ScrollText className="h-4 w-4" />,
      tone: p.verdict === "DENY" ? "bad" : p.verdict === "REQUIRE_APPROVAL" ? "warn" : "ok",
      finding: p.verdict === "DENY" ? p.violations[0] || "Denied" : p.verdict === "REQUIRE_APPROVAL" ? "Human approval required" : "Tool and resource permitted",
    });
    if (c) stages.push({
      key: "capability", title: "Capability", icon: <Network className="h-4 w-4" />,
      tone: c.verdict === "BLOCK" ? "bad" : c.verdict === "REVIEW" ? "warn" : "ok",
      finding: c.transitive ? `Reaches ${c.paths[0]?.resource} ${c.paths[0]?.access} indirectly` : "No forbidden downstream path",
    });
    if (b) stages.push({
      key: "behavior", title: "Behaviour", icon: <Activity className="h-4 w-4" />,
      tone: b.score >= 55 ? "bad" : b.score >= 30 ? "warn" : "ok",
      finding: `Anomaly ${b.score}/100${b.signals[0] ? ` — ${b.signals[0].name.toLowerCase()}` : ""}`,
    });
    if (l) stages.push({
      key: "llm", title: "LLM Judge", icon: <Brain className="h-4 w-4" />,
      tone: l.recommended_decision === "BLOCK" ? "bad" : l.recommended_decision === "REVIEW" ? "warn" : "ok",
      finding: `Recommends ${l.recommended_decision}${l.injection_indicators.length ? " — injection detected" : ""}`,
    });
    if (r) stages.push({
      key: "risk", title: "Risk", icon: <Target className="h-4 w-4" />,
      tone: r.score >= 80 ? "bad" : r.score >= 30 ? "warn" : "ok",
      finding: `${r.score}/100 ${r.severity}`,
    });
  }
  stages.push({
    key: "decision", title: "Decision", icon: <CheckCircle2 className="h-4 w-4" />,
    tone: event.decision === "BLOCK" ? "bad" : event.decision === "REVIEW" ? "warn" : "ok",
    finding: event.decision,
  });
  const contained = event.response_actions.filter((a) => /QUARANTINED|PAUSED|ALERT/.test(a));
  stages.push({
    key: "response", title: "Response", icon: <Bell className="h-4 w-4" />,
    tone: event.decision === "BLOCK" ? "bad" : event.decision === "REVIEW" ? "warn" : "ok",
    finding: contained.length ? contained.join(" · ").toLowerCase() : event.response_actions[1]?.toLowerCase() || "logged",
  });
  return stages;
}

const STAGE_TONE: Record<StageTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  bad: "border-red-200 bg-red-50 text-red-800",
  idle: "border-slate-200 bg-slate-50 text-slate-400",
};

/** Each detection step, in pipeline order. `animate` reveals them one at a time. */
export function PipelineSteps({ event, animate = false }: { event: EventDetail; animate?: boolean }) {
  const stages = buildStages(event);
  const [shown, setShown] = useState(animate ? 0 : stages.length);
  useEffect(() => {
    if (!animate) {
      setShown(stages.length);
      return;
    }
    setShown(0);
    const timer = window.setInterval(() => setShown((n) => (n >= stages.length ? n : n + 1)), 260);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, animate]);

  return (
    <ol className="flex flex-wrap items-stretch gap-y-2">
      {stages.map((stage, i) => {
        const visible = i < shown;
        return (
          <li key={stage.key} className="flex items-stretch">
            <div className={cx("w-[9.25rem] rounded-lg border px-2.5 py-2 transition-all duration-300", visible ? STAGE_TONE[stage.tone] : STAGE_TONE.idle)}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                {stage.icon}
                <span className="truncate">{stage.title}</span>
              </div>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4">{visible ? stage.finding : "…"}</p>
            </div>
            {i < stages.length - 1 && <ChevronRight className="mx-0.5 h-4 w-4 shrink-0 self-center text-slate-300" />}
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------------- pieces
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-sm text-slate-800">{children}</span>
    </div>
  );
}

function CheckRow({ name, status, detail }: { name: string; status: string; detail: string }) {
  const tone = status === "PASS" ? "text-emerald-700 bg-emerald-50" : status === "FAIL" ? "text-red-700 bg-red-50" : "text-amber-800 bg-amber-50";
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-700">{name}</span>
        <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold", tone)}>
          {status === "PASS" ? <CheckCircle2 className="h-3 w-3" /> : status === "FAIL" ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {status}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

/** A 1-5 judge score. `positive` scales (alignment, necessity) are good when high. */
function ScoreRow({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  const risk = positive ? 6 - value : value;
  const tone = risk >= 4 ? "bg-red-500" : risk === 3 ? "bg-amber-500" : "bg-emerald-500";
  const flag = risk >= 4 ? (positive ? "LOW" : "RISK") : "";
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-sm text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        <span className="flex gap-0.5" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => <span key={n} className={cx("h-2 w-3 rounded-sm", n <= value ? tone : "bg-slate-200")} />)}
        </span>
        <span className="w-16 text-right text-xs font-semibold tabular-nums text-slate-700">
          {value}/5 {flag && <span className="text-red-600">{flag}</span>}
        </span>
      </span>
    </div>
  );
}

function Column({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex flex-col">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className="text-slate-400">{icon}</span>
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">{title}</h3>
      </header>
      <div className="flex-1 space-y-4 px-4 py-4">{children}</div>
    </Card>
  );
}

function highlightInjection(text: string): ReactNode {
  const parts = text.split(/(ignore all previous instructions[^.]*\.|read the production secret[^.>]*)/i);
  return parts.map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-red-200 px-0.5 text-red-900">{part}</mark> : part));
}

export function DecisionBanner({ event }: { event: EventDetail }) {
  const style = DECISION_STYLE[event.decision] || DECISION_STYLE.INFO;
  const quarantined = event.response_actions.includes("AGENT QUARANTINED");
  return (
    <div className={cx("rounded-xl px-5 py-4 text-white shadow-sm", style.bg)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {style.icon}
          <div>
            <div className="text-xl font-bold tracking-wide">{style.label}</div>
            <div className="font-mono text-sm opacity-90">{event.tool ? callText(event.tool, event.resource) : event.message}</div>
          </div>
        </div>
        {quarantined && (
          <div className="flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold tracking-wide ring-1 ring-white/40">
            <Lock className="h-4 w-4" /> AGENT QUARANTINED
          </div>
        )}
      </div>
    </div>
  );
}

export function WhyPanel({ event }: { event: EventDetail }) {
  const { steps = [], result = [], headline } = event.explanation || {};
  if (!steps.length) return null;
  return (
    <Card id="why" className="scroll-mt-24">
      <header className="border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-sm font-bold uppercase tracking-[0.1em] text-slate-800">{headline || "Why Sentinel made this decision"}</h3>
      </header>
      <div className="grid gap-6 px-5 py-4 lg:grid-cols-[1.6fr_1fr]">
        <ol className="space-y-2.5">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{i + 1}</span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <SectionLabel>Result</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {result.map((line) => (
              <li key={line} className="flex gap-2 text-sm font-medium text-slate-800">
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ recruiter view
function Story({ n, title, children, tone }: { n: number; title: string; children: ReactNode; tone: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white", tone)}>{n}</span>
        <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{title}</h3>
      </div>
      <div className="mt-3 text-[15px] leading-relaxed text-slate-800">{children}</div>
    </Card>
  );
}

function RecruiterView({ event }: { event: EventDetail }) {
  const plain = event.explanation?.plain;
  const tone = riskTone(event.risk_score);
  return (
    <div className="space-y-4">
      <DecisionBanner event={event} />
      <div className="grid gap-4 md:grid-cols-2">
        <Story n={1} title="What the agent is supposed to do" tone="bg-blue-600">
          <span className="font-semibold">{event.agent_name}</span> — {plain?.supposed_to || event.agent_purpose}
        </Story>
        <Story n={2} title="What it tried to do" tone="bg-slate-700">{plain?.wanted || event.message}</Story>
        <Story n={3} title={event.decision === "ALLOW" ? "Why Sentinel considered it safe" : "Why Sentinel considered it unsafe"} tone={event.decision === "ALLOW" ? "bg-emerald-600" : "bg-red-600"}>
          {plain?.why || event.reasons[0]}
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            Danger level: <span className={cx("font-bold", tone.text)}>{tone.label}</span> <RiskMeter score={event.risk_score} width="w-24" />
          </div>
        </Story>
        <Story n={4} title="What Sentinel did" tone="bg-slate-900">
          {plain?.what_sentinel_did || event.response_actions.join(", ")}
          <p className="mt-3 text-sm"><span className="font-semibold text-slate-900">Was the agent shut down?</span> {plain?.shut_down || event.agent_status_after}</p>
        </Story>
      </div>
      <WhyPanel event={event} />
    </div>
  );
}

// ------------------------------------------------------------- engineer view
export function EventInspectorView({ event }: { event: EventDetail }) {
  const { isEngineer } = useApp();
  if (event.kind === "SYSTEM") {
    // Sentinel's own responses (quarantine, approvals, policy edits) have no pipeline to show.
    return (
      <div className="space-y-4">
        <DecisionBanner event={event} />
        <Card className="space-y-3 px-5 py-4">
          <SectionLabel>Sentinel system event</SectionLabel>
          <p className="text-sm text-slate-800">{event.message}</p>
          <p className="text-xs text-slate-500">{event.agent_name} · {formatDateTime(event.timestamp)} · agent state after: <b>{event.agent_status_after || "—"}</b></p>
          <ul className="flex flex-wrap gap-2">
            {event.response_actions.map((action) => <li key={action} className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold tracking-wide text-slate-700">{action}</li>)}
          </ul>
          {isEngineer && <JsonBlock value={event} maxHeight="16rem" />}
        </Card>
      </div>
    );
  }
  if (!isEngineer) return <RecruiterView event={event} />;

  const p = event.policy_result;
  const l = event.llm_result;
  const b = event.behavior_result;
  const c = event.capability_result;
  const r = event.risk_breakdown;
  const retrieved = typeof event.context?.retrieved_content === "string" ? (event.context.retrieved_content as string) : null;

  return (
    <div className="space-y-4">
      <DecisionBanner event={event} />
      <Card className="px-4 py-3.5">
        <PipelineSteps event={event} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Column title="Context" icon={<Bot className="h-4 w-4" />}>
          <div>
            <SectionLabel>Agent</SectionLabel>
            <p className="mt-1 text-base font-semibold text-slate-900">{event.agent_name}</p>
            <p className="font-mono text-xs text-slate-400">{event.agent_id}</p>
          </div>
          <div>
            <SectionLabel>Declared purpose</SectionLabel>
            <p className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{event.agent_purpose || "—"}</p>
          </div>
          <div>
            <SectionLabel>User request</SectionLabel>
            <p className="mt-1 text-sm italic text-slate-700">“{event.task || "—"}”</p>
          </div>
          <div>
            <SectionLabel>Recent actions</SectionLabel>
            {event.recent_actions.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">No earlier activity.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {event.recent_actions.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 font-mono text-xs text-slate-600">
                    <span className="truncate">{a.tool}()</span>
                    <DecisionBadge decision={a.decision} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-slate-100 pt-3">
            <SectionLabel>Request</SectionLabel>
            <Row label="Event ID"><span className="font-mono text-xs">{event.id}</span></Row>
            <Row label="Action ID"><span className="font-mono text-xs">{event.action_id || "—"}</span></Row>
            <Row label="Time"><span className="text-xs">{formatDateTime(event.timestamp)}</span></Row>
            {Object.entries(event.timings || {}).map(([key, ms]) => (
              <Row key={key} label={key.replace("_ms", "")}><span className="font-mono text-xs">{ms} ms</span></Row>
            ))}
          </div>
        </Column>

        <Column title="Attempted action" icon={<FileText className="h-4 w-4" />}>
          <div className={cx("rounded-lg border px-3 py-3", event.decision === "BLOCK" ? "border-red-200 bg-red-50" : event.decision === "REVIEW" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50")}>
            <SectionLabel>Tool</SectionLabel>
            <p className="mt-0.5 break-all font-mono text-lg font-semibold text-slate-900">{event.tool || "—"}</p>
          </div>
          <div>
            <Row label="Resource"><span className="break-all font-mono text-xs">{event.resource || "—"}</span></Row>
            <Row label="Resource class"><span className="font-mono text-xs">{event.resource_class || "—"}</span></Row>
            <Row label="Operation"><span className="font-mono text-xs">{event.operation || "—"}</span></Row>
            {p && <Row label="Tool category"><span className="font-mono text-xs">{p.tool_category}</span></Row>}
            {p && <Row label="Sensitivity"><RiskMeter score={p.resource_sensitivity} /></Row>}
          </div>
          <div>
            <SectionLabel>Arguments</SectionLabel>
            <div className="mt-1.5"><JsonBlock value={event.arguments} maxHeight="10rem" /></div>
          </div>
          {retrieved && (
            <div>
              <SectionLabel>Untrusted content in context</SectionLabel>
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-600">{highlightInjection(retrieved)}</p>
            </div>
          )}
          {c?.transitive && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <SectionLabel>Transitive capability path</SectionLabel>
              <p className="mt-1 font-mono text-xs font-semibold text-red-800">{c.paths[0]?.label}</p>
            </div>
          )}
          <div className="rounded-lg border border-slate-200 p-3">
            <SectionLabel>Intended vs actual</SectionLabel>
            <p className="mt-1.5 text-xs text-slate-500">Declared</p>
            <p className="text-sm text-emerald-800">{event.agent_purpose}</p>
            <p className="mt-2 text-xs text-slate-500">Attempted</p>
            <p className={cx("font-mono text-sm", event.decision === "ALLOW" ? "text-emerald-800" : "text-red-700")}>{callText(event.tool, event.resource)}</p>
          </div>
        </Column>

        <Column title="Sentinel decision" icon={<Shield className="h-4 w-4" />}>
          {!p && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {event.reasons[0] || event.message}
              <p className="mt-1 text-xs text-red-600">Refused at the gateway — a contained agent never reaches the evaluation pipeline.</p>
            </div>
          )}
          {p && (
            <div>
              <div className="flex items-center justify-between">
                <SectionLabel>Policy engine</SectionLabel>
                <span className={cx("font-mono text-xs font-bold", p.verdict === "DENY" ? "text-red-700" : p.verdict === "ALLOW" ? "text-emerald-700" : "text-amber-700")}>{p.verdict}</span>
              </div>
              <div className="mt-1 divide-y divide-slate-100">
                {p.checks.map((check) => <CheckRow key={check.name} {...check} />)}
              </div>
              {p.critical_triggers.length > 0 && (
                <p className="mt-1.5 rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white">CRITICAL TRIGGER: {p.critical_triggers.join(", ")}</p>
              )}
            </div>
          )}
          {l && (
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between">
                <SectionLabel>LLM safety judge</SectionLabel>
                <span className="font-mono text-[11px] text-slate-400">{l.provider} · advisory</span>
              </div>
              <div className="mt-1">
                <ScoreRow label="Intent alignment" value={l.intent_alignment} positive />
                <ScoreRow label="Authorization" value={l.authorization_risk} />
                <ScoreRow label="Data exposure" value={l.data_risk} />
                <ScoreRow label="Injection" value={l.injection_risk} />
                <ScoreRow label="Privilege" value={l.privilege_risk} />
                <ScoreRow label="Necessity" value={l.necessity} positive />
                <ScoreRow label="Irreversibility" value={l.reversibility_risk} />
              </div>
              <p className="mt-1.5 text-xs italic text-slate-600">“{l.summary}”</p>
              <p className="mt-1 text-xs text-slate-500">Recommends <span className="font-semibold">{l.recommended_decision}</span> · semantic risk {l.risk}/100</p>
              {!l.available && <p className="mt-1.5 rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">Evaluator degraded — failing safe. {l.degraded_reason}</p>}
              {l.injection_indicators.map((indicator) => (
                <p key={indicator} className="mt-1.5 rounded bg-red-100 px-2 py-1 text-[11px] font-medium text-red-800">Injection indicator: {indicator}</p>
              ))}
            </div>
          )}
          {b && (
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between">
                <SectionLabel>Behaviour</SectionLabel>
                <span className="flex items-center gap-2 text-xs text-slate-500">Anomaly <RiskMeter score={b.score} /> <span className="text-slate-400">/ 100</span></span>
              </div>
              {b.signals.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">Consistent with this agent's normal behaviour.</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {b.signals.map((signal) => (
                    <li key={signal.name} className="text-xs">
                      <span className="font-semibold text-slate-700">+{signal.score} {signal.name}</span>
                      <span className="block text-slate-500">{signal.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {r && (
            <div className="border-t border-slate-100 pt-3">
              <SectionLabel>Final risk</SectionLabel>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={cx("text-4xl font-bold tabular-nums", riskTone(r.score).text)}>{r.score}</span>
                <span className="text-sm text-slate-400">/ 100</span>
                <SeverityBadge severity={r.severity} />
              </div>
              <div className="mt-2.5 space-y-1.5">
                {Object.entries(r.components).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0 text-slate-500">{COMPONENT_LABELS[key] || key}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <span className={cx("block h-full rounded-full", riskTone(value).bar)} style={{ width: `${Math.max(2, value)}%` }} />
                    </span>
                    <span className="w-7 text-right font-semibold tabular-nums text-slate-700">{value}</span>
                    <span className="w-9 text-right font-mono text-[10px] text-slate-400">×{r.weights[key]}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 break-words rounded bg-slate-100 px-2 py-1.5 font-mono text-[10px] leading-4 text-slate-600">{r.formula}</p>
              {r.overrides.map((o) => <p key={o} className="mt-1 text-[11px] font-medium text-red-700">Override: {o}</p>)}
              {r.drivers.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Decision driven by: {r.drivers.join(", ")}</p>}
            </div>
          )}
          <div className="border-t border-slate-100 pt-3">
            <SectionLabel>Response</SectionLabel>
            <ul className="mt-1.5 space-y-1">
              {event.response_actions.map((action) => (
                <li key={action} className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-800">
                  <span className={cx("h-1.5 w-1.5 rounded-full", event.decision === "BLOCK" ? "bg-red-500" : event.decision === "REVIEW" ? "bg-amber-500" : "bg-emerald-500")} />
                  {action}
                </li>
              ))}
            </ul>
            {event.admin_action && <p className="mt-2 text-xs text-slate-500">Admin action: <span className="font-semibold text-slate-700">{event.admin_action}</span></p>}
          </div>
        </Column>
      </div>

      <WhyPanel event={event} />

      <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-700">Raw event JSON (engineer mode)</summary>
        <div className="border-t border-slate-100 p-4"><JsonBlock value={event} maxHeight="28rem" /></div>
      </details>
    </div>
  );
}
