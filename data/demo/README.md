# Demo data

Everything AgentSentinel shows is synthetic and generated in code, so the demo is reproducible:

| What | Where it is defined |
| --- | --- |
| The four demo agents and their policies | `backend/app/simulator/demo_agents.py` |
| Simulated tools and resource classes | `backend/app/simulator/demo_tools.py` |
| Red-team scenarios | `backend/app/simulator/scenarios.py` |
| Baseline traffic replayed at seed time | `WARMUP_TRAFFIC` in `demo_agents.py` |

- `../policies/*.yaml` — the live policies, exported as YAML each time the backend starts or a policy is saved.
- `../fixtures/` — example gateway request and the poisoned document used by the prompt-injection scenario.
- `../agentsentinel.db` — the SQLite database (created on first run, ignored by git).

Reset to the original dataset with `python scripts/seed_demo.py --reset` or **Settings → Reset demo data**.
