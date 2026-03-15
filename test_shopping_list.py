"""
Tests for shopping list generation logic.
Covers preprocessing (depletion) and list inclusion rules.
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")
from datetime import date, datetime, timedelta

today = date.today()
past = (today - timedelta(days=10)).isoformat()   # 10 days ago, exceeds any 7-day cycle
future = (today + timedelta(days=5)).isoformat()
today_str = today.isoformat()


def _parse_date(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return datetime.strptime(raw, "%d/%m/%Y").date()


def run_pipeline(items: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Simulate the preprocessing + shopping list generation.
    Returns (updated_items, shopping_list).
    Items are dicts with: current_quantity, desired_quantity, days_until_restock, last_purchased_date.
    """
    items = [dict(i) for i in items]  # copy

    # --- Preprocessing ---
    for item in items:
        current = float(item["current_quantity"])
        desired = float(item["desired_quantity"])
        days_cycle = int(item["days_until_restock"])
        last_date = _parse_date(item["last_purchased_date"])
        if current >= desired and (last_date + timedelta(days=days_cycle)) <= today:
            item["current_quantity"] = str(round(current - desired, 2))

    # --- Shopping list ---
    shopping_list = []
    for item in items:
        current = float(item["current_quantity"])
        desired = float(item["desired_quantity"])
        if current < desired:
            shopping_list.append({
                "name": item["item_name"],
                "quantity_to_buy": round(desired - current, 2),
                "current_quantity": current,
            })

    return items, shopping_list


def check(label: str, condition: bool):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}")


def run_tests():
    print("=" * 60)
    print("SHOPPING LIST LOGIC TESTS")
    print("=" * 60)

    # ----------------------------------------------------------------
    # CASE 1: current < desired -> must appear in shopping list
    # ----------------------------------------------------------------
    print("\nCase 1: current < desired -> item should be in list")
    items = [{"item_name": "חלב", "current_quantity": "1", "desired_quantity": "3",
              "days_until_restock": "7", "last_purchased_date": future}]
    updated, sl = run_pipeline(items)
    check("חלב in shopping list", any(i["name"] == "חלב" for i in sl))
    check("quantity_to_buy = 2", sl[0]["quantity_to_buy"] == 2.0)
    check("current NOT changed by preprocess (date in future)", float(updated[0]["current_quantity"]) == 1.0)

    # ----------------------------------------------------------------
    # CASE 2a: current >= desired, date NOT passed -> must NOT be in list, current unchanged
    # ----------------------------------------------------------------
    print("\nCase 2a: current >= desired, restock date in future -> NOT in list, current unchanged")
    items = [{"item_name": "תפוחים", "current_quantity": "5", "desired_quantity": "3",
              "days_until_restock": "7", "last_purchased_date": future}]
    updated, sl = run_pipeline(items)
    check("תפוחים NOT in shopping list", not any(i["name"] == "תפוחים" for i in sl))
    check("current_quantity unchanged (still 5)", float(updated[0]["current_quantity"]) == 5.0)

    # ----------------------------------------------------------------
    # CASE 2b: current == desired, date NOT passed -> NOT in list
    # ----------------------------------------------------------------
    print("\nCase 2b: current == desired, restock date in future -> NOT in list")
    items = [{"item_name": "גבינה", "current_quantity": "2", "desired_quantity": "2",
              "days_until_restock": "7", "last_purchased_date": future}]
    updated, sl = run_pipeline(items)
    check("גבינה NOT in shopping list", not any(i["name"] == "גבינה" for i in sl))
    check("current_quantity unchanged (still 2)", float(updated[0]["current_quantity"]) == 2.0)

    # ----------------------------------------------------------------
    # CASE 3a: current == desired, date passed -> preprocess depletes to 0 -> in list
    # ----------------------------------------------------------------
    print("\nCase 3a: current == desired, restock date passed -> depleted to 0 -> in list")
    items = [{"item_name": "ביצים", "current_quantity": "4", "desired_quantity": "4",
              "days_until_restock": "7", "last_purchased_date": past}]
    updated, sl = run_pipeline(items)
    check("current depleted to 0", float(updated[0]["current_quantity"]) == 0.0)
    check("ביצים in shopping list", any(i["name"] == "ביצים" for i in sl))
    check("quantity_to_buy = 4", sl[0]["quantity_to_buy"] == 4.0)

    # ----------------------------------------------------------------
    # CASE 3b: current > desired, date passed -> preprocess depletes -> may or may not be in list
    # ----------------------------------------------------------------
    print("\nCase 3b: current=6, desired=2, date passed -> depleted to 4 -> NOT in list (4 >= 2)")
    items = [{"item_name": "אשל", "current_quantity": "6", "desired_quantity": "2",
              "days_until_restock": "7", "last_purchased_date": past}]
    updated, sl = run_pipeline(items)
    check("current depleted to 4", float(updated[0]["current_quantity"]) == 4.0)
    check("אשל NOT in list (4 >= 2)", not any(i["name"] == "אשל" for i in sl))

    print("\nCase 3c: current=3, desired=2, date passed -> depleted to 1 -> IN list (1 < 2)")
    items = [{"item_name": "שמן", "current_quantity": "3", "desired_quantity": "2",
              "days_until_restock": "7", "last_purchased_date": past}]
    updated, sl = run_pipeline(items)
    check("current depleted to 1", float(updated[0]["current_quantity"]) == 1.0)
    check("שמן IN list (1 < 2)", any(i["name"] == "שמן" for i in sl))
    check("quantity_to_buy = 1", sl[0]["quantity_to_buy"] == 1.0)

    # ----------------------------------------------------------------
    # CASE 3d: restock date is exactly today -> should preprocess
    # ----------------------------------------------------------------
    print("\nCase 3d: current == desired, restock date = today -> depleted -> in list")
    items = [{"item_name": "לחם", "current_quantity": "2", "desired_quantity": "2",
              "days_until_restock": "0", "last_purchased_date": today_str}]
    updated, sl = run_pipeline(items)
    check("current depleted to 0", float(updated[0]["current_quantity"]) == 0.0)
    check("לחם in list", any(i["name"] == "לחם" for i in sl))

    print("\n" + "=" * 60)


if __name__ == "__main__":
    run_tests()
