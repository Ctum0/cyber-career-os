"""Settings store — reads/writes app settings from the SQLite `settings` table.

All values are JSON-encoded strings. The cache is populated on first read and
updated on every write, so callers get fast repeated access without hitting DB.

This is the single runtime source of truth for configuration. DEFAULTS chain
to env bootstrap values from config.py; feature code resolves effective
values via get() (or `value or config.ENV_VALUE` where env must win last).
"""
import json
import os
from typing import Any

from . import config
from .database import get_db

# In-memory cache, populated lazily.
_cache: dict[str, Any] = {}
_loaded = False

# Defaults — used when a key has never been set. Chain to env bootstrap.
DEFAULTS: dict[str, Any] = {
    # AI Provider
    "ai.provider": os.getenv("AI_PROVIDER", "groq"),   # "groq" | "openai" | "custom"
    "ai.base_url": os.getenv("AI_BASE_URL", ""),        # custom endpoint (e.g. http://localhost:11434/v1)
    "ai.api_key": config.GROQ_API_KEY,                  # provider API key (.env bootstrap; Settings UI overrides)
    "ai.model": config.GROQ_MODEL,                       # default model ID (empty = provider default)
    "ai.vision_model": config.GROQ_VISION_MODEL,         # vision model ID
    "ai.task_models": {},                 # {"entity_extraction": "model-id", ...}

    # Obsidian (empty string / 0 = fall back to env bootstrap in config.py)
    "obsidian.vault_path": "",
    "obsidian.scan_interval_minutes": 0,
    "obsidian.required_tags": [],
    "obsidian.include_folders": [],
    "obsidian.exclude_folders": [],
    "obsidian.max_notes_per_scan": 0,
    "obsidian.max_images_per_note": 0,
    "obsidian.max_image_size": 0,

    # RSS
    "rss.feeds": config.RSS_FEEDS,

    # Advanced — learning behaviour
    "advanced.confidence_decay_amount": 5,
    "advanced.confidence_decay_days": 7,
}


async def _ensure_loaded():
    global _loaded
    if _loaded:
        return
    db = await get_db()
    try:
        rows = await db.execute("SELECT key, value FROM settings")
        for row in await rows.fetchall():
            try:
                _cache[row["key"]] = json.loads(row["value"])
            except (json.JSONDecodeError, TypeError):
                _cache[row["key"]] = row["value"]
    finally:
        await db.close()
    # Apply defaults for unset keys
    for key, default in DEFAULTS.items():
        if key not in _cache:
            _cache[key] = default
    _loaded = True


async def get(key: str, default: Any = None) -> Any:
    """Get a setting value. Returns default if not set."""
    await _ensure_loaded()
    return _cache.get(key, default if default is not None else DEFAULTS.get(key))


async def get_all() -> dict[str, Any]:
    """Get all settings as a flat dict."""
    await _ensure_loaded()
    merged = dict(DEFAULTS)
    merged.update(_cache)
    return merged


async def set(key: str, value: Any):
    """Set a single setting. Updates cache and persists to DB."""
    await _ensure_loaded()
    _cache[key] = value
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (key, json.dumps(value)),
        )
        await db.commit()
    finally:
        await db.close()


async def set_many(pairs: dict[str, Any]):
    """Set multiple settings at once."""
    await _ensure_loaded()
    db = await get_db()
    try:
        for key, value in pairs.items():
            _cache[key] = value
            await db.execute(
                """INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
                (key, json.dumps(value)),
            )
        await db.commit()
    finally:
        await db.close()


async def get_group(prefix: str) -> dict[str, Any]:
    """Get all settings with a given prefix, stripped of the prefix."""
    await _ensure_loaded()
    result = {}
    for key, value in _cache.items():
        if key.startswith(prefix):
            result[key[len(prefix):]] = value
    # Also include defaults not yet in cache
    for key, default in DEFAULTS.items():
        if key.startswith(prefix) and key not in _cache:
            result[key[len(prefix):]] = default
    return result


def invalidate_cache():
    """Force reload on next access. Useful after external DB changes."""
    global _loaded
    _loaded = False
    _cache.clear()
