"""Helpers to normalize JSON-encoded SQLite columns at the API boundary.

Several tables store lists/dicts as JSON strings. The frontend must not know
that: every router converts storage representation into application
representation (real lists/dicts) before responding.
"""
import json
from typing import Any


def as_list(value: Any) -> list:
    """Parse a JSON-encoded list column. Falls back to [] on malformed data."""
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def as_dict(value: Any) -> dict:
    """Parse a JSON-encoded object column. Falls back to {} on malformed data."""
    if value is None or value == "":
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}
