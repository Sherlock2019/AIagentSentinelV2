from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.database.settings_store import get_settings
from app.schemas import RedTeamRun
from app.simulator.scenarios import SCENARIOS, get_scenario, run_scenario

router = APIRouter(prefix="/api/redteam", tags=["redteam"])


@router.get("/scenarios")
def scenarios() -> list[dict[str, Any]]:
    return [s.to_dict() for s in SCENARIOS]


@router.post("/run")
def run(body: RedTeamRun, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Run a SIMULATED attack through the real Sentinel pipeline."""
    scenario = get_scenario(body.scenario_id)
    if scenario is None:
        raise HTTPException(404, f"Unknown scenario '{body.scenario_id}'")
    if get_settings(db)["emergency_stop_active"]:
        raise HTTPException(409, "Emergency stop is active — every action is refused. Release it (Settings or Security Operations) to run scenarios.")
    return run_scenario(db, scenario)
