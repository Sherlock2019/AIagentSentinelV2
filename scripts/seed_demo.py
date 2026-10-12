#!/usr/bin/env python3
"""Re-create the reproducible demo dataset.

    python scripts/seed_demo.py            # seed only if the database is empty
    python scripts/seed_demo.py --reset    # wipe everything and re-seed
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.database.seed import main  # noqa: E402

if __name__ == "__main__":
    main()
