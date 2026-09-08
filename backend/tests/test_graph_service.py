"""Tests for the canonical graph service: node identity, dedupe, edges.

Each async operation runs under asyncio.run() to keep the fixture-managed
connection lifecycle simple and isolated per test.
"""
import asyncio

import pytest

import app.core.database as dbmod
from app.services import graph
from app.core.labels import normalize_label


def run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(_with_db(coro))


async def _with_db(coro_factory):
    db = await dbmod.get_db()
    try:
        return await coro_factory(db)
    finally:
        await db.close()


def test_find_or_create_dedupes_by_normalized_label():
    async def scenario(db):
        a = await graph.find_or_create_node(db, "tool", "Nmap")
        b = await graph.find_or_create_node(db, "tool", "nmap")
        c = await graph.find_or_create_node(db, "tool", "  NMAP  ")
        await db.commit()
        count = await db.execute("SELECT COUNT(*) c FROM nodes WHERE type='tool' AND label_norm='nmap'")
        return a, b, c, (await count.fetchone())["c"]

    a, b, c, n = run(scenario)
    assert a == b == c
    assert n == 1


def test_different_types_same_label_are_distinct():
    async def scenario(db):
        t = await graph.find_or_create_node(db, "tool", "recon")
        s = await graph.find_or_create_node(db, "skill", "recon")
        await db.commit()
        return t, s

    t, s = run(scenario)
    assert t != s


def test_database_enforces_uniqueness():
    async def scenario(db):
        await graph.find_or_create_node(db, "vuln", "CVE-2026-0001")
        await db.commit()
        norm = normalize_label("CVE-2026-0001")
        raised = False
        try:
            # Raw INSERT bypassing the service must hit the unique index.
            cursor = await db.execute(
                "INSERT INTO nodes (id, type, label, label_norm) VALUES ('x1', 'vuln', 'CVE-2026-0001', ?)",
                (norm,),
            )
            await cursor.fetchall()  # aiosqlite surfaces IntegrityError on await
        except Exception as e:
            raised = "UNIQUE" in str(e) or "IntegrityError" in type(e).__name__
        await db.rollback()
        return raised

    assert run(scenario) is True


def test_create_edge_idempotent():
    async def scenario(db):
        a = await graph.find_or_create_node(db, "source", "src-1")
        b = await graph.find_or_create_node(db, "tool", "burp")
        first = await graph.create_edge(db, a, b, "mentions")
        second = await graph.create_edge(db, a, b, "mentions")
        await db.commit()
        return first, second

    first, second = run(scenario)
    assert first is True
    assert second is False


def test_apply_entities_links_all_types_and_is_idempotent():
    async def scenario(db):
        source = await graph.create_source_node(db, "note-1", "d", {})
        entities = {
            "vulns": ["CVE-2026-1000"],
            "tools": ["nmap"],
            "skills": ["Packet Analysis"],
            "techniques": ["T1059"],
        }
        counts = await graph.apply_entities(db, source, entities)
        await db.commit()
        edges_after_first = await db.execute(
            "SELECT COUNT(*) c FROM edges WHERE from_id=?", (source,)
        )
        first_count = (await edges_after_first.fetchone())["c"]

        # Re-running must not create new edges (idempotent ingestion).
        await graph.apply_entities(db, source, entities)
        await db.commit()
        edges_after_second = await db.execute(
            "SELECT COUNT(*) c FROM edges WHERE from_id=?", (source,)
        )
        second_count = (await edges_after_second.fetchone())["c"]
        return counts, first_count, second_count

    counts, first_count, second_count = run(scenario)
    assert counts["edges_created"] == 4
    assert first_count == 4
    assert second_count == 4


def test_update_confidence_clamps():
    async def scenario(db):
        node = await graph.find_or_create_node(db, "skill", "Test Skill Clamp")
        await graph.update_confidence(db, node, 150)
        await db.commit()
        hi = await db.execute("SELECT confidence_score FROM nodes WHERE id=?", (node,))
        hi = (await hi.fetchone())["confidence_score"]
        await graph.update_confidence(db, node, -10)
        await db.commit()
        lo = await db.execute("SELECT confidence_score FROM nodes WHERE id=?", (node,))
        lo = (await lo.fetchone())["confidence_score"]
        await graph.boost_confidence(db, node, 200)
        await db.commit()
        boosted = await db.execute("SELECT confidence_score FROM nodes WHERE id=?", (node,))
        boosted = (await boosted.fetchone())["confidence_score"]
        return hi, lo, boosted

    hi, lo, boosted = run(scenario)
    assert hi == 100.0
    assert lo == 0.0
    assert boosted == 100.0
