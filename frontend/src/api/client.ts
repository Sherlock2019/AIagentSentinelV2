import type {
  Agent, AgentDetail, Alert, AuditPage, CapabilityGraph, Catalog, EventDetail, EventSummary, GithubIntegrationInfo, GithubMockRun, InterceptResponse, Metrics,
  Overview, PendingAction, PipelineInfo, PipelineRun, PolicyDoc, PolicyRecord, PolicyValidation, Scenario, ScenarioResult, SystemSettings,
} from "../types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public errors: string[] = []) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  } catch {
    throw new ApiError("Backend offline — cannot reach the Sentinel Gateway", 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let errors: string[] = [];
    try {
      const body = await response.json();
      const detail = body?.detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = detail.map((d) => `${(d.loc || []).slice(1).join(".")}: ${d.msg}`).join("; ");
      else if (detail?.message) {
        message = detail.message;
        errors = detail.errors || [];
      }
    } catch {
      if (response.status >= 500) message = "Backend offline — cannot reach the Sentinel Gateway";
    }
    throw new ApiError(message, response.status, errors);
  }
  return response.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });

function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : "";
}

export interface EventFilters { agent_id?: string; decision?: string; severity?: string; tool?: string; kind?: string; since_minutes?: number; limit?: number }
export interface AuditFilters { agent_id?: string; decision?: string; tool?: string }
export interface InterceptBody { agent_id: string; task: string; tool: string; resource: string; operation?: string; arguments?: Record<string, unknown>; context?: Record<string, unknown> }
export interface AgentCreateBody {
  name: string; purpose: string; owner: string; environment: string; allowed_tools: string[]; approval_tools: string[]; denied_tools: string[];
  allowed_resources: string[]; denied_resources: string[]; network_destinations: string[]; rate_limit_per_min: number; cost_limit_per_min: number; risk_sensitivity: string;
}

export const api = {
  health: () => get<{ status: string; gateway: string; database: string; ai_provider: string }>("/health"),
  overview: () => get<Overview>("/api/system/overview"),
  agents: () => get<Agent[]>("/api/agents"),
  agent: (id: string) => get<AgentDetail>(`/api/agents/${id}`),
  createAgent: (body: AgentCreateBody) => post<Agent>("/api/agents", body),
  agentControl: (id: string, action: "pause" | "resume" | "quarantine" | "kill") => post<Agent>(`/api/agents/${id}/${action}`),
  intercept: (body: InterceptBody) => post<InterceptResponse>("/api/actions/intercept", body),
  pending: () => get<PendingAction[]>("/api/actions/pending"),
  resolveAction: (id: string, verdict: "approve" | "reject") => post<unknown>(`/api/actions/${id}/${verdict}`),
  events: (filters: EventFilters = {}) => get<EventSummary[]>(`/api/events${qs({ ...filters })}`),
  event: (id: string) => get<EventDetail>(`/api/events/${id}`),
  alerts: () => get<Alert[]>("/api/alerts"),
  alertAction: (id: string, action: "acknowledge" | "investigate" | "keep-quarantined" | "restore-agent") => post<Alert>(`/api/alerts/${id}/${action}`),
  policies: () => get<PolicyRecord[]>("/api/policies"),
  validatePolicy: (agentId: string, body: { yaml?: string; policy?: PolicyDoc }) => post<PolicyValidation>(`/api/policies/${agentId}/validate`, body),
  savePolicy: (agentId: string, body: { yaml?: string; policy?: PolicyDoc }) => put<PolicyRecord & { warnings: string[] }>(`/api/policies/${agentId}`, body),
  capabilities: (agentId: string) => get<CapabilityGraph>(`/api/capabilities/${agentId}`),
  catalog: () => get<Catalog>("/api/catalog"),
  scenarios: () => get<Scenario[]>("/api/redteam/scenarios"),
  runScenario: (scenarioId: string) => post<ScenarioResult>("/api/redteam/run", { scenario_id: scenarioId }),
  metrics: () => get<Metrics>("/api/metrics"),
  audit: (filters: AuditFilters = {}) => get<AuditPage>(`/api/audit${qs({ ...filters, limit: 300 })}`),
  auditExportUrl: (format: "json" | "csv", filters: AuditFilters = {}) => `/api/audit/export${qs({ ...filters, format })}`,
  settings: () => get<SystemSettings>("/api/system/settings"),
  saveSettings: (body: Partial<SystemSettings>) => put<SystemSettings>("/api/system/settings", body),
  emergencyStop: () => post<{ stopped: string[] }>("/api/system/emergency-stop"),
  releaseEmergencyStop: () => post<{ restored: string[] }>("/api/system/emergency-stop/release"),
  resetDemo: () => post<{ reset: boolean }>("/api/system/reset"),
  githubInfo: () => get<GithubIntegrationInfo>("/api/integrations/github"),
  pipelineInfo: () => get<PipelineInfo>("/api/integrations/github/pipeline"),
  pipelineRun: () => post<PipelineRun>("/api/integrations/github/pipeline/run"),
  githubRun:(body: { scenario: string; commit_url: string; trigger: string }) => post<GithubMockRun>("/api/integrations/github/run", body),
  issueAgentToken: (agentId: string) => post<{ agent_id: string; token: string; note: string }>(`/api/integrations/agents/${agentId}/token`),
};
