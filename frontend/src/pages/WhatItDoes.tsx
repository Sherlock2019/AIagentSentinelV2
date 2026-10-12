import { ArrowRight, Ban, Bot, ClipboardList, Eye, Lock, MessageSquareText, ShieldCheck, UserCheck, Workflow, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card } from "../components/ui";

const RISKS: { title: string; text: string }[] = [
  { title: "Prompt injection", text: "A document, web page or code comment tells the agent to do something its user never asked for." },
  { title: "Going off-purpose", text: "A code-review agent reads production credentials; a support agent runs shell commands." },
  { title: "Privilege escalation", text: "The agent grants itself more access, or switches off the controls watching it." },
  { title: "Data exfiltration", text: "Customer data is bulk-exported or sent to an external server." },
  { title: "Hidden tool chains", text: "Individually harmless tools combine into a forbidden effect." },
  { title: "Runaway behaviour", text: "Loops, retries and cost spikes nobody notices until the bill arrives." },
];

const DOES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <ShieldCheck className="h-5 w-5" />, title: "Checks every action first", text: "Agents submit each important tool call to the Sentinel Gateway. Nothing runs until Sentinel decides." },
  { icon: <Eye className="h-5 w-5" />, title: "Understands intent", text: "Rules check what the agent may do; an AI safety judge checks whether this action fits the task; behaviour analysis spots what is unusual." },
  { icon: <Zap className="h-5 w-5" />, title: "Decides in milliseconds", text: "ALLOW safe actions, send high-impact ones for HUMAN APPROVAL, BLOCK unauthorized ones." },
  { icon: <Lock className="h-5 w-5" />, title: "Contains bad agents", text: "Critical violations quarantine the agent automatically: session revoked, future actions refused. Kill switches for one agent or all." },
  { icon: <UserCheck className="h-5 w-5" />, title: "Keeps humans in control", text: "Administrators are alerted, approve what matters, and decide whether an agent is restored." },
  { icon: <ClipboardList className="h-5 w-5" />, title: "Proves what happened", text: "Every decision, with its reasons, goes into a tamper-evident audit trail you can export." },
];

const AUDIENCE: [string, string][] = [
  ["Teams shipping AI agents", "Give agents real tools without giving them unlimited power."],
  ["Security & compliance", "Enforceable policy, human sign-off and evidence for every action."],
  ["Platform & DevOps", "Gate AI agents in CI/CD with a GitHub Action that fails closed."],
];

export default function WhatItDoes() {
  const navigate = useNavigate();
  return (
    <>
      <section className="rounded-2xl bg-slate-900 px-8 py-10 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300">What AgentSentinel does</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight">A safety guard that sits between AI agents and the real world.</h1>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-slate-300">
          AI agents can now read databases, run code, move money and deploy software. AgentSentinel checks every important action an agent tries to take —
          <b className="text-white"> before it happens</b> — and allows it, asks a human, or blocks it. If an agent goes rogue, Sentinel shuts it down and tells you why.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="primary" size="lg" icon={<MessageSquareText className="h-4 w-4" />} onClick={() => navigate("/test-demo")}>Try an AI agent now</Button>
          <Button size="lg" className="border-slate-600 bg-transparent text-white hover:bg-slate-800" onClick={() => navigate("/how-it-works")}>How it works <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </section>

      <h2 className="mb-3 mt-10 text-lg font-semibold text-slate-900">The problem</h2>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">An agent with tools is only as safe as its worst decision. Asking the model to "behave" is not a control, and a log viewer only tells you after the damage is done.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {RISKS.map((risk) => (
          <Card key={risk.title} className="border-l-4 border-l-red-500 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Ban className="h-4 w-4 text-red-500" /> {risk.title}</p>
            <p className="mt-1 text-sm text-slate-600">{risk.text}</p>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold text-slate-900">What Sentinel does about it</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DOES.map((item) => (
          <Card key={item.title} className="flex gap-3.5 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">{item.icon}</span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.text}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-10 overflow-hidden">
        <div className="grid items-center gap-4 p-6 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <div className="rounded-xl border border-slate-200 p-4 text-center">
            <Bot className="mx-auto h-6 w-6 text-slate-500" />
            <p className="mt-2 text-sm font-semibold text-slate-900">AI agent</p>
            <p className="text-xs text-slate-500">proposes an action</p>
          </div>
          <ArrowRight className="mx-auto h-5 w-5 text-slate-300 max-md:rotate-90" />
          <div className="rounded-xl border-2 border-blue-500 bg-blue-50 p-4 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-blue-600" />
            <p className="mt-2 text-sm font-semibold text-blue-900">AgentSentinel</p>
            <p className="text-xs text-blue-800">ALLOW · REVIEW · BLOCK</p>
          </div>
          <ArrowRight className="mx-auto h-5 w-5 text-slate-300 max-md:rotate-90" />
          <div className="rounded-xl border border-slate-200 p-4 text-center">
            <Workflow className="mx-auto h-6 w-6 text-slate-500" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Tools, APIs, data</p>
            <p className="text-xs text-slate-500">only reached when allowed</p>
          </div>
        </div>
      </Card>

      <h2 className="mb-3 mt-10 text-lg font-semibold text-slate-900">Who it is for</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {AUDIENCE.map(([who, why]) => (
          <Card key={who} className="p-5">
            <p className="text-sm font-semibold text-slate-900">{who}</p>
            <p className="mt-1 text-sm text-slate-600">{why}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-10 border-slate-900 bg-slate-900 px-8 py-8 text-center text-white">
        <p className="text-xl font-semibold tracking-wide">AI AGENTS SHOULD NOT POLICE THEMSELVES.</p>
        <p className="mt-2 text-sm text-slate-300">Next: see the architecture in <b>How It Works</b>, then try to break an agent in <b>Test Demo</b>.</p>
      </Card>
    </>
  );
}
