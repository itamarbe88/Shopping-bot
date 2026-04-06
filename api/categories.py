# ── Item category map ───────────────────────────────────────────────────────────
# Edit categories.csv (two columns: item_name, category) to add or change categories.

import csv
from pathlib import Path

_CSV_PATH = Path(__file__).parent / "categories.csv"

def _load() -> dict[str, str]:
    with open(_CSV_PATH, encoding="utf-8-sig") as f:
        return {row["item_name"]: row["category"] for row in csv.DictReader(f) if row.get("item_name")}

ITEM_CATEGORIES: dict[str, str] = _load()
