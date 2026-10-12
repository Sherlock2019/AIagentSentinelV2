import { AlertTriangle, Loader2, WifiOff, X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ formatting
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export function callText(tool: string, resource?: string): string {
  return resource ? `${tool}(${resource})` : `${tool}()`;
}

// ---------------------------------------------------------------------- layout
export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  // Defaults are dropped (not overridden) when the caller supplies its own, so the result
  // never depends on stylesheet order.
  const ownBg = /(^|\s)bg-/.test(className || "");
  const ownBorder = /(^|\s)border-(red|emerald|amber|slate|blue|orange)-/.test(className || "");
  return (
    <section id={id} className={cx("rounded-xl border shadow-sm", !ownBg && "bg-white", !ownBorder && "border-slate-200", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, icon, action }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</p>;
}

// --------------------------------------------------------------------- controls
type Variant = "primary" | "secondary" | "danger" | "ghost" | "success" | "warning";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 border-transparent",
  secondary: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300",
  danger: "bg-red-600 text-white hover:bg-red-700 border-transparent",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 border-transparent",
  warning: "bg-amber-500 text-white hover:bg-amber-600 border-transparent",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, busy, children, className, disabled, ...rest }: ButtonProps) {
  const sizes = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-sm gap-2" };
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50",
        sizes[size], VARIANTS[variant], className,
      )}
      {...rest}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === option.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, label, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; className?: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx("h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export const inputClass = "h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-blue-600" : "bg-slate-300")}
    >
      <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

type ChipTone = "green" | "amber" | "red" | "slate" | "blue";
const CHIP: Record<ChipTone, string> = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-800 border-red-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
};

export function Chip({ children, tone = "slate", onRemove }: { children: ReactNode; tone?: ChipTone; onRemove?: () => void }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs", CHIP[tone])}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove" className="-mr-0.5 rounded opacity-60 hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** Editable list of short tokens (tools, resources, hosts). Enter or comma adds; suggestions are one click. */
export function TagInput({ values, onChange, tone = "slate", placeholder, suggestions = [] }: { values: string[]; onChange: (v: string[]) => void; tone?: ChipTone; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const token = raw.trim();
    if (token && !values.includes(token)) onChange([...values, token]);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  const open = suggestions.filter((s) => !values.includes(s) && (!draft || s.includes(draft.toLowerCase()))).slice(0, 8);
  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-blue-500">
        {values.map((v) => (
          <Chip key={v} tone={tone} onRemove={() => onChange(values.filter((x) => x !== v))}>{v}</Chip>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft && add(draft)}
          placeholder={values.length ? "" : placeholder}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>
      {open.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {open.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 hover:border-blue-400 hover:text-blue-700">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------- overlays
export function Modal({ open, onClose, title, children, footer, tone = "default", wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; tone?: "default" | "danger"; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 animate-fade-in" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={cx("flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-up", wide ? "max-w-3xl" : "max-w-lg")}
      >
        <header className={cx("flex items-center justify-between gap-4 border-b px-6 py-4", tone === "danger" ? "border-red-100 bg-red-50" : "border-slate-100")}>
          <h2 className={cx("text-base font-semibold", tone === "danger" ? "text-red-800" : "text-slate-900")}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="scroll-thin overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ states
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const offline = message.toLowerCase().includes("offline");
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-red-200 bg-red-50/50 px-6 py-12 text-center">
      {offline ? <WifiOff className="h-6 w-6 text-red-500" /> : <AlertTriangle className="h-6 w-6 text-red-500" />}
      <div>
        <p className="text-sm font-semibold text-red-800">{offline ? "Backend offline" : "Something went wrong"}</p>
        <p className="mt-1 text-sm text-red-700">{message}</p>
        {offline && <p className="mt-1 text-xs text-red-600">Start it with <code className="font-mono">./start.sh</code> — the page reconnects automatically.</p>}
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="max-w-md text-xs text-slate-400">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function JsonBlock({ value, maxHeight = "20rem" }: { value: unknown; maxHeight?: string }) {
  return (
    <pre className="scroll-thin overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100" style={{ maxHeight }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3 align-middle text-sm text-slate-700", className)}>{children}</td>;
}
