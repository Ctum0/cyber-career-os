"""Page 1: Inbox/Ingest API routes."""
import logging

from fastapi import APIRouter, HTTPException

from ..core.database import get_db
from ..core.errors import AppError
from ..core.groq_client import extract_entities
from ..core.serialize import as_list
from ..models.schemas import IngestTextRequest, IngestResponse
from ..services import graph

log = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingest"])


async def _process_content(db, content: str, source_type: str, source_url: str | None, queue_id: int) -> dict:
    """Shared pipeline: extract entities and write them to the graph."""
    entities = await extract_entities(content)
    source_label = source_url or f"{source_type}_{queue_id}"
    source_id = await graph.create_source_node(
        db, source_label, content[:200],
        {"queue_id": queue_id, "source_type": source_type},
    )
    counts = await graph.apply_entities(db, source_id, entities)
    return {"source_id": source_id, "edges_created": counts["edges_created"]}


@router.post("/text", response_model=IngestResponse)
async def ingest_text(req: IngestTextRequest):
    """Ingest text content: extract entities, create/link nodes atomically."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO ingest_queue (source_type, source_url, raw_content, status)"
            " VALUES (?, ?, ?, 'processing')",
            (req.source_type, req.source_url, req.content),
        )
        ingest_id = cursor.lastrowid
        await db.commit()

        try:
            result = await _process_content(db, req.content, req.source_type, req.source_url, ingest_id)
            await db.execute(
                "UPDATE ingest_queue SET status = 'done', processed_at = datetime('now')"
                " WHERE id = ?",
                (ingest_id,),
            )
            await db.commit()
        except Exception:
            # Record failure on the queue row, but surface the real error to the caller.
            await db.execute(
                "UPDATE ingest_queue SET status = 'error', error_message = ? WHERE id = ?",
                ("entity extraction failed", ingest_id),
            )
            await db.commit()
            raise

        return IngestResponse(
            id=ingest_id,
            status="done",
            source_node=result["source_id"],
            edges_created=result["edges_created"],
        )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("Ingest failed")
        raise AppError("INGEST_FAILED", "Could not ingest this content.", 500) from e
    finally:
        await db.close()


@router.get("/queue")
async def get_ingest_queue(status: str | None = None):
    """Get ingest queue items, optionally filtered by status."""
    db = await get_db()
    try:
        if status:
            rows = await db.execute(
                "SELECT * FROM ingest_queue WHERE status = ? ORDER BY created_at DESC LIMIT 50",
                (status,),
            )
        else:
            rows = await db.execute(
                "SELECT * FROM ingest_queue ORDER BY created_at DESC LIMIT 50"
            )
        return [
            {
                "id": r["id"],
                "source_type": r["source_type"],
                "source_url": r["source_url"],
                "raw_content": r["raw_content"],
                "status": r["status"],
                "error_message": r["error_message"],
                "created_at": r["created_at"],
                "processed_at": r["processed_at"],
            }
            for r in await rows.fetchall()
        ]
    finally:
        await db.close()


@router.post("/queue/{item_id}/retry")
async def retry_queue_item(item_id: int):
    """Re-drive a failed queue item. Sets status to pending for the processor."""
    db = await get_db()
    try:
        row = await db.execute("SELECT status FROM ingest_queue WHERE id = ?", (item_id,))
        item = await row.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Queue item not found")
        if item["status"] not in ("error", "done"):
            raise HTTPException(
                status_code=400, detail=f"Cannot retry an item with status '{item['status']}'"
            )
        await db.execute(
            "UPDATE ingest_queue SET status = 'pending', error_message = NULL WHERE id = ?",
            (item_id,),
        )
        await db.commit()
        return {"id": item_id, "status": "pending"}
    finally:
        await db.close()
