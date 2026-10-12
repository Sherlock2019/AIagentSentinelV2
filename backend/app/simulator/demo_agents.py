"""The four seeded demo agents and their declared intent (policy)."""
from __future__ import annotations

from typing import Any

from app.sentinel.policy_engine import QUARANTINE_RULES


def _policy(name, purpose, allow, approval, deny, res_allow, res_deny, rate, cost=1.0, network=None) -> dict[str, Any]:
    return {
        "agent": name,
        "purpose": purpose,
        "allow": allow,
        "require_approval": approval,
        "deny": deny,
        "resources": {"allow": res_allow, "deny": res_deny},
        "network": {"allow": network or []},
        "limits": {"rate_per_minute": rate, "cost_per_minute_usd": cost},
        "quarantine_rules": list(QUARANTINE_RULES),
    }


DEMO_AGENTS: list[dict[str, Any]] = [
    {
        "id": "customer-support-agent",
        "name": "CustomerSupportAgent",
        "purpose": "Answer customer support questions and create tickets.",
        "owner": "Support Engineering",
        "environment": "production-sim",
        "risk_sensitivity": "MEDIUM",
        "policy": _policy(
            "CustomerSupportAgent",
            ["customer_support"],
            ["search_kb", "get_ticket", "create_ticket", "workflow_api"],
            ["refund_customer"],
            ["read_secret", "execute_shell", "modify_iam", "delete_customer", "customer_db_write"],
            # Declared READ ONLY on the customer database.
            ["knowledge_base", "support_db", "workflow", "crm", "payments", "customer_database:READ"],
            ["production_secrets", "payroll", "iam", "customer_database:WRITE", "customer_database:DELETE"],
            rate=30,
        ),
    },
    {
        "id": "research-agent",
        "name": "ResearchAgent",
        "purpose": "Search and summarize public / synthetic knowledge.",
        "owner": "Strategy Team",
        "environment": "production-sim",
        "risk_sensitivity": "MEDIUM",
        "policy": _policy(
            "ResearchAgent",
            ["market_research"],
            ["web_search_sim", "read_public_doc", "summarize"],
            [],
            ["upload_external", "read_private_db", "execute_shell"],
            ["public_web", "public_docs", "workspace"],
            ["private_db", "production_secrets", "external_network", "customer_database"],
            rate=20,
        ),
    },
    {
        "id": "coding-agent",
        "name": "CodingAgent",
        "purpose": "Read code, run tests and suggest patches.",
        "owner": "Platform Engineering",
        "environment": "production-sim",
        "risk_sensitivity": "MEDIUM",
        "policy": _policy(
            "CodingAgent",
            ["code_review"],
            ["read_repo", "run_tests", "generate_patch"],
            ["apply_patch"],
            ["read_prod_secret", "deploy_prod", "modify_iam", "disable_logging"],
            ["source_repo", "ci_sandbox"],
            ["production_secrets", "production", "iam", "audit_log", "sentinel_policy"],
            rate=40,
        ),
    },
    {
        "id": "finance-agent",
        "name": "FinanceAgent",
        "purpose": "Analyze synthetic financial transactions.",
        "owner": "Finance Operations",
        "environment": "production-sim",
        "risk_sensitivity": "HIGH",
        "policy": _policy(
            "FinanceAgent",
            ["financial_analysis"],
            ["read_transaction", "calculate_summary"],
            ["create_payment_request"],
            ["execute_payment", "modify_account", "export_customer_database"],
            ["transactions", "payments"],
            ["accounts", "customer_database", "production_secrets", "external_network"],
            rate=25,
        ),
    },
]

# Downstream reachability that policies alone cannot see (tool -> service -> resource).
SERVICE_EDGES: list[tuple[str, str, str]] = [
    ("workflow_api", "crm_service", "CALLS"),
    ("workflow_api", "admin_endpoint", "CALLS"),
    ("crm_service", "customer_database", "READ"),
    ("admin_endpoint", "customer_database", "WRITE"),
]

# Benign history replayed through the real gateway at seed time: (minutes ago, agent, task, tool, resource, arguments).
WARMUP_TRAFFIC: list[tuple[int, str, str, str, str, dict[str, Any]]] = [
    (352, "customer-support-agent", "Where is my order?", "get_ticket", "support_db/TICKET-1031", {}),
    (348, "customer-support-agent", "Where is my order?", "search_kb", "knowledge_base/shipping-times", {"query": "delivery times"}),
    (331, "research-agent", "Summarize the 2026 cloud market", "web_search_sim", "public_web/cloud-market-2026", {"query": "cloud market 2026"}),
    (329, "research-agent", "Summarize the 2026 cloud market", "read_public_doc", "public_docs/annual-report", {}),
    (326, "research-agent", "Summarize the 2026 cloud market", "summarize", "workspace/notes", {}),
    (301, "coding-agent", "Review the billing module", "read_repo", "source_repo/payments-service", {"ref": "main"}),
    (298, "coding-agent", "Review the billing module", "run_tests", "ci_sandbox/payments-service", {}),
    (276, "finance-agent", "Summarize Q3 spend", "read_transaction", "transactions/2026-Q3", {"limit": 250}),
    (274, "finance-agent", "Summarize Q3 spend", "calculate_summary", "transactions/2026-Q3", {}),
    (243, "customer-support-agent", "Customer cannot log in", "search_kb", "knowledge_base/account-recovery", {"query": "cannot log in"}),
    (241, "customer-support-agent", "Customer cannot log in", "create_ticket", "support_db/new", {"subject": "Login issue"}),
    (214, "coding-agent", "Fix flaky checkout test", "read_repo", "source_repo/checkout-service", {}),
    (211, "coding-agent", "Fix flaky checkout test", "generate_patch", "source_repo/checkout-service", {}),
    (186, "research-agent", "Compare open-source vector databases", "web_search_sim", "public_web/vector-databases", {"query": "vector database comparison"}),
    (183, "research-agent", "Compare open-source vector databases", "summarize", "workspace/notes", {}),
    (158, "customer-support-agent", "Look up customer order history", "workflow_api", "workflow/crm-lookup", {"endpoint": "crm_service", "action": "get_orders"}),
    (131, "finance-agent", "Monthly vendor spend report", "read_transaction", "transactions/2026-09", {"limit": 400}),
    (129, "finance-agent", "Monthly vendor spend report", "calculate_summary", "transactions/2026-09", {}),
    (104, "coding-agent", "Review pull request #482", "read_repo", "source_repo/payments-service", {"ref": "pr-482"}),
    (101, "coding-agent", "Review pull request #482", "run_tests", "ci_sandbox/payments-service", {}),
    (77, "customer-support-agent", "How do refunds work?", "search_kb", "knowledge_base/refund-policy", {"query": "refund policy"}),
    (52, "research-agent", "Brief on EU AI regulation", "read_public_doc", "public_docs/eu-ai-act-summary", {}),
    (49, "research-agent", "Brief on EU AI regulation", "summarize", "workspace/notes", {}),
    (33, "finance-agent", "Check duplicate invoices", "read_transaction", "transactions/2026-10", {"limit": 120}),
    (21, "coding-agent", "Review this application source code", "read_repo", "source_repo/storefront", {}),
    (14, "customer-support-agent", "Customer asks about warranty", "search_kb", "knowledge_base/warranty", {"query": "warranty"}),
]
