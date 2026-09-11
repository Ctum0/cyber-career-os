"""Regression tests for the P0 correctness fixes:

1. find_node: read-side lookup by normalized identity (raw-label reads
   previously missed nodes whose display casing differed).
2. Confidence decay is rerun-safe within the same UTC day (manual trigger +
   weekly job cannot double-decay).
"""
from datetime import datetime, timedelta, timezone

import pytest

import app.core.database as dbmod
from app.services import graph

pytestmark = pytest.mark.asyncio


async def test_find_node_matches_normalized_label():
    """A skill stored as 'Packet Analysis' must be findable via any variant."""
    db = await dbmod.get_db()
    try:
        created = await graph.find_or_create_node(db, "skill", "Packet Analysis")
        assert await graph.find_node(db, "skill", "packet analysis") == created
        assert await graph.find_node(db, "skill", "  PACKET   analysis ") == created
        assert await graph.find_node(db, "skill", "No Such Skill") is None
        await db.commit()
    finally:
        await db.close()


async def test_find_node_does_not_touch():
    """find_node is read-only: last_touched must not change."""
    db = await dbmod.get_db()
    try:
        node_id = await graph.find_or_create_node(db, "skill", "Touchless")
        row = await db.execute(
            "SELECT last_touched FROM nodes WHERE id = ?", (node_id,)
        )
        before = (await row.fetchone())["last_touched"]
        assert await graph.find_node(db, "skill", "touchless") == node_id
        row = await db.execute(
            "SELECT last_touched FROM nodes WHERE id = ?", (node_id,)
        )
        after = (await row.fetchone())["last_touched"]
        assert before == after
        await db.commit()
    finally:
        await db.close()


async def test_decay_is_rerun_safe_same_day():
    """Second decay run on the same UTC day is a no-op (returns 0)."""
    from app.api.skills import decay_confidence_scores

    db = await dbmod.get_db()
    node_id = None
    try:
        # Skill untouched for over a week -> eligible for decay.
        node_id = await graph.find_or_create_node(db, "skill", "Stale Skill")
        stale = (datetime.now(timezone.utc) - timedelta(days=30)).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        await db.execute(
            "UPDATE nodes SET confidence_score = 50, last_touched = ? WHERE id = ?",
            (stale, node_id),
        )
        await db.commit()
    finally:
        await db.close()

    first = await decay_confidence_scores()
    assert first["skills_decayed"] >= 1
    # Second, colliding run on the same day must not decay again.
    second = await decay_confidence_scores()
    assert second["skills_decayed"] == 0
    assert second["status"] == "already decayed today"

    db = await dbmod.get_db()
    try:
        row = await db.execute(
            "SELECT confidence_score FROM nodes WHERE id = ?", (node_id,)
        )
        score = (await row.fetchone())["confidence_score"]
        # exactly one decay step (50 - default 5), not two.
        assert score == 45
    finally:
        await db.close()
