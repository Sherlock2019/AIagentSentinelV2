from __future__ import annotations

import csv
import io
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.models import AuditLog
from app.sentinel import audit

router = APIRouter(prefix="/api/audit", tags=["audit"])


def _query(db: Session, agent_id: Optional[str], decision: Optional[str], tool: Optional[str]):
    query = db.query(AuditLog)
    if agent_id:
        query = query.filter(AuditLog.agent_id == agent_id)
    if decision:
        query = query.filter(AuditLog.decision.contains(decision.upper()))
    if tool:
        query = query.filter(AuditLog.requested_tool.contains(tool))
    return query.order_by(AuditLog.id.desc())


@router.get("")
def list_audit(
    db: Session = Depends(get_db),
    agent_id: Optional[str] = None,
    decision: Optional[str] = None,
    tool: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=2000),
) -> dict[str, Any]:
    query = _query(db, agent_id, decision, tool)
    return {"total": query.count(), "records": [r.to_dict() for r in query.limit(limit).all()], "integrity": audit.verify_chain(db)}


@router.get("/verify")
def verify(db: Session = Depends(get_db)) -> dict[str, Any]:
    return audit.verify_chain(db)


@router.get("/export")
def export(
    db: Session = Depends(get_db),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    agent_id: Optional[str] = None,
    decision: Optional[str] = None,
    tool: Optional[str] = None,
) -> Response:
    records = [r.to_dict() for r in _query(db, agent_id, decision, tool).all()]
    if format == "csv":
        buffer = io.StringIO()
        if records:
            writer = csv.DictWriter(buffer, fieldnames=list(records[0].keys()))
            writer.writeheader()
            for record in records:
                writer.writerow({k: json.dumps(v) if isinstance(v, (dict, list)) else v for k, v in record.items()})
        body, media = buffer.getvalue(), "text/csv"
    else:
        body, media = json.dumps(records, indent=2), "application/json"
    return Response(body, media_type=media, headers={"Content-Disposition": f'attachment; filename="agentsentinel-audit.{format}"'})
