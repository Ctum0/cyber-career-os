"""Tests for the settings store: defaults, cache, persistence."""
import asyncio

import pytest

import app.core.database as dbmod
from app.core import settings_store


@pytest.fixture(autouse=True)
def _reset_cache():
    settings_store.invalidate_cache()
    yield
    settings_store.invalidate_cache()


def test_defaults_served_without_rows():
    async def run():
        return await settings_store.get("ai.provider"), await settings_store.get("rss.feeds")

    provider, feeds = asyncio.run(run())
    assert provider == "groq"
    assert isinstance(feeds, list) and len(feeds) > 0


def test_set_then_get_roundtrip():
    async def run():
        await settings_store.set("ai.provider", "openai")
        got = await settings_store.get("ai.provider")
        settings_store.invalidate_cache()
        # persisted across a cache reset
        got_after_reload = await settings_store.get("ai.provider")
        return got, got_after_reload

    got, after = asyncio.run(run())
    assert got == "openai"
    assert after == "openai"


def test_get_group_strips_prefix():
    async def run():
        await settings_store.set_many({
            "advanced.confidence_decay_amount": 8,
            "advanced.confidence_decay_days": 14,
        })
        return await settings_store.get_group("advanced.")

    group = asyncio.run(run())
    assert group["confidence_decay_amount"] == 8
    assert group["confidence_decay_days"] == 14


def test_secret_key_stored_but_maskable():
    async def run():
        await settings_store.set("ai.api_key", "sk-live-abc123")
        value = await settings_store.get("ai.api_key")
        return value

    assert asyncio.run(run()) == "sk-live-abc123"
    # Masking is the API layer's responsibility (api/settings.py), not the store's.
