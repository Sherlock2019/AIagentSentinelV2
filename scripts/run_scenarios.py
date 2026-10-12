#!/usr/bin/env python3
"""Run every red-team scenario through the real gateway and print a scorecard.

    python scripts/run_scenarios.py                 # all scenarios
    python scripts/run_scenarios.py secret_access   # just one

Uses the configured database directly (no server needed). All targets are simulated.
Exits non-zero if any scenario deviates from its expected outcome.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.database.db import SessionLocal  # noqa: E402
from app.database.seed import seed  # noqa: E402
from app.simulator.scenarios import SCENARIOS, run_scenario  # noqa: E402


def main() -> int:
    wanted = set(sys.argv[1:])
    unknown = wanted - {s.id for s in SCENARIOS}
    if unknown:
        print(f"Unknown scenario(s): {', '.join(sorted(unknown))}")
        print(f"Available: {', '.join(s.id for s in SCENARIOS)}")
        return 2

    failures = 0
    with SessionLocal() as db:
        seed(db)
        print(f"{'SCENARIO':<24}{'AGENT':<24}{'DECISION':<10}{'RISK':<6}{'AGENT STATE':<14}RESULT")
        print("-" * 86)
        for scenario in SCENARIOS:
            if wanted and scenario.id not in wanted:
                continue
            result = run_scenario(db, scenario)
            final = result["steps"][-1]["response"]
            ok = result["passed"]
            failures += 0 if ok else 1
            print(
                f"{scenario.id:<24}{result['agent']['name']:<24}{final['decision']:<10}{final['risk_score']:<6}"
                f"{result['agent_status']:<14}{'PASS' if ok else 'FAIL (expected ' + scenario.expected_summary + ')'}"
            )
    print("-" * 86)
    print("All scenarios produced their expected outcome." if not failures else f"{failures} scenario(s) deviated.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
