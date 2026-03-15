"""
Grocery Inventory Agent
=======================
A conversational agent (Hebrew) that manages a household grocery inventory.

Features:
  - Add / update / delete items with minimum threshold + restock cycle
  - Generate a shopping list with per-item reasons
  - Update inventory after a shopping trip

Storage: inventory.csv in the same directory.
Usage:   python grocery_agent.py
Requires: Claude Code CLI logged in with your Claude.ai subscription
"""

import csv
import io
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import re

import anyio
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    SystemMessage,
    TextBlock,
    create_sdk_mcp_server,
    tool,
)

# Ensure Hebrew (UTF-8) displays correctly on Windows terminals
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")

# ── Hebrew display fix (reverses RTL words for Windows terminals) ─────────────
def _fix_hebrew(text: str) -> str:
    """Reverse Hebrew words so they display correctly in Windows terminals."""
    def fix_phrase(phrase: str) -> str:
        words = phrase.split()
        reversed_chars = [w[::-1] for w in words]
        if len(words) > 1:
            reversed_chars = reversed_chars[::-1]
        return " ".join(reversed_chars)

    return re.sub(r'[\u0590-\u05FF][\u0590-\u05FF\s]*[\u0590-\u05FF]|[\u0590-\u05FF]+',
                  lambda m: fix_phrase(m.group()), text)


# ── File paths ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
INVENTORY_FILE = BASE_DIR / "inventory.csv"
LAST_LIST_FILE = BASE_DIR / "last_shopping_list.json"
CSV_FIELDS = [
    "item_name",
    "unit",
    "current_quantity",
    "desired_quantity",
    "days_until_restock",
    "last_purchased_date",
]


# ── Low-level CSV helpers ─────────────────────────────────────────────────────
def _load() -> list[dict]:
    if not INVENTORY_FILE.exists():
        return []
    with open(INVENTORY_FILE, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _save(items: list[dict]) -> None:
    with open(INVENTORY_FILE, encoding="utf-8-sig", newline="", mode="w") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(items)


# ── Tool implementations ──────────────────────────────────────────────────────
def _get_inventory(_args: dict) -> str:
    items = _load()
    if not items:
        return json.dumps(
            {"items": [], "message": "Inventory is empty. No items have been added yet."},
            ensure_ascii=False,
        )
    enriched = []
    for item in items:
        entry = dict(item)
        try:
            current = float(item["current_quantity"])
            desired = float(item["desired_quantity"])
            days_cycle = int(item["days_until_restock"])
            raw_date = item["last_purchased_date"]
            try:
                last_date = date.fromisoformat(raw_date)
            except ValueError:
                last_date = datetime.strptime(raw_date, "%d/%m/%Y").date()
            if current >= desired:
                next_purchase = last_date + timedelta(days=days_cycle)
                entry["next_purchase_date"] = next_purchase.isoformat()
            else:
                entry["next_purchase_date"] = "needed now"
        except (ValueError, KeyError):
            entry["next_purchase_date"] = "unknown"
        enriched.append(entry)
    return json.dumps({"items": enriched}, ensure_ascii=False, indent=2)


def _upsert_item(args: dict) -> str:
    name = args["item_name"]
    today = date.today().isoformat()
    record = {
        "item_name": name,
        "unit": args.get("unit", "units"),
        "current_quantity": str(args["current_quantity"]),
        "desired_quantity": str(args["desired_quantity"]),
        "days_until_restock": str(args["days_until_restock"]),
        "last_purchased_date": args.get("last_purchased_date", today),
    }

    items = _load()
    for i, item in enumerate(items):
        if item["item_name"] == name:
            items[i] = record
            _save(items)
            return json.dumps(
                {"success": True, "action": "updated", "item": name},
                ensure_ascii=False,
            )

    items.append(record)
    _save(items)
    return json.dumps(
        {"success": True, "action": "added", "item": name}, ensure_ascii=False
    )


def _delete_item(args: dict) -> str:
    name = args["item_name"]
    items = _load()
    new_items = [i for i in items if i["item_name"] != name]
    if len(new_items) == len(items):
        return json.dumps(
            {"success": False, "message": f"Item '{name}' not found."},
            ensure_ascii=False,
        )
    _save(new_items)
    return json.dumps(
        {"success": True, "message": f"Item '{name}' deleted."}, ensure_ascii=False
    )


def _parse_date(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return datetime.strptime(raw, "%d/%m/%Y").date()


def _generate_shopping_list(args: dict) -> str:
    dry_run = args.get("dry_run", False)
    items = _load()
    if not items:
        return json.dumps(
            {"message": "Inventory is empty.", "shopping_list": []}, ensure_ascii=False
        )

    today = date.today()
    updated = False
    depleted_preview = []

    # Preprocessing: if current >= desired and restock date has passed, deplete current
    for item in items:
        try:
            current = float(item["current_quantity"])
            desired = float(item["desired_quantity"])
            days_cycle = int(item["days_until_restock"])
            last_date = _parse_date(item["last_purchased_date"])
        except (ValueError, KeyError):
            continue
        if current >= desired and (last_date + timedelta(days=days_cycle)) <= today:
            new_current = round(current - desired, 2)
            if dry_run:
                depleted_preview.append({
                    "item_name": item["item_name"],
                    "current_before": current,
                    "depleted_by": desired,
                    "current_after": new_current,
                })
            item["current_quantity"] = str(new_current)
            updated = True

    if updated and not dry_run:
        _save(items)

    shopping_list = []

    for item in items:
        try:
            current = float(item["current_quantity"])
            desired = float(item["desired_quantity"])
            last_date = _parse_date(item["last_purchased_date"])
            days_cycle = int(item["days_until_restock"])
        except (ValueError, KeyError):
            continue

        if current < desired:
            entry = {
                "item_name": item["item_name"],
                "quantity_to_buy": round(desired - current, 2),
                "current_quantity": current,
            }
            if dry_run:
                entry["next_purchase_date"] = (last_date + timedelta(days=days_cycle)).isoformat()
            shopping_list.append(entry)

    if not shopping_list:
        result = {"message": "Everything is stocked! Nothing needs to be bought right now.", "shopping_list": []}
        if dry_run and depleted_preview:
            result["simulation_depletions"] = depleted_preview
        return json.dumps(result, ensure_ascii=False)

    if not dry_run:
        with open(LAST_LIST_FILE, "w", encoding="utf-8") as f:
            json.dump(shopping_list, f, ensure_ascii=False, indent=2)

    result = {"shopping_list": shopping_list}
    if dry_run:
        result["simulation"] = True
        result["note"] = "This is a simulation. The CSV was NOT updated."
        if depleted_preview:
            result["simulation_depletions"] = depleted_preview

    return json.dumps(result, ensure_ascii=False, indent=2)


def _confirm_shopping(args: dict) -> str:
    if not LAST_LIST_FILE.exists():
        return json.dumps(
            {"success": False, "message": "No shopping list found. Generate a list first."},
            ensure_ascii=False,
        )

    with open(LAST_LIST_FILE, encoding="utf-8") as f:
        shopping_list = json.load(f)

    bought_all = args.get("bought_all", True)
    if not bought_all:
        return json.dumps(
            {
                "success": True,
                "message": "Got it — inventory was not updated.",
                "items_skipped": [i["item_name"] for i in shopping_list],
            },
            ensure_ascii=False,
        )

    items = _load()
    today = date.today().isoformat()
    results = []

    for entry in shopping_list:
        name = entry["item_name"]
        qty_bought = float(entry["quantity_to_buy"])
        for item in items:
            if item["item_name"] == name:
                new_qty = float(item["current_quantity"]) + qty_bought
                item["current_quantity"] = str(round(new_qty, 2))
                item["last_purchased_date"] = today
                results.append({"item": name, "new_quantity": new_qty, "unit": item["unit"]})
                break

    _save(items)
    LAST_LIST_FILE.unlink(missing_ok=True)
    return json.dumps({"success": True, "updated": results}, ensure_ascii=False, indent=2)


# ── Agent SDK tool definitions ────────────────────────────────────────────────
@tool("get_inventory", "Read all current inventory items.", {})
async def sdk_get_inventory(args):
    return {"content": [{"type": "text", "text": _get_inventory(args)}]}


@tool(
    "upsert_item",
    "Add a new item to the inventory or update an existing one.",
    {
        "item_name": str,
        "unit": str,
        "current_quantity": float,
        "desired_quantity": float,
        "days_until_restock": int,
    },
)
async def sdk_upsert_item(args):
    return {"content": [{"type": "text", "text": _upsert_item(args)}]}


@tool("delete_item", "Delete an item from the inventory.", {"item_name": str})
async def sdk_delete_item(args):
    return {"content": [{"type": "text", "text": _delete_item(args)}]}


@tool(
    "generate_shopping_list",
    "Generate a shopping list based on the current inventory. Set dry_run=true to simulate without saving changes to the CSV.",
    {"dry_run": bool},
)
async def sdk_generate_shopping_list(args):
    return {"content": [{"type": "text", "text": _generate_shopping_list(args)}]}


@tool(
    "confirm_shopping",
    "Confirm that the last generated shopping list was completed. bought_all=true if everything was purchased, false if nothing was bought.",
    {"bought_all": bool},
)
async def sdk_confirm_shopping(args):
    return {"content": [{"type": "text", "text": _confirm_shopping(args)}]}


# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a smart assistant for managing a household kitchen inventory. Your job is to help the family track what they have at home and know when to buy more.

How the system works:
- Each item has: current quantity, minimum desired quantity, restock cycle (in days), and last purchase date.
- An item is added to the shopping list if: the current quantity has reached the minimum threshold, OR enough days have passed since the last purchase.

When adding a new item, collect the following information (you may ask multiple questions):
1. Item name (in Hebrew)
2. Unit of measurement (units, kg, liter, packs, etc.)
3. How much is there now
4. Minimum quantity to keep (when reached — item will be added to the list)
5. Approximately how many days between purchases

When displaying a shopping list (non-simulation), format it exactly like this — one item per line, nothing else:
(<current_quantity>) <item_name> <quantity_to_buy>
No headers, no bullet points, no intro, no outro, no table, no units.

When displaying a simulation shopping list, format it exactly like this — one item per line:
(<current_quantity>) <item_name> <quantity_to_buy> — next purchase: <next_purchase_date>
The next_purchase_date is last_purchased_date + days_until_restock. Compute it from the inventory data.
No headers, no bullet points, no intro, no outro, no table, no units.

When updating inventory after shopping, only update items that were actually purchased.

Always respond in English in a friendly tone. Item names should remain in Hebrew only — never translate or add the English name next to them."""


# ── Conversation loop ─────────────────────────────────────────────────────────
async def run() -> None:
    server = create_sdk_mcp_server(
        "grocery-tools",
        tools=[
            sdk_get_inventory,
            sdk_upsert_item,
            sdk_delete_item,
            sdk_generate_shopping_list,
            sdk_confirm_shopping,
        ],
    )

    session_id = None

    print("=" * 60)
    print("  Kitchen Assistant — Inventory & Shopping List Manager")
    print("=" * 60)
    print("Type 'exit' or 'quit' to quit.\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit"):
            print("Goodbye!")
            break

        options = ClaudeAgentOptions(
            system_prompt=SYSTEM_PROMPT if session_id is None else None,
            mcp_servers={"grocery": server},
            resume=session_id,
            permission_mode="bypassPermissions",
        )

        async with ClaudeSDKClient(options=options) as client:
            await client.query(user_input)
            async for message in client.receive_response():
                if isinstance(message, SystemMessage) and message.subtype == "init":
                    session_id = message.data.get("session_id")
                elif isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock) and block.text.strip():
                            print(f"\nAssistant: {_fix_hebrew(block.text)}\n")


if __name__ == "__main__":
    try:
        anyio.run(run)
    except KeyboardInterrupt:
        pass
