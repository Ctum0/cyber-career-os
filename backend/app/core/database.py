"""SQLite database setup, migrations, and connection lifecycle.

Connection policy (single-user, localhost):
- one short-lived connection per request/job, closed in `finally`
- WAL + busy_timeout + foreign_keys enabled on every connection
- schema = baseline + ordered migrations tracked in `schema_migrations`
"""
import logging
import aiosqlite

from .config import DB_PATH

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Baseline schema (fresh installs) — kept in sync with migration history.
# --------------------------------------------------------------------------- #
SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN (
        'vuln', 'tool', 'mitigation', 'skill', 'project',
        'ctf', 'role', 'company', 'interview_q', 'source'
    )),
    label TEXT NOT NULL,
    label_norm TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    confidence_score REAL DEFAULT 50.0,
    last_touched TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(from_id, to_id, relation)
);

CREATE TABLE IF NOT EXISTS ingest_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK(source_type IN ('text', 'pdf', 'url', 'email', 'rss')),
    source_url TEXT,
    raw_content TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'error')),
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT
);

CREATE TABLE IF NOT EXISTS target_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT NOT NULL UNIQUE,
    skill_checklist TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_node_id TEXT NOT NULL REFERENCES nodes(id),
    lab_exercise TEXT,
    anki_cards TEXT DEFAULT '[]',
    challenge TEXT,
    solution TEXT,
    feedback TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'reviewed')),
    created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT REFERENCES nodes(id),
    title TEXT NOT NULL,
    description TEXT,
    architecture TEXT,
    stack TEXT,
    stretch_goals TEXT,
    status TEXT DEFAULT 'idea' CHECK(status IN ('idea', 'active', 'completed')),
    repo_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ctf_writeups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT REFERENCES nodes(id),
    title TEXT,
    raw_notes TEXT,
    structured TEXT,
    techniques TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    role_title TEXT NOT NULL,
    listing_text TEXT,
    required_skills TEXT DEFAULT '[]',
    real_gaps TEXT DEFAULT '[]',
    bluffable_gaps TEXT DEFAULT '[]',
    resume_bullets TEXT DEFAULT '[]',
    cover_letter TEXT,
    status TEXT DEFAULT 'interested' CHECK(status IN ('interested', 'applied', 'interview', 'closed')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_of TEXT NOT NULL,
    skill_gap_report TEXT,
    actions TEXT DEFAULT '[]',
    journal_entry TEXT,
    graph_activity TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vault_files (
    path TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mtime REAL NOT NULL,
    note_node_id TEXT,
    last_scanned_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
CREATE INDEX IF NOT EXISTS idx_nodes_label_norm ON nodes(type, label_norm);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_type_label_norm ON nodes(type, label_norm);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_ingest_status ON ingest_queue(status);
"""

# SQL for migration v1: add normalized label, dedupe collisions (keep oldest),
# then enforce uniqueness at the database level.
_MIGRATION_V1_STATEMENTS = [
    "ALTER TABLE nodes ADD COLUMN label_norm TEXT NOT NULL DEFAULT ''",
    "UPDATE nodes SET label_norm = lower(trim(label))",
    "UPDATE nodes SET label = trim(label) WHERE label != trim(label)",
    # Re-point edges to the surviving (oldest) node of each duplicate group.
    """
    UPDATE edges SET to_id = (
        SELECT n2.id FROM nodes n1, nodes n2
        WHERE n1.id = edges.to_id AND n1.type = n2.type
          AND n1.label_norm = n2.label_norm
          AND n2.created_at <= n1.created_at
        ORDER BY n2.created_at ASC LIMIT 1
    )
    WHERE to_id IN (
        SELECT n1.id FROM nodes n1
        WHERE EXISTS (
            SELECT 1 FROM nodes n2
            WHERE n2.type = n1.type AND n2.label_norm = n1.label_norm
              AND (n2.created_at < n1.created_at
                   OR (n2.created_at = n1.created_at AND n2.id < n1.id))
        )
    )
    """,
    """
    UPDATE edges SET from_id = (
        SELECT n2.id FROM nodes n1, nodes n2
        WHERE n1.id = edges.from_id AND n1.type = n2.type
          AND n1.label_norm = n2.label_norm
          AND n2.created_at <= n1.created_at
        ORDER BY n2.created_at ASC LIMIT 1
    )
    WHERE from_id IN (
        SELECT n1.id FROM nodes n1
        WHERE EXISTS (
            SELECT 1 FROM nodes n2
            WHERE n2.type = n1.type AND n2.label_norm = n1.label_norm
              AND (n2.created_at < n1.created_at
                   OR (n2.created_at = n1.created_at AND n2.id < n1.id))
        )
    )
    """,
    # Remove duplicate nodes, keeping the oldest of each (type, label_norm).
    """
    DELETE FROM nodes WHERE id IN (
        SELECT n1.id FROM nodes n1
        WHERE EXISTS (
            SELECT 1 FROM nodes n2
            WHERE n2.type = n1.type AND n2.label_norm = n1.label_norm
              AND (n2.created_at < n1.created_at
                   OR (n2.created_at = n1.created_at AND n2.id < n1.id))
        )
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_type_label_norm ON nodes(type, label_norm)",
]

# Ordered migrations: (version, statements). Append-only; never edit history.
MIGRATIONS: list[tuple[int, list[str]]] = [(1, _MIGRATION_V1_STATEMENTS)]


async def _current_version(db: aiosqlite.Connection) -> int:
    row = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    )
    if not await row.fetchone():
        return 0
    cur = await db.execute("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
    return (await cur.fetchone())["v"]


async def init_db() -> None:
    """Create baseline schema and apply pending migrations. Never destructive."""
    db = await get_db()
    try:
        version = await _current_version(db)
        if version == 0 and not await _has_nodes_table(db):
            # Fresh database: the baseline SCHEMA already includes v1 columns
            # and indexes, so create it and stamp migrations as applied.
            await db.executescript(SCHEMA)
            await db.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " version INTEGER PRIMARY KEY,"
                " applied_at TEXT DEFAULT (datetime('now')))"
            )
            for migration_version, _ in MIGRATIONS:
                await db.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?)",
                    (migration_version,),
                )
        else:
            # Existing database: ensure the tracking table, then apply any
            # pending migrations in order.
            await db.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " version INTEGER PRIMARY KEY,"
                " applied_at TEXT DEFAULT (datetime('now')))"
            )
            version = await _current_version(db)
            for migration_version, statements in MIGRATIONS:
                if migration_version <= version:
                    continue
                log.info("Applying database migration v%d", migration_version)
                for statement in statements:
                    await db.execute(statement)
                await db.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?)",
                    (migration_version,),
                )
        await db.commit()
    finally:
        await db.close()


async def _has_nodes_table(db: aiosqlite.Connection) -> bool:
    row = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'"
    )
    return bool(await row.fetchone())


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    await db.execute("PRAGMA busy_timeout=5000")
    return db
