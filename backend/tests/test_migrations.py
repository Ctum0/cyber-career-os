"""Tests for schema migrations: dedupe of legacy duplicates + idempotency."""
import asyncio

import pytest

import app.core.database as dbmod


def _fresh_db(monkeypatch, tmp_path):
    import app.core.config as configmod

    dbfile = tmp_path / "mig.db"
    monkeypatch.setattr(configmod, "DB_PATH", dbfile)
    monkeypatch.setattr(dbmod, "DB_PATH", dbfile)
    return dbfile


def _seed_legacy_duplicates(dbfile):
    """Create a pre-migration database with duplicate (type,label) nodes."""
    import sqlite3

    conn = sqlite3.connect(dbfile)
    # Baseline WITHOUT label_norm (simulate the old schema)
    conn.executescript("""
        CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            label TEXT NOT NULL,
            description TEXT DEFAULT '',
            confidence_score REAL DEFAULT 50.0,
            last_touched TEXT DEFAULT (datetime('now')),
            created_at TEXT DEFAULT (datetime('now')),
            metadata TEXT DEFAULT '{}'
        );
        CREATE TABLE edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            relation TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(from_id, to_id, relation)
        );
    """)
    conn.execute("INSERT INTO nodes (id, type, label, created_at) VALUES ('v_old', 'vuln', 'CVE-2026-9999', '2026-01-01')")
    conn.execute("INSERT INTO nodes (id, type, label, created_at) VALUES ('v_new', 'vuln', 'CVE-2026-9999', '2026-02-01')")
    src = "s_x"
    conn.execute("INSERT INTO nodes (id, type, label) VALUES (?, 'source', 'src')", (src,))
    conn.execute("INSERT INTO edges (from_id, to_id, relation) VALUES (?, 'v_new', 'mentions')", (src,))
    conn.commit()
    conn.close()


def test_migration_dedupes_legacy_duplicates(monkeypatch, tmp_path):
    dbfile = _fresh_db(monkeypatch, tmp_path)
    _seed_legacy_duplicates(dbfile)

    async def scenario():
        await dbmod.init_db()
        conn = await dbmod.get_db()
        try:
            rows = await (await conn.execute("SELECT id FROM nodes WHERE type='vuln'")).fetchall()
            assert len(rows) == 1
            assert rows[0]["id"] == "v_old"  # oldest survives
            edge = await (await conn.execute("SELECT to_id FROM edges")).fetchone()
            assert edge["to_id"] == "v_old"
            version = await (await conn.execute("SELECT MAX(version) v FROM schema_migrations")).fetchone()
            assert version["v"] == 1
        finally:
            await conn.close()

    asyncio.run(scenario())


def test_migration_idempotent(monkeypatch, tmp_path):
    dbfile = _fresh_db(monkeypatch, tmp_path)
    _seed_legacy_duplicates(dbfile)

    async def scenario():
        await dbmod.init_db()
        await dbmod.init_db()  # second run: no-op
        conn = await dbmod.get_db()
        try:
            count = await (await conn.execute("SELECT COUNT(*) c FROM schema_migrations")).fetchone()
            assert count["c"] == 1
        finally:
            await conn.close()

    asyncio.run(scenario())


def test_fresh_db_gets_full_baseline(monkeypatch, tmp_path):
    _fresh_db(monkeypatch, tmp_path)

    async def scenario():
        await dbmod.init_db()
        conn = await dbmod.get_db()
        try:
            cols = [r["name"] for r in await (await conn.execute("PRAGMA table_info(nodes)")).fetchall()]
            assert "label_norm" in cols
            idx = await (await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_nodes_type_label_norm'"
            )).fetchone()
            assert idx is not None
        finally:
            await conn.close()

    asyncio.run(scenario())
