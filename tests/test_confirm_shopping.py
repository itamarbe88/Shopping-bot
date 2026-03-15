"""
Unit tests for confirm_shopping covering all three item types:
  ""         - regular inventory item
  "manual"   - manually added inventory item
  "temporary"- temporary non-inventory item
"""
from datetime import date
from unittest.mock import MagicMock, patch

import pytest


def _make_item(name, current, item_type=""):
    return {
        "item_name": name,
        "unit": "",
        "current_quantity": str(current),
        "desired_quantity": "1",
        "days_until_restock": "7",
        "last_purchased_date": "2026-01-01",
        "type": item_type,
    }


INITIAL_INVENTORY = [
    _make_item("חלב", 2, ""),           # regular
    _make_item("כרוב", 0, "manual"),    # manual → should become ""
    _make_item("עגבניות שרי", 0, "temporary"),  # temporary → should be deleted
]

PURCHASES = [
    {"item_name": "חלב", "quantity_bought": 3},
    {"item_name": "כרוב", "quantity_bought": 1},
    {"item_name": "עגבניות שרי", "quantity_bought": 2},
]

TODAY = "2026-03-14"


@pytest.fixture
def saved_items():
    """Captures the list passed to _save."""
    captured = {}

    def fake_save(items):
        captured["items"] = items

    return captured, fake_save


def run_confirm(saved_items_fixture):
    captured, fake_save = saved_items_fixture
    import copy

    inventory = copy.deepcopy(INITIAL_INVENTORY)
    mock_last_list = MagicMock()

    with (
        patch("api.logic._load", return_value=inventory),
        patch("api.logic._save", side_effect=fake_save),
        patch("api.logic.date") as mock_date,
        patch("api.logic.LAST_LIST_FILE", mock_last_list),
    ):
        mock_date.today.return_value.isoformat.return_value = TODAY
        from api.logic import confirm_shopping
        result = confirm_shopping(PURCHASES)

    return result, captured["items"]


def test_returns_success(saved_items):
    result, _ = run_confirm(saved_items)
    assert result["success"] is True


def test_regular_item_quantity_updated(saved_items):
    _, items = run_confirm(saved_items)
    חלב = next(i for i in items if i["item_name"] == "חלב")
    assert חלב["current_quantity"] == "5"   # 2 + 3


def test_regular_item_date_updated(saved_items):
    _, items = run_confirm(saved_items)
    חלב = next(i for i in items if i["item_name"] == "חלב")
    assert חלב["last_purchased_date"] == TODAY


def test_regular_item_type_unchanged(saved_items):
    _, items = run_confirm(saved_items)
    חלב = next(i for i in items if i["item_name"] == "חלב")
    assert חלב["type"] == ""


def test_manual_item_quantity_updated(saved_items):
    _, items = run_confirm(saved_items)
    כרוב = next(i for i in items if i["item_name"] == "כרוב")
    assert כרוב["current_quantity"] == "1"   # 0 + 1


def test_manual_item_date_updated(saved_items):
    _, items = run_confirm(saved_items)
    כרוב = next(i for i in items if i["item_name"] == "כרוב")
    assert כרוב["last_purchased_date"] == TODAY


def test_manual_item_promoted_to_regular(saved_items):
    _, items = run_confirm(saved_items)
    כרוב = next(i for i in items if i["item_name"] == "כרוב")
    assert כרוב["type"] == ""


def test_temporary_item_deleted(saved_items):
    _, items = run_confirm(saved_items)
    names = [i["item_name"] for i in items]
    assert "עגבניות שרי" not in names


def test_only_two_items_remain(saved_items):
    _, items = run_confirm(saved_items)
    assert len(items) == 2


def test_two_updated_in_results(saved_items):
    result, _ = run_confirm(saved_items)
    # Only regular and manual are updated; temporary is silently deleted
    assert len(result["updated"]) == 2
    updated_names = {r["item"] for r in result["updated"]}
    assert updated_names == {"חלב", "כרוב"}
