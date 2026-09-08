"""Page 7: Application Tracker API routes."""
import json

from fastapi import APIRouter, HTTPException

from ..core.database import get_db
from ..core.errors import AppError
from ..core.groq_client import analyze_job_listing
from ..core.serialize import as_list
from ..models.schemas import ApplicationCreate, ApplicationUpdate

router = APIRouter(prefix="/applications", tags=["applications"])

VALID_STATUSES = {"interested", "applied", "interview", "closed"}


def _serialize_application(r) -> dict:
    """Normalize an applications row (JSON columns as real JSON)."""
    return {
        "id": r["id"],
        "company": r["company"],
        "role_title": r["role_title"],
        "listing_text": r["listing_text"],
        "required_skills": as_list(r["required_skills"]),
        "real_gaps": as_list(r["real_gaps"]),
        "bluffable_gaps": as_list(r["bluffable_gaps"]),
        "resume_bullets": as_list(r["resume_bullets"]),
        "cover_letter": r["cover_letter"],
        "status": r["status"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


async def get_candidate_profile(db):
    """Build candidate profile from graph for job matching."""
    skills = await db.execute(
        "SELECT label, confidence_score FROM nodes WHERE type = 'skill' ORDER BY confidence_score DESC"
    )
    skill_list = [f"{r['label']} ({r['confidence_score']}/100)" for r in await skills.fetchall()]

    projects = await db.execute(
        "SELECT label, description FROM nodes WHERE type = 'project' LIMIT 10"
    )
    ctfs = await db.execute(
        "SELECT label, description FROM nodes WHERE type = 'ctf' LIMIT 10"
    )

    evidence = []
    for p in await projects.fetchall():
        evidence.append(f"Project: {p['label']} - {p['description']}")
    for c in await ctfs.fetchall():
        evidence.append(f"CTF: {c['label']} - {c['description']}")

    return "\n".join(skill_list), "\n".join(evidence)


@router.post("")
async def create_application(req: ApplicationCreate):
    """Paste a job listing and analyze it against your profile."""
    db = await get_db()
    try:
        skills_str, evidence_str = await get_candidate_profile(db)

        try:
            analysis = await analyze_job_listing(req.listing_text, skills_str, evidence_str)
        except Exception as e:
            raise AppError("ANALYSIS_FAILED", "Could not analyze this job listing.", 502) from e
        if isinstance(analysis, str):
            import json as _json
            analysis = _json.loads(analysis)

        cursor = await db.execute(
            """INSERT INTO applications
               (company, role_title, listing_text, required_skills, real_gaps,
                bluffable_gaps, resume_bullets, cover_letter)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                req.company, req.role_title, req.listing_text,
                json.dumps(analysis.get("required_skills", [])),
                json.dumps(analysis.get("real_gaps", [])),
                json.dumps(analysis.get("bluffable_gaps", [])),
                json.dumps(analysis.get("resume_bullets", [])),
                analysis.get("cover_letter_paragraph", ""),
            ),
        )
        await db.commit()

        row = await db.execute("SELECT * FROM applications WHERE id = ?", (cursor.lastrowid,))
        return _serialize_application(await row.fetchone())
    finally:
        await db.close()


@router.get("")
async def list_applications(status: str | None = None):
    """List applications, optionally filtered by Kanban status."""
    db = await get_db()
    try:
        if status:
            rows = await db.execute(
                "SELECT * FROM applications WHERE status = ? ORDER BY updated_at DESC",
                (status,),
            )
        else:
            rows = await db.execute("SELECT * FROM applications ORDER BY updated_at DESC")
        return [_serialize_application(r) for r in await rows.fetchall()]
    finally:
        await db.close()


@router.patch("/{app_id}")
async def update_application(app_id: int, req: ApplicationUpdate):
    """Update application status (Kanban move) and/or listing text."""
    db = await get_db()
    try:
        if req.status and req.status not in VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{req.status}'. Must be one of: {', '.join(sorted(VALID_STATUSES))}",
            )

        updates = []
        params = []
        if req.status:
            updates.append("status = ?")
            params.append(req.status)
        if req.listing_text:
            updates.append("listing_text = ?")
            params.append(req.listing_text)

        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")

        updates.append("updated_at = datetime('now')")
        params.append(app_id)

        await db.execute(
            f"UPDATE applications SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        await db.commit()

        row = await db.execute("SELECT * FROM applications WHERE id = ?", (app_id,))
        updated = await row.fetchone()
        if not updated:
            raise HTTPException(status_code=404, detail="Application not found")
        return _serialize_application(updated)
    finally:
        await db.close()


@router.get("/{app_id}")
async def get_application(app_id: int):
    """Get full application details."""
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM applications WHERE id = ?", (app_id,))
        app_row = await row.fetchone()
        if not app_row:
            raise HTTPException(status_code=404, detail="Application not found")
        return _serialize_application(app_row)
    finally:
        await db.close()
