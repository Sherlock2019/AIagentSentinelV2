import { AlertTriangle, CheckCircle2, Save } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError, api } from "../api/client";
import { Button, Card, ErrorState, Field, Loading, PageHeader, Segmented, Select, TagInput, cx, formatDateTime, inputClass } from "../components/ui";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import type { PolicyDoc, PolicyRecord } from "../types";

const RULE_LABELS: Record<string, string> = {
  secret_access: "Attempt to access secrets",
  iam_modification: "Attempt to modify IAM",
  audit_tampering: "Attempt to disable audit logging",
  sentinel_bypass: "Attempt to modify or bypass Sentinel",
  critical_exfiltration: "Critical exfiltration attempt",
  repeated_blocks: "Repeated blocked actions (N strikes)",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-slate-100 px-5 py-4 last:border-0 md:grid-cols-[13rem_1fr]">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-600">{title}</p>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function PolicyStudio() {
  const { act, notify } = useApp();
  const policies = usePolling(api.policies, 0);
  const catalog = usePolling(api.catalog, 0);
  const [agentId, setAgentId] = useState("");
  const [mode, setMode] = useState<"visual" | "yaml">("visual");
  const [doc, setDoc] = useState<PolicyDoc | null>(null);
  const [yaml, setYaml] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [validated, setValidated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const record: PolicyRecord | undefined = policies.data?.find((p) => p.agent_id === agentId);
  const load = (r: PolicyRecord) => {
    setDoc(structuredClone(r.policy));
    setYaml(r.yaml);
    setErrors([]);
    setWarnings([]);
    setValidated(false);
    setDirty(false);
  };

  useEffect(() => {
    if (!policies.data?.length) return;
    const target = policies.data.find((p) => p.agent_id === agentId) || policies.data[0];
    if (target.agent_id !== agentId) setAgentId(target.agent_id);
    load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies.data, agentId]);

  const edit = (patch: Partial<PolicyDoc>) => {
    setDoc((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setValidated(false);
  };
  const body = () => (mode === "yaml" ? { yaml } : { policy: doc! });

  /** Validate on the server; on success both representations are refreshed from the normalized policy. */
  const validate = async (): Promise<boolean> => {
    try {
      const result = await api.validatePolicy(agentId, body());
      setErrors(result.errors);
      setWarnings(result.warnings);
      setValidated(result.valid);
      if (result.valid && result.policy && result.yaml) {
        setDoc(result.policy);
        setYaml(result.yaml);
      }
      return result.valid;
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Validation failed"]);
      return false;
    }
  };

  const switchMode = async (next: "visual" | "yaml") => {
    if (next === mode) return;
    // Never switch away from an invalid document: the other editor could not represent it.
    if (dirty && !(await validate())) {
      notify("Fix the validation errors before switching editors", "error");
      return;
    }
    setMode(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.savePolicy(agentId, body());
      notify(`Policy saved (version ${saved.version}) — enforced on the next action`, "ok");
      setWarnings(saved.warnings);
      setErrors([]);
      await policies.refresh();
    } catch (err) {
      const list = err instanceof ApiError && err.errors.length ? err.errors : [err instanceof Error ? err.message : "Save failed"];
      setErrors(list);
      setValidated(false);
      notify("Invalid policy — not saved", "error");
    } finally {
      setBusy(false);
    }
  };

  if (policies.error && !policies.data) return <ErrorState message={policies.error} onRetry={() => void policies.refresh()} />;
  if (!policies.data || !doc || !record) return <Loading />;
  const tools = catalog.data?.tools.map((t) => t.name) || [];
  const resources = catalog.data?.resources.map((r) => r.name) || [];
  const rules = catalog.data?.quarantine_rules || Object.keys(RULE_LABELS);

  return (
    <>
      <PageHeader
        title="Policy Studio"
        subtitle="Policies are the primary enforcement mechanism. DENY beats REQUIRE_APPROVAL beats ALLOW, and no model can override them."
        actions={
          <>
            <Select label="Agent" value={agentId} onChange={setAgentId} options={policies.data.map((p) => ({ value: p.agent_id, label: p.agent_name }))} />
            <Segmented value={mode} onChange={(m) => void switchMode(m)} options={[{ value: "visual", label: "Visual mode" }, { value: "yaml", label: "YAML mode" }]} />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          {mode === "visual" ? (
            <>
              <Section title="Agent purpose" hint="Tags describing the declared intent.">
                <p className="mb-2 text-sm text-slate-600">{record.agent_purpose}</p>
                <TagInput tone="blue" values={doc.purpose} onChange={(v) => edit({ purpose: v })} placeholder="customer_support" />
              </Section>
              <Section title="Allowed tools" hint="Run without human involvement.">
                <TagInput tone="green" values={doc.allow} onChange={(v) => edit({ allow: v })} suggestions={tools} />
              </Section>
              <Section title="Approval required" hint="Held until a human approves.">
                <TagInput tone="amber" values={doc.require_approval} onChange={(v) => edit({ require_approval: v })} suggestions={tools} />
              </Section>
              <Section title="Denied tools" hint="Always blocked. DENY wins every conflict.">
                <TagInput tone="red" values={doc.deny} onChange={(v) => edit({ deny: v })} suggestions={tools} />
              </Section>
              <Section title="Resource access" hint="class or class:OPERATION, e.g. customer_database:READ">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Allow"><TagInput tone="green" values={doc.resources.allow} onChange={(v) => edit({ resources: { ...doc.resources, allow: v } })} suggestions={resources} /></Field>
                  <Field label="Deny"><TagInput tone="red" values={doc.resources.deny} onChange={(v) => edit({ resources: { ...doc.resources, deny: v } })} suggestions={resources} /></Field>
                </div>
              </Section>
              <Section title="Network access" hint="Approved outbound hosts. Empty = none.">
                <TagInput tone="blue" values={doc.network.allow} onChange={(v) => edit({ network: { allow: v } })} placeholder="api.partner.example" />
              </Section>
              <Section title="Rate limit" hint="Exceeding it pauses the agent.">
                <div className="flex items-center gap-2">
                  <input type="number" min={1} aria-label="Rate limit per minute" className={cx(inputClass, "w-28")} value={doc.limits.rate_per_minute} onChange={(e) => edit({ limits: { ...doc.limits, rate_per_minute: Math.max(1, Math.round(Number(e.target.value)) || 1) } })} />
                  <span className="text-sm text-slate-500">calls per minute</span>
                </div>
              </Section>
              <Section title="Cost limit" hint="Simulated spend ceiling.">
                <div className="flex items-center gap-2">
                  <input type="number" min={0.01} step={0.1} aria-label="Cost limit per minute" className={cx(inputClass, "w-28")} value={doc.limits.cost_per_minute_usd} onChange={(e) => edit({ limits: { ...doc.limits, cost_per_minute_usd: Math.max(0.01, Number(e.target.value) || 0.01) } })} />
                  <span className="text-sm text-slate-500">USD per minute</span>
                </div>
              </Section>
              <Section title="Quarantine rules" hint="Which violations isolate the agent automatically.">
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {rules.map((rule) => (
                    <label key={rule} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                        checked={doc.quarantine_rules.includes(rule)}
                        onChange={(e) => edit({ quarantine_rules: e.target.checked ? [...doc.quarantine_rules, rule] : doc.quarantine_rules.filter((r) => r !== rule) })}
                      />
                      {RULE_LABELS[rule] || rule}
                    </label>
                  ))}
                </div>
              </Section>
            </>
          ) : (
            <div className="p-4">
              <textarea
                aria-label="Policy YAML"
                spellCheck={false}
                value={yaml}
                onChange={(e) => { setYaml(e.target.value); setDirty(true); setValidated(false); }}
                className="scroll-thin h-[34rem] w-full resize-y rounded-lg border border-slate-300 bg-slate-900 p-4 font-mono text-[13px] leading-relaxed text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <p className="text-sm font-semibold text-slate-900">{record.agent_name}</p>
            <p className="text-xs text-slate-500">Version {record.version} · updated {formatDateTime(record.updated_at)}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void validate()} disabled={busy}>Validate</Button>
              <Button variant="primary" icon={<Save className="h-4 w-4" />} busy={busy} disabled={!dirty} onClick={() => void save()}>Save policy</Button>
              <Button variant="ghost" disabled={!dirty} onClick={() => load(record)}>Discard</Button>
            </div>
            {dirty && <p className="text-xs text-amber-700">Unsaved changes — the gateway still enforces version {record.version}.</p>}
          </Card>

          {errors.length > 0 && (
            <Card className="border-red-300 bg-red-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800"><AlertTriangle className="h-4 w-4" /> Invalid policy — cannot be saved</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-700">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </Card>
          )}
          {errors.length === 0 && validated && (
            <Card className="border-emerald-300 bg-emerald-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Policy is valid</p>
            </Card>
          )}
          {warnings.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Warnings</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Card>
          )}
          <Card className="p-5 text-xs leading-relaxed text-slate-500">
            <p className="font-semibold text-slate-700">Precedence</p>
            <p className="mt-1 font-mono text-slate-800">DENY &gt; REQUIRE_APPROVAL &gt; ALLOW</p>
            <p className="mt-2">Tools and resources that are not listed are denied by default. Only administrators can edit policy here — an agent that calls <span className="font-mono">update_policy</span> is blocked and quarantined.</p>
            <Button size="sm" className="mt-3" onClick={() => void act(async () => { await policies.refresh(); }, "Reloaded from server")}>Reload from server</Button>
          </Card>
        </div>
      </div>
    </>
  );
}
