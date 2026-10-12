"""Single source of time so seeding and tests can replay history deterministically."""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

_frozen: Optional[datetime] = None


def utcnow() -> datetime:
    """Naive UTC timestamp (what we store in the database)."""
    return _frozen or datetime.now(timezone.utc).replace(tzinfo=None)


@contextmanager
def frozen(at: datetime) -> Iterator[None]:
    global _frozen
    previous, _frozen = _frozen, at
    try:
        yield
    finally:
        _frozen = previous


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat(timespec="milliseconds") + "Z" if dt else None


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"
