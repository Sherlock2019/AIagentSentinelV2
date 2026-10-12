import {
  Activity, AlertTriangle, BarChart3, Bot, Brain, ClipboardList, FlaskConical, Network, PlayCircle, Power, ScrollText, Search, GitCommitHorizontal, Settings, Shield, WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api/client";
import { useApp } from "../hooks/useApp";
import type { Mode } from "../types";
import { useDemo } from "./GuidedDemo";
import { Button, Segmented, cx } from "./ui";

const NAV: { to: string; label: string; icon: ReactNode; badge?: "alerts" | "approvals"; start?: boolean }[] = [
  { to: "/how-it-works", label: "How It Works", icon: <Brain className="h-4 w-4" />, start: true },
  { to: "/integrations", label: "Test a Commit", icon: <GitCommitHorizontal className="h-4 w-4" />, start: true },
  { to: "/", label: "Security Operations", icon: <Shield className="h-4 w-4" /> },
  { to: "/agents", label: "Agents", icon: <Bot className="h-4 w-4" /> },
  { to: "/monitor", label: "Live Monitor", icon: <Activity className="h-4 w-4" /> },
  { to: "/alerts", label: "Alerts", icon: <AlertTriangle className="h-4 w-4" />, badge: "alerts" },
  { to: "/inspector", label: "Event Inspector", icon: <Search className="h-4 w-4" /> },
  { to: "/capabilities", label: "Capability Map", icon: <Network className="h-4 w-4" /> },
  { to: "/policies", label: "Policy Studio", icon: <ScrollText className="h-4 w-4" /> },
  { to: "/redteam", label: "Red Team Lab", icon: <FlaskConical className="h-4 w-4" /> },
  { to: "/metrics", label: "Metrics", icon: <BarChart3 className="h-4 w-4" /> },
  { to: "/audit", label: "Audit Trail", icon: <ClipboardList className="h-4 w-4" /> },
  { to: "/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

function Sidebar() {
  const { online, overview } = useApp();
  const badges = { alerts: overview?.open_alerts ?? 0, approvals: overview?.pending_approvals ?? 0 };
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white"><Shield className="h-5 w-5" /></span>
        <div>
          <div className="text-sm font-bold tracking-[0.08em] text-white">AGENTSENTINEL</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Runtime Safety Guard</div>
        </div>
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
        {NAV.map((item, i) => (
          <div key={item.to}>
          {i === 2 && <div className="mx-3 my-2 border-t border-slate-800" />}
          <NavLink
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100")
            }
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.start && <span className="rounded bg-blue-600/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-300">Start</span>}
            {item.badge && badges[item.badge] > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{badges[item.badge]}</span>
            )}
          </NavLink>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-800 px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">System status</p>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span>Sentinel Gateway</span>
          <span className={cx("flex items-center gap-1.5 font-semibold", online === false ? "text-red-400" : online ? "text-emerald-400" : "text-slate-400")}>
            <span className={cx("h-2 w-2 rounded-full bg-current", online && "live-dot")} />
            {online === false ? "OFFLINE" : online ? "ONLINE" : "…"}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span>Safety evaluator</span>
          <span className="font-mono text-slate-400">{overview?.ai_provider ?? "—"}</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const { mode, setMode } = useApp();
  const demo = useDemo();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
      <p className="hidden truncate text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 md:block">
        AI agents should not police themselves.
      </p>
      <div className="ml-auto flex items-center gap-3">
        <Segmented<Mode>
          size="sm"
          value={mode}
          onChange={setMode}
          options={[{ value: "recruiter", label: "Recruiter mode" }, { value: "engineer", label: "Engineer mode" }]}
        />
        <Button variant="primary" icon={<PlayCircle className="h-4 w-4" />} onClick={demo.start} disabled={demo.active}>
          RUN GUIDED DEMO
        </Button>
      </div>
    </header>
  );
}

function Banners() {
  const { online, overview, act } = useApp();
  return (
    <>
      {online === false && (
        <div className="flex items-center gap-2 bg-slate-800 px-6 py-2 text-sm text-white" role="alert">
          <WifiOff className="h-4 w-4 text-red-400" /> Backend offline — the Sentinel Gateway is unreachable. Run <code className="rounded bg-white/10 px-1 font-mono text-xs">./start.sh</code>; this page reconnects automatically.
        </div>
      )}
      {overview?.emergency_stop_active && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-red-600 px-6 py-2 text-sm font-medium text-white" role="alert">
          <span className="flex items-center gap-2"><Power className="h-4 w-4" /> EMERGENCY STOP ACTIVE — every agent is disabled and the gateway refuses all actions.</span>
          <button
            type="button"
            className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/40 hover:bg-white/25"
            onClick={() => void act(api.releaseEmergencyStop, "Emergency stop released — agents restored")}
          >
            Release emergency stop
          </button>
        </div>
      )}
    </>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cx(
            "max-w-xl rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg animate-slide-up",
            toast.tone === "error" ? "bg-red-600" : toast.tone === "ok" ? "bg-emerald-600" : "bg-slate-800",
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export function Layout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <Banners />
        <main className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}
