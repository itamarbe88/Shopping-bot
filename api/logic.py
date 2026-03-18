"""
Core grocery inventory logic.
Storage: Google Cloud Storage when GCS_BUCKET is set, local filesystem otherwise.
"""

import csv
import io
import json
import os
import secrets
import string
from datetime import date, datetime, timedelta
from pathlib import Path

# ── Storage backend ─────────────────────────────────────────────────────────────

GCS_BUCKET = os.environ.get("GCS_BUCKET")

if GCS_BUCKET:
    from google.cloud import storage as gcs
    _gcs_client = gcs.Client()
    _bucket = _gcs_client.bucket(GCS_BUCKET)

    def _read(path: str) -> bytes | None:
        blob = _bucket.blob(path)
        if not blob.exists():
            return None
        return blob.download_as_bytes()

    def _write(path: str, data: bytes) -> None:
        _bucket.blob(path).upload_from_string(data)

    def _exists(path: str) -> bool:
        return _bucket.blob(path).exists()

    def _delete(path: str) -> None:
        blob = _bucket.blob(path)
        if blob.exists():
            blob.delete()

else:
    BASE_DIR = Path(__file__).parent.parent
    DATA_DIR = BASE_DIR / "data"

    def _read(path: str) -> bytes | None:
        p = DATA_DIR / path
        if not p.exists():
            return None
        return p.read_bytes()

    def _write(path: str, data: bytes) -> None:
        p = DATA_DIR / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def _exists(path: str) -> bool:
        return (DATA_DIR / path).exists()

    def _delete(path: str) -> None:
        p = DATA_DIR / path
        if p.exists():
            p.unlink()


# ── Path helpers ────────────────────────────────────────────────────────────────

CSV_FIELDS = [
    "item_name", "unit", "current_quantity", "desired_quantity",
    "days_until_restock", "last_purchased_date", "type",
]


def _inventory_path(household_id: str) -> str:
    return f"households/{household_id}/Inventory.csv"


def _last_list_path(household_id: str) -> str:
    return f"households/{household_id}/last_shopping_list.json"


def _member_path(user_id: str) -> str:
    return f"members/{user_id}.json"


# ── Household operations ────────────────────────────────────────────────────────

def get_household_id(user_id: str) -> str | None:
    data = _read(_member_path(user_id))
    if data is None:
        return None
    return json.loads(data)["household_id"]


def create_household(user_id: str) -> str:
    household_id = "".join(
        secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6)
    )

    # Migrate existing local user data if present
    if not GCS_BUCKET:
        from pathlib import Path
        BASE_DIR = Path(__file__).parent.parent
        old_csv = BASE_DIR / "data" / user_id / "Inventory.csv"
        if old_csv.exists() and not _exists(_inventory_path(household_id)):
            _write(_inventory_path(household_id), old_csv.read_bytes())

    _write(_member_path(user_id), json.dumps({"household_id": household_id}).encode())
    # Create the household folder placeholder in GCS
    _write(f"households/{household_id}/", b"")
    return household_id


def join_household(user_id: str, household_id: str) -> bool:
    household_id = household_id.upper().strip()
    # A household exists if its inventory path exists OR if the directory was just created
    # We check by seeing if any member maps to this household, or inventory exists
    # Simplest: just trust the code and create the member mapping
    # But we need some validation — check if inventory exists or it was just generated
    inv = _inventory_path(household_id)
    member_data = _read(_member_path(user_id))
    # Allow joining if inventory exists or we accept any 6-char code from known households
    # Check: does at least the households/<id>/ prefix have any object?
    if not _exists(inv):
        # No inventory yet — could be a brand new household with no items
        # We'll allow joining if the code length is valid (trusting the creator)
        # To be safe, require inventory to exist (creator must have opened the app)
        return False
    _write(_member_path(user_id), json.dumps({"household_id": household_id}).encode())
    return True


# ── CSV I/O ─────────────────────────────────────────────────────────────────────

def _load(household_id: str) -> list[dict]:
    data = _read(_inventory_path(household_id))
    if data is None:
        return []
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
    items = list(reader)
    for item in items:
        item.setdefault("type", "")
    return items


def _save(items: list[dict], household_id: str) -> None:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerows(items)
    _write(_inventory_path(household_id), buf.getvalue().encode("utf-8-sig"))


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
                    entry["next_purchase_date"] = (last_date + timedelta(days=days_cycle)).isoformat()
                else:
                    entry["next_purchase_date"] = "needed now"
        except (ValueError, KeyError):
            entry["next_purchase_date"] = "unknown"
        enriched.append(entry)
    return enriched


def upsert_item(household_id: str, item_name: str, unit: str, current_quantity: int,
                desired_quantity: int, days_until_restock: int,
                last_purchased_date: str | None = None) -> dict:
    today = date.today().isoformat()
    record = {
        "item_name": item_name, "unit": unit or "",
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
    shopping_list = []

    for item in items:
        item_type = item.get("type", "")
        is_temporary = item_type == "temporary"
        is_manual = item_type == "manual"

        if is_temporary or is_manual:
            raw_date = item.get("last_purchased_date", "")
            shopping_list.append({
                "item_name": item["item_name"],
                "quantity_to_buy": int(float(item.get("desired_quantity", 1))),
                "current_quantity": int(float(item.get("current_quantity", 0))),
                "is_temporary": is_temporary,
                "item_type": item_type,
                "last_purchased_date": raw_date if raw_date else None,
            })
            continue

        try:
            current = float(item["current_quantity"])
            desired = float(item["desired_quantity"])
            days_cycle = int(item["days_until_restock"])
            last_date = _parse_date(item["last_purchased_date"])
        except (ValueError, KeyError):
            continue

        date_arrived = (last_date + timedelta(days=days_cycle)) <= today

        if current < desired:
            qty_to_buy = int(desired - current)
            purchase_reason = "shortage"
        elif current == desired and date_arrived:
            qty_to_buy = int(desired)
            purchase_reason = "overdue"
        elif current > desired and date_arrived:
            qty_to_buy = int(desired - (current - desired))
            if qty_to_buy <= 0:
                continue
            purchase_reason = "overdue"
        else:
            continue

        raw_date = item.get("last_purchased_date", "")
        entry = {
            "item_name": item["item_name"],
            "quantity_to_buy": qty_to_buy,
            "current_quantity": int(current),
            "is_temporary": False,
            "item_type": item_type,
            "purchase_reason": purchase_reason,
            "last_purchased_date": raw_date if raw_date else None,
        }
        try:
            entry["next_purchase_date"] = (
                last_date + timedelta(days=days_cycle)
            ).isoformat()
        except Exception:
            pass
        shopping_list.append(entry)

    return {"shopping_list": shopping_list, "dry_run": dry_run}


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
                    current = float(item["current_quantity"])
                    desired = float(item.get("desired_quantity", 0))
                    if current >= desired:
                        # date-triggered: account for consumption of one cycle
                        new_qty = int(current - desired + qty_bought)
                    else:
                        # shortfall: just add what was bought
                        new_qty = int(current + qty_bought)
                    item["current_quantity"] = str(new_qty)
                    item["last_purchased_date"] = today
                    if item_type == "manual":
                        item["type"] = ""
                    results.append({"item": name, "new_quantity": new_qty, "action": "updated"})
                break
    items = [i for i in items if i.get("type", "") not in {"temporary", "manual"}]
    _save(items, household_id)
    _delete(_last_list_path(household_id))
    return {"success": True, "updated": results}


# ── Last shopping list helpers (used by main.py) ────────────────────────────────

def read_last_list(household_id: str) -> list:
    data = _read(_last_list_path(household_id))
    if data is None:
        return []
    return json.loads(data)


def write_last_list(household_id: str, items: list) -> None:
    _write(_last_list_path(household_id), json.dumps(items, ensure_ascii=False).encode())


def delete_last_list(household_id: str) -> None:
    _delete(_last_list_path(household_id))
