import { Copy, KeyRound } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { useApp } from "../hooks/useApp";
import { usePolling } from "../hooks/usePolling";
import { Button, Card, CardHeader, Field, Modal, SectionLabel, Select, cx, inputClass } from "./ui";

export const ACTION_REF = "Sherlock2019/AIagentSentinelV2/github-action@main";

export function CodeBlock({ code, label }: { code: string; label: string }) {
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

/** How to wire the real GitHub Action into a repository: setup steps, token, YAML generator. */
export function GithubSetup() {
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
        `        uses: ${ACTION_REF}`,
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
