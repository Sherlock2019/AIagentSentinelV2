export type Decision = "ALLOW" | "REVIEW" | "BLOCK" | "INFO";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "INFO" | "WARNING";
export type Mode = "recruiter" | "engineer";

export interface Agent {
  id: string;
  name: string;
  purpose: string;
  owner: string;
  environment: string;
  risk_sensitivity: string;
  status: string;
  display_status: string;
  session_active: boolean;
  current_task: string;
  risk_score: number;
  is_demo: boolean;
  created_at: string;
  last_activity: string | null;
  actions_per_min: number;
  blocked_today: number;
  pending_approvals: number;
}

export interface PolicyDoc {
  agent: string;
  purpose: string[];
  allow: string[];
  require_approval: string[];
  deny: string[];
  resources: { allow: string[]; deny: string[] };
  network: { allow: string[] };
  limits: { rate_per_minute: number; cost_per_minute_usd: number };
  quarantine_rules: string[];
}

export interface PolicyRecord {
  agent_id: string;
  agent_name: string;
  agent_purpose: string;
  policy: PolicyDoc;
  version: number;
  updated_at: string;
  yaml: string;
}

export interface PolicyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  policy: PolicyDoc | null;
  yaml: string | null;
}

export interface AgentDetail extends Agent {
  policy: PolicyDoc | null;
  state_history: { id: number; from_state: string; to_state: string; reason: string; actor: string; timestamp: string }[];
  recent_events: EventSummary[];
}

export interface EventSummary {
  id: string;
  kind: "ACTION" | "SYSTEM";
  action_id: string | null;
  agent_id: string;
  agent_name: string;
  timestamp: string;
  task: string;
  tool: string;
  resource: string;
  operation: string;
  decision: Decision;
  severity: Severity;
  risk_score: number;
  reasons: string[];
  response_actions: string[];
  quarantined: boolean;
  agent_status_after: string;
  alert_id: string | null;
  injection_detected: boolean;
  scenario: string | null;
  source: string | null;
  message: string;
  admin_action: string | null;
}

export interface PolicyCheck { name: string; status: "PASS" | "FAIL" | "APPROVAL" | "WARN"; detail: string }

export interface EventDetail extends EventSummary {
  agent_purpose: string;
  resource_class: string;
  arguments: Record<string, unknown>;
  context: Record<string, unknown>;
  explanation: {
    headline?: string;
    steps?: string[];
    result?: string[];
    plain?: { supposed_to: string; wanted: string; why: string; what_sentinel_did: string; shut_down: string; admin_action_required: boolean };
  };
  policy_result: {
    verdict: string; risk: number; checks: PolicyCheck[]; violations: string[]; critical: boolean;
    critical_triggers: string[]; tool_category: string; resource_class: string; resource_sensitivity: number;
  } | null;
  llm_result: {
    intent_alignment: number; authorization_risk: number; data_risk: number; injection_risk: number; privilege_risk: number;
    necessity: number; reversibility_risk: number; overall_risk: number; recommended_decision: string; summary: string;
    provider: string; available: boolean; degraded_reason: string | null; risk: number; injection_indicators: string[];
  } | null;
  behavior_result: { score: number; signals: { name: string; score: number; detail: string }[]; rate_exceeded: boolean; calls_last_minute: number; blocked_last_window: number } | null;
  capability_result: { verdict: string; risk: number; transitive: boolean; paths: { label: string; nodes: string[]; resource: string; access: string }[]; summary: string } | null;
  risk_breakdown: {
    score: number; severity: string; components: Record<string, number>; weights: Record<string, number>;
    weighted_score: number; multiplier: number; overrides: string[]; formula: string; drivers: string[];
  } | null;
  recent_actions: { tool: string; resource: string; decision: string }[];
  timings: Record<string, number>;
}

export interface InterceptResponse {
  decision: Decision;
  risk_score: number;
  severity: Severity;
  reasons: string[];
  quarantine: boolean;
  alert: boolean;
  event_id: string;
  action_id: string;
  alert_id: string | null;
  agent_status: string;
  response_actions: string[];
  tool_result: unknown;
  event: EventDetail;
}

export interface Alert {
  id: string;
  event_id: string | null;
  agent_id: string;
  agent_name: string;
  severity: Severity;
  title: string;
  tool: string;
  resource: string;
  reasons: string[];
  risk_score: number;
  sentinel_response: string[];
  agent_state: string;
  status: string;
  admin_action: string | null;
  channels: { channel: string; status: string; payload: Record<string, unknown> | null; at?: string }[];
  created_at: string;
  updated_at: string | null;
}

export interface PendingAction {
  id: string;
  agent_id: string;
  agent_name: string;
  task: string;
  tool: string;
  resource: string;
  operation: string;
  arguments: Record<string, unknown>;
  risk_score: number;
  reasons: string[];
  event_id: string | null;
  timestamp: string;
}

export interface Overview {
  kpis: { active_agents: number; safe_agents: number; under_review: number; quarantined: number; blocked_today: number; critical_alerts: number };
  health: { score: number; label: string };
  agents: Agent[];
  pending_approvals: number;
  open_alerts: number;
  emergency_stop_active: boolean;
  ai_provider: string;
}

export interface Scenario {
  id: string;
  title: string;
  label: string;
  threat: string;
  description: string;
  agent_id: string;
  expected_decision: string;
  expected_agent_status: string;
  expected_summary: string;
  icon: string;
  in_lab: boolean;
  step_count: number;
}

export interface ScenarioResult {
  scenario: Scenario;
  agent: Agent;
  steps: { index: number; note: string; request: Record<string, unknown>; response: InterceptResponse }[];
  counts: { ALLOW: number; REVIEW: number; BLOCK: number };
  final_decision: Decision;
  final_event_id: string;
  agent_status: string;
  quarantined: boolean;
  alerts: number;
  passed: boolean;
}

export interface CapabilityGraph {
  agent: { id: string; name: string; purpose: string };
  nodes: { id: string; label: string; type: "agent" | "tool" | "service" | "resource"; status: CapStatus; depth: number }[];
  edges: { id: string; source: string; target: string; access: string; status: CapStatus }[];
  findings: {
    title: string; severity: string; transitive: boolean; label: string; nodes: string[]; node_ids: string[];
    resource: string; access: string; declared: string; recommendation: string;
  }[];
}
export type CapStatus = "intended" | "approval" | "denied" | "dangerous";

export interface Metrics {
  totals: {
    total_actions: number; allowed: number; blocked: number; review: number; critical_events: number; quarantined_agents: number;
    average_risk: number; top_risky_tool: string | null; top_risky_agent: string | null; prompt_injection_detections: number;
    policy_violations: number; tool_abuse_attempts: number;
  };
  series: { t: string; allow: number; review: number; block: number; avg_risk: number; max_risk: number }[];
  bucket_minutes: number;
  by_decision: { name: string; value: number }[];
  by_severity: { name: string; value: number }[];
  tool_usage: { tool: string; allow: number; review: number; block: number; total: number }[];
  agent_ranking: { agent: string; risk: number; blocked: number; status: string }[];
}

export interface AuditRecord {
  seq: number;
  event_id: string;
  timestamp: string;
  agent_id: string;
  agent_purpose: string;
  user_task: string;
  requested_tool: string;
  resource: string;
  arguments_summary: string;
  policy_result: string;
  llm_result: Record<string, unknown> | null;
  behavior_score: number;
  final_risk: number;
  decision: string;
  quarantine_state: string;
  alert_generated: boolean;
  admin_action: string | null;
  prev_hash: string;
  hash: string;
}

export interface AuditPage {
  total: number;
  records: AuditRecord[];
  integrity: { valid: boolean; records: number; broken_at_seq: number | null; head?: string };
}

export interface SystemSettings {
  threshold_medium: number;
  threshold_high: number;
  threshold_critical: number;
  auto_quarantine_enabled: boolean;
  blocked_retry_threshold: number;
  blocked_retry_window_seconds: number;
  global_policy_mode: "ENFORCE" | "STRICT";
  llm_judge_enabled: boolean;
  alert_channels: Record<string, boolean>;
  emergency_stop_active: boolean;
  ai_provider: string;
  ai_model: string;
  mock_mode: boolean;
  available_providers: string[];
  webhook_configured: boolean;
  database: string;
  risk_weights: Record<string, number>;
}

export interface PipelineJob {
  job: string;
  name: string;
  tool: string;
  resource: string;
  run: string;
  on_review: string;
  outcome: "success" | "waiting" | "failure";
  command_ran: boolean;
  response: InterceptResponse;
}

export interface PipelineRun {
  repository: string;
  run_id: string;
  agent: Agent;
  jobs: PipelineJob[];
}

export interface GithubIntegrationInfo {
  require_agent_token: boolean;
  demo_pipeline: { job: string; name: string; tool: string; resource: string; run: string; on_review: string }[];
}

export interface Catalog {
  tools: { name: string; category: string; description: string; sensitivity: number; default_resource: string; operation: string }[];
  resources: { name: string; sensitivity: number }[];
  quarantine_rules: string[];
}
