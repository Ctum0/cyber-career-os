"""Page 8: Weekly Synthesis API routes.

Note: digest generation is manual (POST /generate). It is deliberately NOT on
the scheduler; the UI copy reflects this.
"""
import json
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException

from ..core.database import get_db
from ..core.errors import AppError
from ..core.groq_client import generate_weekly_digest
from ..core.serialize import as_list, as_dict
from ..models.schemas import JournalUpdateRequest
from ..services import graph

log = logging.getLogger(__name__)
router = APIRouter(prefix="/digest", tags=["digest"])


def _serialize_digest(r) -> dict:
    return {
        "id": r["id"],
        "week_of": r["week_of"],
        "skill_gap_report": r["skill_gap_report"],
        "actions": as_list(r["actions"]),
        "journal_entry": r["journal_entry"],
        "graph_activity": as_dict(r["graph_activity"]),
        "created_at": r["created_at"],
    }


async def build_weekly_context(db):
    """Build context for weekly digest generation."""
    skills = await db.execute(
        "SELECT label, confidence_score, last_touched FROM nodes WHERE type = 'skill' ORDER BY confidence_score DESC"
    )
    skill_summary = "\n".join(
        [f"{r['label']}: {r['confidence_score']}/100 (last touched {r['last_touched']})"
         for r in await skills.fetchall()]
    )

    week_ago = (datetime.now() - timedelta(days=7)).isoformat()
    activity_items = []

    counts = {
        "Ingested {n} new sources":
            "SELECT COUNT(*) as c FROM ingest_queue WHERE created_at > ?",
        "Completed {n} skill modules":
            "SELECT COUNT(*) as c FROM skill_modules WHERE reviewed_at > ?",
        "Completed {n} projects":
            "SELECT COUNT(*) as c FROM projects WHERE completed_at > ?",
        "Created {n} CTF writeups":
            "SELECT COUNT(*) as c FROM ctf_writeups WHERE created_at > ?",
        "Updated {n} applications":
            "SELECT COUNT(*) as c FROM applications WHERE updated_at > ?",
    }
    for template, sql in counts.items():
        row = await db.execute(sql, (week_ago,))
        count = (await row.fetchone())["c"]
        if count:
            activity_items.append(template.format(n=count))

    activity = "\n".join(activity_items) if activity_items else "No recorded activity this week"

    # Gaps from target roles
    roles = await db.execute("SELECT role_name, skill_checklist FROM target_roles")
    gaps = []
    for role in await roles.fetchall():
        for item in json.loads(role["skill_checklist"] or "[]"):
            skill_name = item.get("skill", "")
            if not skill_name:
                continue
            skill_id = await graph.find_node(db, "skill", skill_name)
            conf = 0
            if skill_id:
                conf_row = await db.execute(
                    "SELECT confidence_score FROM nodes WHERE id = ?", (skill_id,)
                )
                hit = await conf_row.fetchone()
                conf = hit["confidence_score"] if hit else 0

            if conf < 50:
                gaps.append(f"{role['role_name']}: {skill_name} ({conf}/100)")
    gaps_str = "\n".join(gaps[:10]) if gaps else "No target roles set"

    return skill_summary, activity, gaps_str


@router.post("/generate")
async def generate_digest():
    """Generate this week's digest."""
    db = await get_db()
    try:
        skill_summary, activity, gaps = await build_weekly_context(db)
        try:
            digest = await generate_weekly_digest(skill_summary, activity, gaps)
        except Exception as e:
            raise AppError("DIGEST_FAILED", "Could not generate the weekly digest.", 502) from e
        if isinstance(digest, str):
            digest = json.loads(digest)

        week_of = datetime.now().strftime("%Y-%m-%d")
        cursor = await db.execute(
            """INSERT INTO weekly_digests (week_of, skill_gap_report, actions, journal_entry, graph_activity)
               VALUES (?, ?, ?, ?, ?)""",
            (
                week_of,
                digest.get("skill_gap_report", ""),
                json.dumps(digest.get("actions", [])),
                digest.get("journal_entry", ""),
                json.dumps({"activity": activity}),
            ),
        )
        await db.commit()

        row = await db.execute("SELECT * FROM weekly_digests WHERE id = ?", (cursor.lastrowid,))
        return _serialize_digest(await row.fetchone())
    finally:
        await db.close()


@router.get("")
async def list_digests():
    """List all weekly digests."""
    db = await get_db()
    try:
        rows = await db.execute("SELECT * FROM weekly_digests ORDER BY week_of DESC")
        return [_serialize_digest(r) for r in await rows.fetchall()]
    finally:
        await db.close()


@router.get("/{digest_id}")
async def get_digest(digest_id: int):
    """Get a specific weekly digest."""
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM weekly_digests WHERE id = ?", (digest_id,))
        digest = await row.fetchone()
        if not digest:
            raise HTTPException(status_code=404, detail="Digest not found")
        return _serialize_digest(digest)
    finally:
        await db.close()


@router.patch("/{digest_id}")
async def update_journal(digest_id: int, req: JournalUpdateRequest):
    """Edit the journal entry of a digest."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE weekly_digests SET journal_entry = ? WHERE id = ?",
            (req.journal_entry, digest_id),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM weekly_digests WHERE id = ?", (digest_id,))
        digest = await row.fetchone()
        if not digest:
            raise HTTPException(status_code=404, detail="Digest not found")
        return _serialize_digest(digest)
    finally:
        await db.close()
