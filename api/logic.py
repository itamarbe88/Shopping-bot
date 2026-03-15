"""
Core grocery inventory logic — pure functions, no SDK dependencies.
Shared between grocery_agent.py (CLI) and api/main.py (FastAPI).
"""

import csv
import json
import secrets
import string
from datetime import date, datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"

CSV_FIELDS = [
    "item_name",
    "unit",
    "current_quantity",
    "desired_quantity",
    "days_until_restock",
    "last_purchased_date",
    "type",
]


# ── Path helpers ────────────────────────────────────────────────────────────────

def _household_dir(household_id: str) -> Path:
    p = DATA_DIR / "households" / household_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def _inventory_file(household_id: str) -> Path:
    return _household_dir(household_id) / "Inventory.csv"


def _last_list_file(household_id: str) -> Path:
    return _household_dir(household_id) / "last_shopping_list.json"


def _member_file(user_id: str) -> Path:
    p = DATA_DIR / "members"
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{user_id}.json"


# ── Household operations ────────────────────────────────────────────────────────

def get_household_id(user_id: str) -> str | None:
    f = _member_file(user_id)
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))["household_id"]


def create_household(user_id: str) -> str:
    household_id = "".join(
        secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6)
    )
    _household_dir(household_id)  # ensure directory exists

    # Migrate existing user data if present (old per-user path)
    old_csv = DATA_DIR / user_id / "Inventory.csv"
    new_csv = _inventory_file(household_id)
    if old_csv.exists() and not new_csv.exists():
        import shutil
        shutil.copy2(old_csv, new_csv)

    _member_file(user_id).write_text(
        json.dumps({"household_id": household_id}), encoding="utf-8"
    )
    return household_id


def join_household(user_id: str, household_id: str) -> bool:
    household_id = household_id.upper().strip()
    if not (DATA_DIR / "households" / household_id).exists():
        return False
    _member_file(user_id).write_text(
        json.dumps({"household_id": household_id}), encoding="utf-8"
    )
    return True


# ── CSV I/O ─────────────────────────────────────────────────────────────────────

def _load(household_id: str) -> list[dict]:
    f = _inventory_file(household_id)
    if not f.exists():
        return []
    with open(f, encoding="utf-8-sig", newline="") as fh:
        items = list(csv.DictReader(fh))
    for item in items:
        item.setdefault("type", "")
    return items


def _save(items: list[dict], household_id: str) -> None:
    with open(_inventory_file(household_id), encoding="utf-8-sig", newline="", mode="w") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(items)


def _parse_date(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return datetime.strptime(raw, "%d/%m/%Y").date()


# ── Public API ──────────────────────────────────────────────────────────────────

def get_inventory(household_id: str) -> list[dict]:
    items = _load(household_id)
    enriched = []
    for item in items:
        entry = dict(item)
        try:
            current = float(item["current_quantity"])
            desired = float(item["desired_quantity"])
            is_temp = item.get("type", "") == "temporary"
            if is_temp or not item.get("last_purchased_date"):
                entry["next_purchase_date"] = "needed now" if current < desired or is_temp else "unknown"
            else:
                days_cycle = int(item["days_until_restock"])
                last_date = _parse_date(item["last_purchased_date"])
                if current >= desired:
                    next_purchase = last_date + timedelta(days=days_cycle)
                    entry["next_purchase_date"] = next_purchase.isoformat()
                else:
                    entry["next_purchase_date"] = "needed now"
        except (ValueError, KeyError):
            entry["next_purchase_date"] = "unknown"
        enriched.append(entry)
    return enriched


def upsert_item(
    household_id: str,
    item_name: str,
    unit: str,
    current_quantity: int,
    desired_quantity: int,
    days_until_restock: int,
    last_purchased_date: str | None = None,
) -> dict:
    today = date.today().isoformat()
    record = {
        "item_name": item_name,
        "unit": unit or "",
        "current_quantity": str(int(current_quantity)),
        "desired_quantity": str(int(desired_quantity)),
        "days_until_restock": str(days_until_restock),
        "last_purchased_date": last_purchased_date or today,
    }
    items = _load(household_id)
    for i, item in enumerate(items):
        if item["item_name"] == item_name:
            items[i] = record
            _save(items, household_id)
            return {"success": True, "action": "updated", "item": item_name}
    items.append(record)
    _save(items, household_id)
    return {"success": True, "action": "added", "item": item_name}


def delete_item(household_id: str, item_name: str, item_type: str | None = None) -> dict:
    items = _load(household_id)
    if item_type is not None:
        new_items = [i for i in items if not (i["item_name"] == item_name and i.get("type", "") == item_type)]
    else:
        new_items = [i for i in items if i["item_name"] != item_name]
    if len(new_items) == len(items):
        return {"success": False, "message": f"Item '{item_name}' not found."}
    _save(new_items, household_id)
    return {"success": True, "message": f"Item '{item_name}' deleted."}


def generate_shopping_list(household_id: str, dry_run: bool = False) -> dict:
    items = _load(household_id)
    if not items:
        return {"shopping_list": [], "message": "Inventory is empty."}

    today = date.today()
    updated = False
    depleted_preview = []

    for item in items:
        if item.get("type", "") in ("temporary", "manual"):
            continue
        try:
            current = float(item["current_quantity"])
            desired = float(item["desired_quantity"])
            days_cycle = int(item["days_until_restock"])
            last_date = _parse_date(item["last_purchased_date"])
        except (ValueError, KeyError):
            continue
        if current >= desired and (last_date + timedelta(days=days_cycle)) <= today:
            new_current = int(current - desired)
            if dry_run:
                depleted_preview.append({
                    "item_name": item["item_name"],
                    "current_before": current,
                    "depleted_by": desired,
                    "current_after": new_current,
                })
            item["current_quantity"] = str(int(new_current))
            updated = True

    if updated and not dry_run:
        _save(items, household_id)

    shopping_list = []
    for item in items:
        try:
            current = float(item["current_quantity"])
            desired = float(item["desired_quantity"])
        except (ValueError, KeyError):
            continue

        item_type = item.get("type", "")
        is_temporary = item_type == "temporary"
        is_manual = item_type == "manual"
        needs_restock = current < desired or is_temporary or is_manual

        if needs_restock:
            raw_date = item.get("last_purchased_date", "")
            entry = {
                "item_name": item["item_name"],
                "quantity_to_buy": int(desired - current) if not (is_temporary or is_manual) else int(desired),
                "current_quantity": int(current),
                "is_temporary": is_temporary,
                "item_type": item_type,
                "last_purchased_date": raw_date if raw_date else None,
            }
            if not is_temporary and not is_manual and raw_date:
                try:
                    days_cycle = int(item["days_until_restock"])
                    last_date = _parse_date(raw_date)
                    entry["next_purchase_date"] = (last_date + timedelta(days=days_cycle)).isoformat()
                except (ValueError, KeyError):
                    pass
            shopping_list.append(entry)

    result: dict = {"shopping_list": shopping_list, "dry_run": dry_run}
    if dry_run:
        result["simulation_depletions"] = depleted_preview
    return result


def confirm_shopping(household_id: str, purchases: list[dict]) -> dict:
    items = _load(household_id)
    today = date.today().isoformat()
    results = []

    for purchase in purchases:
        name = purchase["item_name"]
        qty_bought = int(float(purchase["quantity_bought"]))
        for item in items:
            if item["item_name"] == name:
                item_type = item.get("type", "")
                if item_type in ("", "manual"):
                    new_qty = int(float(item["current_quantity"])) + qty_bought
                    item["current_quantity"] = str(new_qty)
                    item["last_purchased_date"] = today
                    if item_type == "manual":
                        item["type"] = ""
                    results.append({"item": name, "new_quantity": new_qty, "action": "updated"})
                break

    items = [i for i in items if i.get("type", "") not in {"temporary", "manual"}]
    _save(items, household_id)
    _last_list_file(household_id).unlink(missing_ok=True)
    return {"success": True, "updated": results}
