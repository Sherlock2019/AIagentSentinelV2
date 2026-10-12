import { Power, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { Button, Card, CardHeader, ErrorState, Loading, Modal, PageHeader, Segmented, Toggle, cx, inputClass } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { SystemSettings } from "../types";

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0">
      <div className="min-w-0 max-w-xl">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const CHANNELS: { key: string; label: string; hint: string }[] = [
  { key: "dashboard", label: "Dashboard", hint: "Always on." },
  { key: "email", label: "Email (simulated)", hint: "Payload is written to the alert record, nothing is sent." },
  { key: "slack", label: "Slack (simulated)", hint: "Payload is written to the alert record, nothing is sent." },
  { key: "webhook", label: "Generic webhook", hint: "Simulated unless ALERT_WEBHOOK_URL is set in .env." },
];

export default function SettingsPage() {
  const { act, overview } = useApp();
  const settings = usePolling(api.settings, 0);
  const [draft, setDraft] = useState<SystemSettings | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  if (settings.error && !settings.data) return <ErrorState message={settings.error} onRetry={() => void settings.refresh()} />;
  if (!draft) return <Loading />;

  /** Persist one change immediately; on rejection, snap back to the server's values. */
  const save = async (patch: Partial<SystemSettings>) => {
    setDraft({ ...draft, ...patch });
    const saved = await act(() => api.saveSettings(patch), "Setting saved");
    if (saved) setDraft(saved);
    else void settings.refresh().then(() => settings.data && setDraft(settings.data));
  };
  const thresholdInput = (key: "threshold_medium" | "threshold_high" | "threshold_critical", label: string) => (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
      {label}
      <input
        type="number" min={1} max={100} aria-label={`${label} threshold`}
        className={cx(inputClass, "w-20")}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
        onBlur={() => draft[key] !== settings.data?.[key] && void save({ [key]: draft[key] })}
      />
    </label>
  );

  return (
    <>
      <PageHeader title="Settings" subtitle="How Sentinel evaluates and responds. No secrets are shown here — API keys live only in the server's .env file." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="AI safety evaluator" subtitle="Advisory semantic judge. Chosen with AI_PROVIDER in .env." />
          <Row title="AI provider" hint={`Available: ${draft.available_providers.join(", ")}`}>
            <span className="rounded-md bg-slate-900 px-2.5 py-1 font-mono text-xs font-semibold text-white">{draft.ai_provider}</span>
          </Row>
          <Row title="Model"><span className="font-mono text-xs text-slate-600">{draft.ai_model}</span></Row>
          <Row title="Mock mode" hint="Deterministic offline evaluator: no API key, no internet, reproducible results.">
            <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", draft.mock_mode ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800")}>{draft.mock_mode ? "ON" : "OFF — live model"}</span>
          </Row>
          <Row title="LLM judge enabled" hint="When off (or when the model is unreachable) Sentinel fails safe: sensitive actions go to human review.">
            <Toggle label="LLM judge enabled" checked={draft.llm_judge_enabled} onChange={(v) => void save({ llm_judge_enabled: v })} />
          </Row>
          <Row title="Database"><span className="font-mono text-xs text-slate-600">{draft.database}</span></Row>
        </Card>

        <Card>
          <CardHeader title="Risk engine" subtitle="A score at or above a threshold enters that level." />
          <Row title="Risk thresholds" hint="LOW → allow · MEDIUM → allow + log · HIGH → human approval · CRITICAL → block">
            <div className="flex flex-wrap gap-3">
              {thresholdInput("threshold_medium", "Medium ≥")}
              {thresholdInput("threshold_high", "High ≥")}
              {thresholdInput("threshold_critical", "Critical ≥")}
            </div>
          </Row>
          <Row title="Global policy mode" hint="STRICT also sends MEDIUM-risk actions to human approval.">
            <Segmented value={draft.global_policy_mode} onChange={(v) => void save({ global_policy_mode: v })} options={[{ value: "ENFORCE", label: "Enforce" }, { value: "STRICT", label: "Strict" }]} />
          </Row>
          <Row title="Risk formula weights" hint="Fixed in code (risk_engine.py); shown for transparency.">
            <div className="flex flex-wrap justify-end gap-1.5">
              {Object.entries(draft.risk_weights).map(([key, weight]) => (
                <span key={key} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{key} {weight}</span>
              ))}
            </div>
          </Row>
        </Card>

        <Card>
          <CardHeader title="Automatic response" />
          <Row title="Auto quarantine enabled" hint="Critical violations isolate the agent without waiting for a human. When off, actions are still blocked.">
            <Toggle label="Auto quarantine enabled" checked={draft.auto_quarantine_enabled} onChange={(v) => void save({ auto_quarantine_enabled: v })} />
          </Row>
          <Row title="Blocked retry threshold" hint={`Quarantine after this many blocked actions within ${draft.blocked_retry_window_seconds} seconds.`}>
            <Segmented value={String(draft.blocked_retry_threshold)} onChange={(v) => void save({ blocked_retry_threshold: Number(v) })} options={["2", "3", "5"].map((v) => ({ value: v, label: v }))} />
          </Row>
          <Row title="Emergency stop" hint={overview?.emergency_stop_active ? "ACTIVE — every action is refused." : "Not active."}>
            {overview?.emergency_stop_active ? (
              <Button variant="success" onClick={() => void act(api.releaseEmergencyStop, "Emergency stop released — agents restored")}>Release emergency stop</Button>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-slate-500"><Power className="h-3.5 w-3.5" /> Trigger it from Security Operations</span>
            )}
          </Row>
        </Card>

        <Card>
          <CardHeader title="Alert channels" subtitle="Where administrator notifications go." />
          {CHANNELS.map((channel) => (
            <Row key={channel.key} title={channel.label} hint={channel.key === "webhook" && draft.webhook_configured ? "ALERT_WEBHOOK_URL is configured: alerts are POSTed for real." : channel.hint}>
              <Toggle
                label={channel.label}
                disabled={channel.key === "dashboard"}
                checked={!!draft.alert_channels[channel.key]}
                onChange={(v) => void save({ alert_channels: { ...draft.alert_channels, [channel.key]: v } })}
              />
            </Row>
          ))}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Demo data" />
          <Row title="Reset demo" hint="Deletes all events, alerts and audit records, then re-seeds the four demo agents and their baseline history.">
            <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirmReset(true)}>Reset demo data</Button>
          </Row>
        </Card>
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        tone="danger"
        title="Reset all demo data?"
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setConfirmReset(false); void act(api.resetDemo, "Demo data reset").then(() => settings.refresh()); }}>Reset</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Custom agents, policy edits, events, alerts and the audit trail are removed and replaced with the original seeded dataset. This cannot be undone.</p>
      </Modal>
    </>
  );
}
