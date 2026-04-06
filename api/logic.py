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

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

HEBREW_CATEGORIES = [
    "ירקות ופירות",
    "מוצרי חלב וגבינות",
    "בשר ועוף ודגים",
    "לחם ומאפים",
    "קפואים",
    "שימורים וקטניות",
    "חטיפים וממתקים",
    "משקאות",
    "ניקיון וטיפוח",
    "אחר",
]

GLOBAL_CATEGORIES_PATH = "global/item_categories.json"

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


def set_item_on_hold(household_id: str, item_name: str, on_hold: bool) -> dict:
    items = _load(household_id)
    for item in items:
        if item["item_name"] == item_name:
            item["type"] = "on_hold" if on_hold else ""
            _save(items, household_id)
            return {"success": True}
    return {"success": False, "message": f"Item '{item_name}' not found."}


# ── Global item categories ───────────────────────────────────────────────────────

def _load_categories() -> dict:
    data = _read(GLOBAL_CATEGORIES_PATH)
    if data is None:
        return {}
    return json.loads(data.decode("utf-8"))


def _save_categories(categories: dict) -> None:
    _write(GLOBAL_CATEGORIES_PATH, json.dumps(categories, ensure_ascii=False, indent=2).encode("utf-8"))


def get_category_for_item(item_name: str, categories: dict) -> str:
    """Exact match first, then substring match (e.g. 'גבינה' matches 'גבינה 5%')."""
    if item_name in categories:
        return categories[item_name]
    for known_name, category in categories.items():
        if known_name in item_name or item_name in known_name:
            return category
    return "אחר"


def get_categories_for_items(item_names: list[str]) -> dict:
    """Return { item_name: category } for a list of items, using the global map."""
    categories = _load_categories()
    return {name: get_category_for_item(name, categories) for name in item_names}


def _categorize_with_claude(item_names: list[str]) -> dict:
    """Call Claude API to categorize a batch of Hebrew item names. Returns { item_name: category }."""
    if not ANTHROPIC_API_KEY:
        return {}
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        categories_list = "\n".join(f"- {c}" for c in HEBREW_CATEGORIES)
        items_list = "\n".join(item_names)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": (
                    f"אתה עוזר לסווג פריטי מכולת לקטגוריות של סופרמרקט.\n"
                    f"הקטגוריות האפשריות הן:\n{categories_list}\n\n"
                    f"סווג כל פריט מהרשימה הבאה לאחת מהקטגוריות.\n"
                    f"החזר JSON בלבד בפורמט: {{\"שם פריט\": \"קטגוריה\", ...}}\n\n"
                    f"פריטים לסיווג:\n{items_list}"
                ),
            }],
        )
        text = message.content[0].text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception:
        return {}


def categorize_new_items() -> dict:
    """
    Scan all household inventories + onboarding template for item names not yet
    in the global categories map. Categorize them with Claude and save.
    Returns { added: int, total: int }.
    """
    categories = _load_categories()

    # Collect all known item names across all households + onboarding template
    all_items: set[str] = set()

    # From onboarding template
    template = get_onboarding_template()
    print(f"[CATEGORIZE] Onboarding template items: {len(template)}")
    for row in template:
        all_items.add(row["item_name"])

    # From all household inventories — list blobs under households/
    if GCS_BUCKET:
        try:
            blobs = list(_bucket.list_blobs(prefix="households/"))
            household_ids = set()
            for blob in blobs:
                parts = blob.name.split("/")
                if len(parts) >= 2:
                    household_ids.add(parts[1])
            print(f"[CATEGORIZE] Found {len(household_ids)} households")
            for hh_id in household_ids:
                for item in _load(hh_id):
                    all_items.add(item["item_name"])
        except Exception as e:
            print(f"[CATEGORIZE] GCS scan error: {e}")
    else:
        # Local dev: scan data/households/
        households_dir = Path(__file__).parent.parent / "data" / "households"
        if households_dir.exists():
            for hh_dir in households_dir.iterdir():
                if hh_dir.is_dir():
                    for item in _load(hh_dir.name):
                        all_items.add(item["item_name"])

    # Find items not yet categorized (no exact or substring match)
    new_items = [
        name for name in all_items
        if get_category_for_item(name, categories) == "אחר"
        and name not in categories
    ]

    print(f"[CATEGORIZE] Total items: {len(all_items)}, new to categorize: {len(new_items)}")
    if not new_items:
        return {"added": 0, "total": len(categories)}

    result = _categorize_with_claude(new_items)
    categories.update(result)
    _save_categories(categories)

    return {"added": len(result), "total": len(categories)}


def seed_categories_from_onboarding() -> None:
    """Seed the global categories map from the onboarding template if it doesn't exist yet."""
    if _exists(GLOBAL_CATEGORIES_PATH):
        return
    template = get_onboarding_template()
    item_names = [row["item_name"] for row in template if row.get("item_name")]
    if not item_names:
        return
    result = _categorize_with_claude(item_names)
    if result:
        _save_categories(result)
