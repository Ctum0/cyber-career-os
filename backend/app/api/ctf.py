"""Page 6: CTF/Lab Write-up Engine API routes."""
import json
import logging

from fastapi import APIRouter, HTTPException

from ..core.database import get_db
from ..core.errors import AppError
from ..core.groq_client import restructure_ctf_notes
from ..core.serialize import as_list, as_dict
from ..models.schemas import CTFWriteupRequest
from ..services import graph

log = logging.getLogger(__name__)
router = APIRouter(prefix="/ctf", tags=["ctf"])


def _serialize_writeup(r) -> dict:
    return {
        "id": r["id"],
        "node_id": r["node_id"],
        "title": r["title"],
        "raw_notes": r["raw_notes"],
        "structured": as_dict(r["structured"]),
        "techniques": as_list(r["techniques"]),
        "created_at": r["created_at"],
    }


@router.post("/writeup")
async def create_writeup(req: CTFWriteupRequest):
    """Restructure raw CTF notes into a template writeup."""
    db = await get_db()
    try:
        try:
            structured = await restructure_ctf_notes(req.raw_notes)
        except Exception as e:
            raise AppError("WRITEUP_FAILED", "Could not restructure these notes.", 502) from e
        if isinstance(structured, str):
            structured = json.loads(structured)

        title = req.title or structured.get("title", "Untitled Writeup")
        techniques = structured.get("techniques", [])

        # Atomic unit: ctf node + technique edges + writeup row
        node_id = await graph.find_or_create_node(db, "ctf", title, structured.get("lesson", ""))

        for tech_id in techniques:
            tech_node_id = await graph.find_or_create_node(
                db, "tool", tech_id, "ATT&CK technique"
            )
            await graph.create_edge(db, node_id, tech_node_id, "uses_technique")

        cursor = await db.execute(
            """INSERT INTO ctf_writeups (node_id, title, raw_notes, structured, techniques)
               VALUES (?, ?, ?, ?, ?)""",
            (node_id, title, req.raw_notes, json.dumps(structured), json.dumps(techniques)),
        )
        await db.commit()

        row = await db.execute("SELECT * FROM ctf_writeups WHERE id = ?", (cursor.lastrowid,))
        return _serialize_writeup(await row.fetchone())
    finally:
        await db.close()


@router.get("/writeups")
async def list_writeups():
    """List all CTF writeups."""
    db = await get_db()
    try:
        rows = await db.execute("SELECT * FROM ctf_writeups ORDER BY created_at DESC")
        return [_serialize_writeup(r) for r in await rows.fetchall()]
    finally:
        await db.close()


@router.get("/writeups/{writeup_id}")
async def get_writeup(writeup_id: int):
    """Get a specific CTF writeup."""
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM ctf_writeups WHERE id = ?", (writeup_id,))
        writeup = await row.fetchone()
        if not writeup:
            raise HTTPException(status_code=404, detail="Writeup not found")
        return _serialize_writeup(writeup)
    finally:
        await db.close()
