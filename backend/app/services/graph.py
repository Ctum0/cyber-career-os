"""Canonical knowledge-graph write service.

One implementation of "convert extracted entities into graph nodes and edges
safely". All ingestion paths (manual ingest, RSS, Obsidian, future sources)
MUST use these helpers — never hand-roll INSERT statements against nodes/edges.

Identity: (type, normalize_label(label)) is unique (DB-enforced since v1).
Dedupe: application-level find-or-create backed by the unique index.
"""
import json
import uuid
import logging

from ..core.database import get_db
from ..core.labels import normalize_label

log = logging.getLogger(__name__)


async def find_or_create_node(
    db, node_type: str, label: str, description: str = "", metadata: dict | None = None
) -> str:
    """Find a node by (type, normalized label) or create it. Touches on hit."""
    norm = normalize_label(label)
    row = await db.execute(
        "SELECT id FROM nodes WHERE type = ? AND label_norm = ?", (node_type, norm)
    )
    existing = await row.fetchone()
    if existing:
        if description or metadata:
            await db.execute(
                "UPDATE nodes SET last_touched = datetime('now'), description = ?, metadata = ? WHERE id = ?",
                (description, json.dumps(metadata or {}), existing["id"]),
            )
        else:
            await db.execute(
                "UPDATE nodes SET last_touched = datetime('now') WHERE id = ?",
                (existing["id"],),
            )
        return existing["id"]

    node_id = f"{node_type}_{uuid.uuid4().hex[:8]}"
    await db.execute(
        "INSERT INTO nodes (id, type, label, label_norm, description, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        (node_id, node_type, label.strip(), norm, description, json.dumps(metadata or {})),
    )
    return node_id

async def find_node(db, node_type: str, label: str) -> str | None:
    """Look up a node by (type, normalized label). No creation, no touch.

    Read-side counterpart of find_or_create_node: callers matching nodes by
    label must use this (not raw label equality) or they miss nodes whose
    display casing/whitespace differs.
    """
    row = await db.execute(
        "SELECT id FROM nodes WHERE type = ? AND label_norm = ?",
        (node_type, normalize_label(label)),
    )
    hit = await row.fetchone()
    return hit["id"] if hit else None


async def create_edge(db, from_id: str, to_id: str, relation: str) -> bool:
    """Create an edge if absent. Returns True when a new edge was created."""
    cursor = await db.execute(
        "INSERT OR IGNORE INTO edges (from_id, to_id, relation) VALUES (?, ?, ?)",
        (from_id, to_id, relation),
    )
    return bool(cursor.rowcount)


async def create_edge_if_not_exists(db, from_id: str, to_id: str, relation: str) -> str:
    """Backward-compatible descriptor form used by ingest responses."""
    await create_edge(db, from_id, to_id, relation)
    return f"{from_id}->{relation}->{to_id}"


async def apply_entities(
    db,
    source_id: str,
    entities: dict,
    *,
    skill_relation: str = "demonstrates",
) -> dict:
    """Link extracted entities to a source node. Returns creation counts.

    Expects the extract_entities() shape:
        vulns[], tools[], skills[], techniques[]
    Techniques are stored as tool-typed nodes flagged via description.
    """
    nodes_touched = 0
    edges_created = 0

    for vuln in entities.get("vulns", []):
        node_id = await find_or_create_node(db, "vuln", vuln)
        nodes_touched += 1
        edges_created += await create_edge(db, source_id, node_id, "mentions")

    for tool in entities.get("tools", []):
        node_id = await find_or_create_node(db, "tool", tool)
        nodes_touched += 1
        edges_created += await create_edge(db, source_id, node_id, "mentions")

    for skill in entities.get("skills", []):
        node_id = await find_or_create_node(db, "skill", skill)
        nodes_touched += 1
        edges_created += await create_edge(db, source_id, node_id, skill_relation)

    for tech in entities.get("techniques", []):
        node_id = await find_or_create_node(db, "tool", tech, "MITRE ATT&CK technique")
        nodes_touched += 1
        edges_created += await create_edge(db, source_id, node_id, "uses_technique")

    return {"nodes_touched": nodes_touched, "edges_created": edges_created}


async def create_source_node(
    db, label: str, description: str = "", metadata: dict | None = None
) -> str:
    """Create (or refresh) the source node for an ingested artifact."""
    return await find_or_create_node(db, "source", label, description, metadata)


async def update_confidence(db, node_id: str, score: float) -> None:
    """Set a skill node's confidence and touch it. Score clamped to 0-100."""
    clamped = max(0.0, min(100.0, float(score)))
    await db.execute(
        "UPDATE nodes SET confidence_score = ?, last_touched = datetime('now') WHERE id = ?",
        (clamped, node_id),
    )


async def boost_confidence(db, node_id: str, amount: float) -> None:
    """Raise confidence by amount without exceeding 100."""
    await db.execute(
        "UPDATE nodes SET confidence_score = MIN(100, confidence_score + ?),"
        " last_touched = datetime('now') WHERE id = ?",
        (amount, node_id),
    )


