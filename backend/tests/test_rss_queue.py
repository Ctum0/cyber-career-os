"""Tests for RSS queue handling with mocked feeds (no network)."""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest

import app.core.database as dbmod
from app.services import rss


def test_ingest_rss_feeds_dedupes_by_url(monkeypatch):
    async def run():
        feeds = ["https://example.com/feed.xml"]
        entries = [
            {"title": "Item One", "summary": "s1", "link": "https://example.com/a"},
            {"title": "Item Two", "summary": "s2", "link": "https://example.com/b"},
        ]
        with patch.object(rss, "fetch_feed", AsyncMock(return_value=entries)):
            with patch.object(rss.settings_store, "get", AsyncMock(return_value=feeds)):
                first = await rss.ingest_rss_feeds()
                # Second run: same entries → nothing new queued
                second = await rss.ingest_rss_feeds()
        return first, second

    first, second = asyncio.run(run())
    assert first == 2
    assert second == 0


def test_stale_processing_rows_are_requeued():
    async def scenario():
        db = await dbmod.get_db()
        await db.execute(
            "INSERT INTO ingest_queue (source_type, raw_content, status, created_at)"
            " VALUES ('rss', 'stale item', 'processing', datetime('now', '-2 hours'))"
        )
        await db.commit()
        result = await rss.process_pending_ingests()
        row = await (await db.execute("SELECT status FROM ingest_queue")).fetchone()
        # After requeue, the item gets processed (fallback extraction path) → done
        await db.close()
        return result, row["status"]

    result, status = asyncio.run(scenario())
    assert status in ("done", "error")  # never left stuck in processing/pending


def test_failed_item_marked_error_not_lost():
    async def scenario():
        db = await dbmod.get_db()
        await db.execute(
            "INSERT INTO ingest_queue (source_type, raw_content, status)"
            " VALUES ('rss', 'item that will fail', 'pending')"
        )
        await db.commit()

        async def boom(content):
            raise RuntimeError("LLM exploded")

        with patch("app.core.groq_client.extract_entities", boom):
            await rss.process_pending_ingests()
        row = await (await db.execute("SELECT status, error_message FROM ingest_queue")).fetchone()
        await db.close()
        return row["status"], row["error_message"]

    status, error = asyncio.run(scenario())
    assert status == "error"
    assert "LLM exploded" in error
