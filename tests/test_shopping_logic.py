"""
System tests for generate_shopping_list and confirm_shopping.

Display logic:
  1. current < desired                              → buy desired - current (always)
  2. current == desired, date arrived               → buy desired
  3. current > desired, date arrived, qty > 0       → buy desired - (current - desired)
  4. current >= 2*desired, date arrived             → skip (consumption applied on confirm)
  5. current >= desired, date NOT arrived           → skip

Confirm logic:
  A. Purchased, current < desired                   → new = current + qty_bought
  B. Purchased, current >= desired                  → new = current - desired + qty_bought
  C. Not purchased, current >= 2*desired, date arr  → new = current - desired
  D. Not purchased, current < 2*desired             → unchanged
"""

import copy
from datetime import date, timedelta
from unittest.mock import patch

import pytest

TODAY = date(2026, 3, 16)
PAST = (TODAY - timedelta(days=10)).isoformat()   # date arrived
FUTURE = (TODAY + timedelta(days=10)).isoformat() # date NOT arrived
HH = "TEST_HH"


def _item(name, current, desired, days=7, last=PAST, item_type=""):
    return {
        "item_name": name,
        "unit": "",
        "current_quantity": str(current),
        "desired_quantity": str(desired),
        "days_until_restock": str(days),
        "last_purchased_date": last,
        "type": item_type,
    }


def _run_generate(inventory, today=TODAY):
    with (
        patch("api.logic._load", return_value=copy.deepcopy(inventory)),
        patch("api.logic._save"),
        patch("api.logic._delete"),
        patch("api.logic.date") as mock_date,
    ):
        mock_date.today.return_value = today
        from api.logic import generate_shopping_list
        return generate_shopping_list(HH, dry_run=False)


def _run_confirm(inventory, purchases, today=TODAY):
    saved = {}

    def fake_save(items, hh):
        saved["items"] = copy.deepcopy(items)

    with (
        patch("api.logic._load", return_value=copy.deepcopy(inventory)),
        patch("api.logic._save", side_effect=fake_save),
        patch("api.logic._delete"),
        patch("api.logic.date") as mock_date,
    ):
        mock_date.today.return_value = today
        mock_date.today.return_value.isoformat.return_value = today.isoformat()
        from api.logic import confirm_shopping
        result = confirm_shopping(HH, purchases)

    return result, saved.get("items", [])


# ── generate_shopping_list ───────────────────────────────────────────────────

class TestGenerateShoppingList:

    def test_case1_shortfall_always_included(self):
        """current < desired → buy desired - current, regardless of date."""
        inv = [_item("חלב", current=1, desired=3, last=FUTURE)]
        result = _run_generate(inv)
        items = {i["item_name"]: i for i in result["shopping_list"]}
        assert "חלב" in items
        assert items["חלב"]["quantity_to_buy"] == 2  # 3 - 1

    def test_case1_shortfall_buy_qty(self):
        """current=2, desired=5 → buy 3."""
        inv = [_item("תפוחים", current=2, desired=5)]
        result = _run_generate(inv)
        items = {i["item_name"]: i for i in result["shopping_list"]}
        assert items["תפוחים"]["quantity_to_buy"] == 3

    def test_case2_equal_date_arrived_included(self):
        """current == desired, date arrived → buy desired."""
        inv = [_item("חלב", current=3, desired=3, last=PAST)]
        result = _run_generate(inv)
        items = {i["item_name"]: i for i in result["shopping_list"]}
        assert "חלב" in items
        assert items["חלב"]["quantity_to_buy"] == 3

    def test_case2_equal_date_not_arrived_excluded(self):
        """current == desired, date NOT arrived → skip."""
        inv = [_item("חלב", current=3, desired=3, last=FUTURE)]
        result = _run_generate(inv)
        names = [i["item_name"] for i in result["shopping_list"]]
        assert "חלב" not in names

    def test_case3_excess_date_arrived_included(self):
        """current > desired, date arrived, qty > 0 → buy desired - (current - desired)."""
        inv = [_item("חלב", current=5, desired=4, last=PAST)]
        result = _run_generate(inv)
        items = {i["item_name"]: i for i in result["shopping_list"]}
        assert "חלב" in items
        assert items["חלב"]["quantity_to_buy"] == 3  # 4 - (5 - 4) = 3

    def test_case3_excess_date_not_arrived_excluded(self):
        """current > desired, date NOT arrived → skip."""
        inv = [_item("חלב", current=5, desired=4, last=FUTURE)]
        result = _run_generate(inv)
        names = [i["item_name"] for i in result["shopping_list"]]
        assert "חלב" not in names

    def test_case4_double_stock_excluded(self):
        """current >= 2*desired, date arrived → skip from list."""
        inv = [_item("מיץ", current=4, desired=2, last=PAST)]  # 4 >= 2*2
        result = _run_generate(inv)
        names = [i["item_name"] for i in result["shopping_list"]]
        assert "מיץ" not in names

    def test_case4_qty_zero_excluded(self):
        """current == 2*desired → qty would be 0 → skip."""
        inv = [_item("חלב", current=6, desired=3, last=PAST)]
        result = _run_generate(inv)
        names = [i["item_name"] for i in result["shopping_list"]]
        assert "חלב" not in names

    def test_case5_excess_no_date_excluded(self):
        """current > desired, date not arrived → skip."""
        inv = [_item("חלב", current=10, desired=5, last=FUTURE)]
        result = _run_generate(inv)
        names = [i["item_name"] for i in result["shopping_list"]]
        assert "חלב" not in names

    def test_temporary_always_included(self):
        """Temporary items always appear."""
        inv = [_item("פריט זמני", current=0, desired=2, item_type="temporary")]
        result = _run_generate(inv)
        names = [i["item_name"] for i in result["shopping_list"]]
        assert "פריט זמני" in names

    def test_manual_always_included(self):
        """Manual items always appear."""
        inv = [_item("פריט ידני", current=1, desired=2, item_type="manual")]
        result = _run_generate(inv)
        names = [i["item_name"] for i in result["shopping_list"]]
        assert "פריט ידני" in names


# ── confirm_shopping ─────────────────────────────────────────────────────────

class TestConfirmShopping:

    def test_caseA_shortfall_adds_bought(self):
        """current < desired → new = current + qty_bought."""
        inv = [_item("חלב", current=1, desired=3)]
        _, items = _run_confirm(inv, [{"item_name": "חלב", "quantity_bought": 2}])
        חלב = next(i for i in items if i["item_name"] == "חלב")
        assert int(חלב["current_quantity"]) == 3  # 1 + 2

    def test_caseA_shortfall_reaches_desired(self):
        """Buying desired - current brings stock to exactly desired."""
        inv = [_item("חלב", current=2, desired=5)]
        _, items = _run_confirm(inv, [{"item_name": "חלב", "quantity_bought": 3}])
        חלב = next(i for i in items if i["item_name"] == "חלב")
        assert int(חלב["current_quantity"]) == 5

    def test_caseB_equal_date_triggered(self):
        """current == desired → new = current - desired + qty_bought = qty_bought."""
        inv = [_item("חלב", current=3, desired=3)]
        _, items = _run_confirm(inv, [{"item_name": "חלב", "quantity_bought": 3}])
        חלב = next(i for i in items if i["item_name"] == "חלב")
        assert int(חלב["current_quantity"]) == 3  # 3 - 3 + 3

    def test_caseB_excess_date_triggered(self):
        """current=5, desired=4, buy=3 → new = 5 - 4 + 3 = 4."""
        inv = [_item("חלב", current=5, desired=4)]
        _, items = _run_confirm(inv, [{"item_name": "חלב", "quantity_bought": 3}])
        חלב = next(i for i in items if i["item_name"] == "חלב")
        assert int(חלב["current_quantity"]) == 4

    def test_caseB_date_updated_on_purchase(self):
        """last_purchased_date updated to today when item is purchased."""
        inv = [_item("חלב", current=1, desired=3)]
        _, items = _run_confirm(inv, [{"item_name": "חלב", "quantity_bought": 2}])
        חלב = next(i for i in items if i["item_name"] == "חלב")
        assert חלב["last_purchased_date"] == TODAY.isoformat()

    def test_caseC_overstocked_consumption_applied(self):
        """current >= 2*desired, date arrived, not purchased → current = current - desired."""
        inv = [_item("מיץ", current=4, desired=2, last=PAST)]
        _, items = _run_confirm(inv, [])  # not purchased
        מיץ = next(i for i in items if i["item_name"] == "מיץ")
        assert int(מיץ["current_quantity"]) == 2  # 4 - 2

    def test_caseC_overstocked_date_updated(self):
        """Overstocked consumption also updates last_purchased_date."""
        inv = [_item("מיץ", current=4, desired=2, last=PAST)]
        _, items = _run_confirm(inv, [])
        מיץ = next(i for i in items if i["item_name"] == "מיץ")
        assert מיץ["last_purchased_date"] == TODAY.isoformat()

    def test_caseC_overstocked_date_not_arrived_unchanged(self):
        """current >= 2*desired but date NOT arrived → no consumption."""
        inv = [_item("מיץ", current=4, desired=2, last=FUTURE)]
        _, items = _run_confirm(inv, [])
        מיץ = next(i for i in items if i["item_name"] == "מיץ")
        assert int(מיץ["current_quantity"]) == 4  # unchanged

    def test_caseD_moderate_excess_not_purchased_unchanged(self):
        """current > desired but < 2*desired, not purchased → unchanged."""
        inv = [_item("חלב", current=5, desired=4, last=PAST)]
        _, items = _run_confirm(inv, [])
        חלב = next(i for i in items if i["item_name"] == "חלב")
        assert int(חלב["current_quantity"]) == 5  # unchanged

    def test_manual_promoted_to_regular(self):
        """Manual item becomes regular after purchase."""
        inv = [_item("כרוב", current=0, desired=1, item_type="manual")]
        _, items = _run_confirm(inv, [{"item_name": "כרוב", "quantity_bought": 1}])
        כרוב = next(i for i in items if i["item_name"] == "כרוב")
        assert כרוב["type"] == ""

    def test_temporary_removed_after_confirm(self):
        """Temporary items are removed from inventory after purchase."""
        inv = [_item("פריט זמני", current=0, desired=1, item_type="temporary")]
        _, items = _run_confirm(inv, [{"item_name": "פריט זמני", "quantity_bought": 1}])
        names = [i["item_name"] for i in items]
        assert "פריט זמני" not in names
