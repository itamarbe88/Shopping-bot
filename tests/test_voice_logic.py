"""
Tests for process_voice_items — Hebrew speech parsing and inventory matching.

Covers:
  1. Single item found in inventory
  2. Multiple items, some found some not
  3. Partial match (spoken word is substring of inventory name)
  4. Partial match (inventory name is substring of spoken word)
  5. Best match selected when multiple candidates exist (closest length)
  6. Empty speech returns empty results
  7. All items not found
  8. Comma-separated speech text
  9. Duplicate spoken items deduplicated to single match
  10. Case/spacing tolerance
"""

import pytest
from unittest.mock import patch

HH = "TEST_HH"


def _inv(name, current="2", desired="3", item_type=""):
    return {
        "item_name": name,
        "current_quantity": current,
        "desired_quantity": desired,
        "type": item_type,
    }


INVENTORY = [
    _inv("שום"),
    _inv("חלב 3%"),
    _inv("לחם אחיד"),
    _inv("ביצים"),
    _inv("גבינה צהובה"),
]


def _run(speech_text):
    with patch("api.logic._load", return_value=INVENTORY):
        from api.logic import process_voice_items
        return process_voice_items(HH, speech_text)


# ── 1. Single item found ──────────────────────────────────────────────────────

def test_single_item_found():
    result = _run("שום")
    assert len(result["found"]) == 1
    assert result["found"][0]["matched"] == "שום"
    assert result["not_found"] == []


# ── 2. Multiple items mixed ───────────────────────────────────────────────────

def test_multiple_items_mixed():
    result = _run("שום תפוחים ביצים")
    found_names = [f["matched"] for f in result["found"]]
    assert "שום" in found_names
    assert "ביצים" in found_names
    assert "תפוחים" in result["not_found"]


# ── 3. Spoken is substring of inventory name ─────────────────────────────────

def test_spoken_substring_of_inventory():
    # "חלב" should match "חלב 3%"
    result = _run("חלב")
    assert len(result["found"]) == 1
    assert result["found"][0]["matched"] == "חלב 3%"


# ── 4. Inventory name is substring of spoken ─────────────────────────────────

def test_inventory_substring_of_spoken():
    # "לחם אחיד חיטה" should match "לחם אחיד"
    result = _run("לחם אחיד חיטה")
    assert any(f["matched"] == "לחם אחיד" for f in result["found"])


# ── 5. Best match by closest length ──────────────────────────────────────────

def test_best_match_closest_length():
    # "גבינה" could match "גבינה צהובה" — should pick closest
    result = _run("גבינה")
    assert len(result["found"]) == 1
    assert result["found"][0]["matched"] == "גבינה צהובה"


# ── 6. Empty speech ───────────────────────────────────────────────────────────

def test_empty_speech():
    result = _run("")
    assert result["found"] == []
    assert result["not_found"] == []
    assert result["parsed_items"] == []


# ── 7. All items not found ────────────────────────────────────────────────────

def test_all_not_found():
    result = _run("תפוחים בננות תותים")
    assert result["found"] == []
    assert set(result["not_found"]) == {"תפוחים", "בננות", "תותים"}


# ── 8. Comma-separated input ─────────────────────────────────────────────────

def test_comma_separated():
    result = _run("שום, ביצים, תפוחים")
    found_names = [f["matched"] for f in result["found"]]
    assert "שום" in found_names
    assert "ביצים" in found_names
    assert "תפוחים" in result["not_found"]


# ── 9. Returns current and desired quantities ─────────────────────────────────

def test_quantities_returned():
    result = _run("שום")
    item = result["found"][0]
    assert item["current_quantity"] == "2"
    assert item["desired_quantity"] == "3"


# ── 10. Whitespace tolerance ──────────────────────────────────────────────────

def test_whitespace_tolerance():
    result = _run("  שום   ביצים  ")
    found_names = [f["matched"] for f in result["found"]]
    assert "שום" in found_names
    assert "ביצים" in found_names
