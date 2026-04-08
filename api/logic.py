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

from api.categories import ITEM_CATEGORIES

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

    def _delete_prefix(prefix: str) -> None:
        for blob in _bucket.list_blobs(prefix=prefix):
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

    def _delete_prefix(prefix: str) -> None:
        import shutil
        p = DATA_DIR / prefix
        if p.exists():
            shutil.rmtree(p)


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


def _image_path(household_id: str, item_name: str) -> str:
    safe = item_name.replace("/", "_").replace(" ", "_")
    return f"households/{household_id}/images/{safe}.jpg"


def save_item_image(household_id: str, item_name: str, image_bytes: bytes) -> None:
    _write(_image_path(household_id, item_name), image_bytes)


def delete_item_image(household_id: str, item_name: str) -> None:
    _delete(_image_path(household_id, item_name))


def get_item_image(household_id: str, item_name: str) -> bytes | None:
    return _read(_image_path(household_id, item_name))


def item_has_image(household_id: str, item_name: str) -> bool:
    return _exists(_image_path(household_id, item_name))


def list_items_with_images(household_id: str) -> list[str]:
    """Return item names that have an image stored."""
    prefix = f"households/{household_id}/images/"
    if GCS_BUCKET:
        blobs = _gcs_client.list_blobs(_bucket, prefix=prefix)
        names = []
        for blob in blobs:
            filename = blob.name[len(prefix):]  # e.g. "שום.jpg"
            if filename.endswith(".jpg"):
                item_name = filename[:-4].replace("_", " ")
                names.append(item_name)
        return names
    else:
        import os
        images_dir = DATA_DIR / prefix
        if not images_dir.exists():
            return []
        return [f.stem.replace("_", " ") for f in images_dir.glob("*.jpg")]


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
    # A household exists if its inventory OR its placeholder directory exists.
    # New households may not have any items yet, so we check both.
    inv = _inventory_path(household_id)
    placeholder = f"households/{household_id}/"
    if not _exists(inv) and not _exists(placeholder):
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
    record = {
        "item_name": item_name, "unit": unit or "",
        "current_quantity": str(int(current_quantity)),
        "desired_quantity": str(int(desired_quantity)),
        "days_until_restock": str(days_until_restock),
        "last_purchased_date": last_purchased_date or "",
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
        if item_type == "on_hold":
            continue
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

    if not dry_run:
        existing_overrides = {i["item_name"]: i["quantity_to_buy"] for i in read_last_list(household_id)}
        for item in shopping_list:
            if item["item_name"] in existing_overrides:
                item["quantity_to_buy"] = existing_overrides[item["item_name"]]
        write_last_list(household_id, shopping_list)

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



# ── Onboarding template ───────────────────────────────────────────────────────

ONBOARDING_TEMPLATE_PATH = "templates/Onboarding.csv"

def get_onboarding_template() -> list[dict]:
    data = _read(ONBOARDING_TEMPLATE_PATH)
    if data is None:
        return []
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
    return [{"item_name": row["item_name"].strip(), "category": row["category"].strip()} for row in reader if row.get("item_name", "").strip()]


# ── Voice inventory ─────────────────────────────────────────────────────────────

def process_voice_items(household_id: str, speech_text: str) -> dict:
    """
    Parse Hebrew speech text into grocery items by splitting on common delimiters,
    then match each item against the inventory using contains matching.
    """
    import re
    # Split on commas, "ו" conjunctions, or multiple spaces
    raw_tokens = re.split(r"[,،\s]+", speech_text.strip())
    parsed_items = [t.strip() for t in raw_tokens if t.strip()]

    inventory = _load(household_id)

    found = []
    not_found = []

    for spoken in parsed_items:
        spoken_clean = spoken.strip()
        # Contains matching in both directions (e.g. "חלב" matches "חלב 3%" and vice versa)
        matches = [
            inv for inv in inventory
            if inv.get("type", "") != "on_hold"
            and (spoken_clean in inv["item_name"] or inv["item_name"] in spoken_clean)
        ]
        if matches:
            for match in matches:
                found.append({
                    "spoken": spoken_clean,
                    "matched": match["item_name"],
                    "current_quantity": match.get("current_quantity", "0"),
                    "desired_quantity": match.get("desired_quantity", "1"),
                })
        else:
            not_found.append(spoken_clean)

    return {
        "found": found,
        "not_found": not_found,
        "raw_text": speech_text,
        "parsed_items": parsed_items,
    }


# ── Account deletion ─────────────────────────────────────────────────────────────

def delete_account(user_id: str) -> None:
    """Delete all data associated with a user: their member file and household data."""
    hh = get_household_id(user_id)
    _delete(_member_path(user_id))
    if hh:
        _delete_prefix(f"households/{hh}/")


def set_item_on_hold(household_id: str, item_name: str, on_hold: bool) -> dict:
    items = _load(household_id)
    for item in items:
        if item["item_name"] == item_name:
            item["type"] = "on_hold" if on_hold else ""
            _save(items, household_id)
            return {"success": True}
    return {"success": False, "message": f"Item '{item_name}' not found."}


# ── Item categories (static map, no external API needed) ────────────────────────

def get_category_for_item(item_name: str) -> str:
    """Exact match first, then substring match (e.g. 'גבינה 5%' matches key 'גבינה')."""
    if item_name in ITEM_CATEGORIES:
        return ITEM_CATEGORIES[item_name]
    for known_name, category in ITEM_CATEGORIES.items():
        if known_name in item_name or item_name in known_name:
            return category
    return "שונות"


def get_categories_for_items(item_names: list[str]) -> dict:
    """Return { item_name: category } for a list of items."""
    return {name: get_category_for_item(name) for name in item_names}
