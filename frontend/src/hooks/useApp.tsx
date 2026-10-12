import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Mode, Overview } from "../types";
import { usePolling } from "./usePolling";

interface Toast { id: number; message: string; tone: "ok" | "error" | "info" }

interface AppState {
  mode: Mode;
  setMode: (mode: Mode) => void;
  isEngineer: boolean;
  /** null = not checked yet */
  online: boolean | null;
  overview: Overview | null;
  refreshOverview: () => Promise<void>;
  toasts: Toast[];
  notify: (message: string, tone?: Toast["tone"]) => void;
  /** Run an API call, toast the outcome, refresh shared state. Returns undefined on failure. */
  act: <T>(work: () => Promise<T>, success?: string) => Promise<T | undefined>;
}

const AppContext = createContext<AppState | null>(null);
const MODE_KEY = "agentsentinel.mode";

function loadMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "recruiter" ? "recruiter" : "engineer";
  } catch {
    return "engineer";
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const overview = usePolling(api.overview, 3000);

  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private mode: the toggle still works for this session */
    }
  }, []);

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4500);
  }, []);

  const refreshOverview = overview.refresh;
  const act = useCallback(
    async <T,>(work: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await work();
        if (success) notify(success, "ok");
        void refreshOverview();
        return result;
      } catch (err) {
        notify(err instanceof Error ? err.message : "Request failed", "error");
        return undefined;
      }
    },
    [notify, refreshOverview],
  );

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const value = useMemo<AppState>(
    () => ({
      mode,
      setMode,
      isEngineer: mode === "engineer",
      online: overview.loading ? null : overview.error === null,
      overview: overview.data,
      refreshOverview,
      toasts,
      notify,
      act,
    }),
    [mode, setMode, overview.loading, overview.error, overview.data, refreshOverview, toasts, notify, act],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
