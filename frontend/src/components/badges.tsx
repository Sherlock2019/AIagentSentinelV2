import { Activity, Ban, CheckCircle2, CircleSlash, Eye, Info, Lock, PauseCircle, ShieldAlert, ShieldCheck, UserCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./ui";

// Status always ships as icon + label + colour, never colour alone.
const BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

const DECISIONS: Record<string, { cls: string; icon: ReactNode; label: string }> = {
  ALLOW: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" />, label: "Allow" },
  REVIEW: { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: <UserCheck className="h-3 w-3" />, label: "Review" },
  BLOCK: { cls: "bg-red-50 text-red-700 border-red-200", icon: <Ban className="h-3 w-3" />, label: "Block" },
  INFO: { cls: "bg-slate-100 text-slate-600 border-slate-200", icon: <Info className="h-3 w-3" />, label: "System" },
};

export function DecisionBadge({ decision, large }: { decision: string; large?: boolean }) {
  const d = DECISIONS[decision] || DECISIONS.INFO;
  return <span className={cx(BASE, d.cls, large && "px-3 py-1 text-xs")}>{d.icon}{d.label}</span>;
}

const SEVERITIES: Record<string, string> = {
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
  INFO: "bg-slate-100 text-slate-600 border-slate-200",
  MEDIUM: "bg-amber-50 text-amber-800 border-amber-200",
  WARNING: "bg-amber-50 text-amber-800 border-amber-200",
  HIGH: "bg-orange-50 text-orange-800 border-orange-200",
  CRITICAL: "bg-red-600 text-white border-red-600",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={cx(BASE, SEVERITIES[severity] || SEVERITIES.INFO)}>{severity}</span>;
}

const STATUSES: Record<string, { cls: string; icon: ReactNode; label: string; live?: boolean }> = {
  SAFE: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <ShieldCheck className="h-3 w-3" />, label: "Safe" },
  ACTIVE: { cls: "bg-blue-50 text-blue-700 border-blue-200", icon: <Activity className="h-3 w-3" />, label: "Active", live: true },
  RUNNING: { cls: "bg-blue-50 text-blue-700 border-blue-200", icon: <Activity className="h-3 w-3" />, label: "Running" },
  WATCH: { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: <Eye className="h-3 w-3" />, label: "Watch" },
  REVIEW: { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: <UserCheck className="h-3 w-3" />, label: "Review" },
  PAUSED: { cls: "bg-amber-100 text-amber-900 border-amber-300", icon: <PauseCircle className="h-3 w-3" />, label: "Paused" },
  QUARANTINED: { cls: "bg-red-600 text-white border-red-600", icon: <Lock className="h-3 w-3" />, label: "Quarantined" },
  DISABLED: { cls: "bg-slate-800 text-white border-slate-800", icon: <CircleSlash className="h-3 w-3" />, label: "Disabled" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUSES[status] || { cls: "bg-slate-100 text-slate-600 border-slate-200", icon: <ShieldAlert className="h-3 w-3" />, label: status };
  return <span className={cx(BASE, s.cls)}>{s.icon}{s.label}</span>;
}

export function riskTone(score: number): { text: string; bar: string; label: string; hex: string } {
  if (score >= 80) return { text: "text-red-700", bar: "bg-red-600", label: "CRITICAL", hex: "#d03b3b" };
  if (score >= 55) return { text: "text-orange-700", bar: "bg-orange-500", label: "HIGH", hex: "#ec835a" };
  if (score >= 30) return { text: "text-amber-700", bar: "bg-amber-500", label: "MEDIUM", hex: "#fab219" };
  return { text: "text-emerald-700", bar: "bg-emerald-500", label: "LOW", hex: "#0ca30c" };
}

/** Compact risk meter: number + bar, colour follows the risk level. */
export function RiskMeter({ score, width = "w-16" }: { score: number; width?: string }) {
  const tone = riskTone(score);
  return (
    <span className="inline-flex items-center gap-2" title={`Risk ${score}/100 — ${tone.label}`}>
      <span className={cx("w-6 text-right text-sm font-semibold tabular-nums", tone.text)}>{score}</span>
      <span className={cx("h-1.5 overflow-hidden rounded-full bg-slate-200", width)}>
        <span className={cx("block h-full rounded-full transition-all duration-700", tone.bar)} style={{ width: `${Math.max(3, score)}%` }} />
      </span>
    </span>
  );
}

/** Half-donut gauge for a single 0-100 figure. */
export function Gauge({ value, color, label, sublabel, size = 180 }: { value: number; color: string; label: string; sublabel?: string; size?: number }) {
  const r = 70;
  const arc = Math.PI * r;
  const filled = (Math.min(100, Math.max(0, value)) / 100) * arc;
  return (
    <div className="relative" style={{ width: size, height: size * 0.6 }} role="img" aria-label={`${label}: ${value} out of 100`}>
      <svg viewBox="0 0 180 104" width={size} height={size * 0.58}>
        <path d="M 20 94 A 70 70 0 0 1 160 94" fill="none" stroke="#e2e8f0" strokeWidth="14" strokeLinecap="round" />
        <path
          d="M 20 94 A 70 70 0 0 1 160 94" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${filled} ${arc}`} style={{ transition: "stroke-dasharray 0.8s ease, stroke 0.4s ease" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-3xl font-semibold leading-none text-slate-900">{value}<span className="text-base font-normal text-slate-400"> / 100</span></div>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {sublabel || label}
        </div>
      </div>
    </div>
  );
}
