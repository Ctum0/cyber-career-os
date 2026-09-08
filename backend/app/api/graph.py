"""Page 2: Knowledge Graph API routes."""
from fastapi import APIRouter, HTTPException, Query

from ..core.database import get_db
from ..core.serialize import as_dict
from ..models.schemas import NodeCreate, EdgeCreate, GraphStatsResponse
from ..services import graph

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/nodes")
async def list_nodes(
    type: str | None = None,
    search: str | None = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
):
    """List nodes with optional type filter and search."""
    db = await get_db()
    try:
        conditions = []
        params: list = []
        if type:
            conditions.append("type = ?")
            params.append(type)
        if search:
            conditions.append("(label LIKE ? OR description LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.extend([limit, offset])

        rows = await db.execute(
            f"SELECT * FROM nodes {where} ORDER BY last_touched DESC LIMIT ? OFFSET ?",
            params,
        )
        results = []
        for r in await rows.fetchall():
            d = dict(r)
            d["metadata"] = as_dict(d["metadata"])
            results.append(d)
        return results
    finally:
        await db.close()


@router.get("/nodes/{node_id}")
async def get_node(node_id: str):
    """Get a single node with its edges."""
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM nodes WHERE id = ?", (node_id,))
        node = await row.fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        node_dict = dict(node)
        node_dict["metadata"] = as_dict(node_dict["metadata"])

        edges_out = await db.execute("SELECT * FROM edges WHERE from_id = ?", (node_id,))
        edges_in = await db.execute("SELECT * FROM edges WHERE to_id = ?", (node_id,))

        return {
            "node": node_dict,
            "edges_out": [dict(e) for e in await edges_out.fetchall()],
            "edges_in": [dict(e) for e in await edges_in.fetchall()],
        }
    finally:
        await db.close()


@router.post("/nodes")
async def create_node(req: NodeCreate):
    """Create a node (deduplicated by type + normalized label)."""
    db = await get_db()
    try:
        node_id = await graph.find_or_create_node(
            db, req.type, req.label, req.description or "", req.metadata
        )
        await db.commit()
        return {"id": node_id, "status": "created"}
    finally:
        await db.close()


@router.patch("/nodes/{node_id}/confidence")
async def update_confidence(node_id: str, score: float = Query(ge=0, le=100)):
    """Update a node's confidence score."""
    db = await get_db()
    try:
        row = await db.execute("SELECT id FROM nodes WHERE id = ?", (node_id,))
        if not await row.fetchone():
            raise HTTPException(status_code=404, detail="Node not found")
        await graph.update_confidence(db, node_id, score)
        await db.commit()
        return {"id": node_id, "confidence_score": score}
    finally:
        await db.close()


@router.get("/edges")
async def list_edges(limit: int = Query(500, le=2000)):
    """List edges."""
    db = await get_db()
    try:
        rows = await db.execute("SELECT * FROM edges LIMIT ?", (limit,))
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()


@router.post("/edges")
async def create_edge(req: EdgeCreate):
    """Create an edge between nodes (idempotent)."""
    db = await get_db()
    try:
        for endpoint, value in (("from_id", req.from_id), ("to_id", req.to_id)):
            row = await db.execute("SELECT id FROM nodes WHERE id = ?", (value,))
            if not await row.fetchone():
                raise HTTPException(status_code=404, detail=f"{endpoint} node not found: {value}")
        await graph.create_edge(db, req.from_id, req.to_id, req.relation)
        await db.commit()
        return {"status": "created"}
    finally:
        await db.close()


@router.get("/stats", response_model=GraphStatsResponse)
async def get_graph_stats():
    """Get graph statistics."""
    db = await get_db()
    try:
        total_nodes = (await (await db.execute("SELECT COUNT(*) as c FROM nodes")).fetchone())["c"]
        total_edges = (await (await db.execute("SELECT COUNT(*) as c FROM edges")).fetchone())["c"]

        type_rows = await db.execute("SELECT type, COUNT(*) as c FROM nodes GROUP BY type")
        nodes_by_type = {r["type"]: r["c"] for r in await type_rows.fetchall()}

        top_skills = await db.execute(
            "SELECT label, confidence_score FROM nodes WHERE type = 'skill' ORDER BY confidence_score DESC LIMIT 10"
        )

        recent = await db.execute(
            "SELECT type, label, last_touched FROM nodes ORDER BY last_touched DESC LIMIT 10"
        )

        return GraphStatsResponse(
            total_nodes=total_nodes,
            total_edges=total_edges,
            nodes_by_type=nodes_by_type,
            top_skills=[dict(s) for s in await top_skills.fetchall()],
            recent_activity=[dict(r) for r in await recent.fetchall()],
        )
    finally:
        await db.close()


@router.get("/visualize")
async def get_graph_visualization():
    """Get graph data formatted for the force-directed canvas.

    Note the deliberate caps (500 nodes / 2000 edges) — communicated in the UI.
    """
    db = await get_db()
    try:
        nodes = await db.execute("SELECT id, type, label, confidence_score FROM nodes LIMIT 500")
        edges = await db.execute(
            "SELECT from_id as source, to_id as target, relation FROM edges LIMIT 2000"
        )
        return {
            "nodes": [
                {"id": r["id"], "type": r["type"], "label": r["label"], "score": r["confidence_score"]}
                for r in await nodes.fetchall()
            ],
            "links": [dict(e) for e in await edges.fetchall()],
        }
    finally:
        await db.close()
