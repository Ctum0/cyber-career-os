"""RSS feed automation: pull feeds → queue → process into the knowledge graph.

All graph writes go through services.graph (canonical writer). The effective
feed list comes from the settings store ("rss.feeds").

Queue state machine: pending → processing → done | error.
Failed items are re-drivable via POST /ingest/queue/{id}/retry (sets pending).
Stale 'processing' rows (crashed mid-job) are requeued automatically at the
start of each processing pass.
"""
import asyncio
import logging
from datetime import datetime

import feedparser
import httpx

from ..core import settings_store
from ..core.database import get_db
from . import graph

log = logging.getLogger(__name__)

STALE_PROCESSING_MINUTES = 60


async def fetch_feed(url: str) -> list[dict]:
    """Fetch and parse an RSS feed. Raises on network errors."""
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    feed = feedparser.parse(resp.text)
    entries = []
    for entry in feed.entries[:5]:  # Latest 5 from each feed
        entries.append({
            "title": getattr(entry, "title", ""),
            "summary": getattr(entry, "summary", ""),
            "link": getattr(entry, "link", url),
        })
    return entries


async def ingest_rss_feeds() -> int:
    """Pull from RSS feeds and queue for processing. Returns queued count.

    Idempotent: entries whose URL is already queued (any status) are skipped.
    """
    feeds = await settings_store.get("rss.feeds", [])
    queued = 0
    db = await get_db()
    try:
        for feed_url in feeds:
            try:
                entries = await fetch_feed(feed_url)
            except Exception as e:
                log.warning("RSS fetch failed for %s: %s", feed_url, e)
                continue
            for entry in entries:
                existing = await db.execute(
                    "SELECT 1 FROM ingest_queue WHERE source_url = ? AND source_type = 'rss'",
                    (entry["link"],),
                )
                if await existing.fetchone():
                    continue
                content = f"{entry['title']}\n\n{entry['summary']}"
                await db.execute(
                    """INSERT INTO ingest_queue (source_type, source_url, raw_content, status)
                       VALUES ('rss', ?, ?, 'pending')""",
                    (entry["link"], content),
                )
                queued += 1
        await db.commit()
        log.info("RSS ingest: queued %d new items from %d feeds", queued, len(feeds))
    finally:
        await db.close()
    return queued


async def _requeue_stale_processing(db) -> int:
    """Requeue items stuck in 'processing' (e.g. crash mid-job)."""
    cursor = await db.execute(
        """UPDATE ingest_queue SET status = 'pending'
           WHERE status = 'processing'
             AND created_at < datetime('now', ?)""",
        (f"-{STALE_PROCESSING_MINUTES} minutes",),
    )
    return cursor.rowcount or 0


async def process_pending_ingests(limit: int = 20) -> dict:
    """Process pending queue items into the graph. Returns a summary dict.

    Each item is committed independently so one failure doesn't lose others.
    """
    from ..core.groq_client import extract_entities

    db = await get_db()
    processed = errors = 0
    try:
        requeued = await _requeue_stale_processing(db)
        if requeued:
            log.info("Requeued %d stale processing items", requeued)

        rows = await db.execute(
            "SELECT * FROM ingest_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
            (limit,),
        )
        items = await rows.fetchall()

        for item in items:
            await db.execute(
                "UPDATE ingest_queue SET status = 'processing' WHERE id = ?", (item["id"],)
            )
            await db.commit()
            try:
                entities = await extract_entities(item["raw_content"])
                source_label = item["source_url"] or f"{item['source_type']}_{item['id']}"
                source_id = await graph.create_source_node(
                    db, source_label, item["raw_content"][:200],
                    {"queue_id": item["id"], "source_type": item["source_type"]},
                )
                await graph.apply_entities(db, source_id, entities)
                await db.execute(
                    "UPDATE ingest_queue SET status = 'done', processed_at = datetime('now'),"
                    " error_message = NULL WHERE id = ?",
                    (item["id"],),
                )
                await db.commit()
                processed += 1
            except Exception as e:
                await db.execute(
                    "UPDATE ingest_queue SET status = 'error', error_message = ? WHERE id = ?",
                    (str(e)[:500], item["id"]),
                )
                await db.commit()
                errors += 1
                log.warning("Ingest item %d failed: %s", item["id"], e)
    finally:
        await db.close()

    if processed or errors:
        log.info("Processed %d queue items (%d errors)", processed, errors)
    return {"processed": processed, "errors": errors}


def run_rss_ingest():
    """Sync wrapper for external cron (README documents this contract)."""
    asyncio.run(ingest_rss_feeds())


def run_process_pending():
    """Sync wrapper for external cron."""
    asyncio.run(process_pending_ingests())
