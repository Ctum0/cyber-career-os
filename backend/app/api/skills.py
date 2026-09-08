"""Page 4: Skill Pipeline API routes."""
import json
import logging

from fastapi import APIRouter, HTTPException

from ..core import settings_store
from ..core.database import get_db
from ..core.errors import AppError
from ..core.groq_client import generate_skill_module, review_solution
from ..core.serialize import as_list, as_dict
from ..models.schemas import SkillModuleCreate, SolutionSubmit
from ..services import graph

log = logging.getLogger(__name__)
router = APIRouter(prefix="/skills", tags=["skills"])


def _serialize_module(r) -> dict:
    """Normalize a skill_modules row for the API (JSON columns as real JSON)."""
    return {
        "id": r["id"],
        "skill_node_id": r["skill_node_id"],
        "lab_exercise": r["lab_exercise"],
        "anki_cards": as_list(r["anki_cards"]),
        "challenge": r["challenge"],
        "solution": r["solution"],
        "feedback": as_dict(r["feedback"]),
        "status": r["status"],
        "created_at": r["created_at"],
        "reviewed_at": r["reviewed_at"],
    }


@router.post("/modules")
async def create_skill_module(req: SkillModuleCreate):
    """Generate a lab + Anki cards + challenge for a skill."""
    db = await get_db()
    try:
        row = await db.execute(
            "SELECT * FROM nodes WHERE id = ? AND type = 'skill'", (req.skill_node_id,)
        )
        skill = await row.fetchone()
        if not skill:
            raise HTTPException(status_code=404, detail="Skill not found")

        module = await generate_skill_module(skill["label"], skill["confidence_score"])

        cursor = await db.execute(
            """INSERT INTO skill_modules (skill_node_id, lab_exercise, anki_cards, challenge)
               VALUES (?, ?, ?, ?)""",
            (
                req.skill_node_id,
                module.get("lab_exercise", ""),
                json.dumps(module.get("anki_cards", [])),
                module.get("challenge", ""),
            ),
        )
        await db.commit()

        return {
            "id": cursor.lastrowid,
            "skill_node_id": req.skill_node_id,
            "lab_exercise": module.get("lab_exercise", ""),
            "anki_cards": module.get("anki_cards", []),
            "challenge": module.get("challenge", ""),
            "status": "pending",
        }
    finally:
        await db.close()


@router.post("/modules/generate")
async def generate_modules(limit: int = 5):
    """Auto-generate skill modules for the lowest-confidence high-priority skills."""
    db = await get_db()
    try:
        # Collect skill gaps from all target roles
        roles = await db.execute("SELECT skill_checklist FROM target_roles")
        all_skills = []
        for role in await roles.fetchall():
            all_skills.extend(as_list(role["skill_checklist"]))

        # Deduplicate and find skill nodes; rank by importance × (100 − confidence)
        seen = set()
        prioritized = []
        for item in all_skills:
            skill_name = item.get("skill", "")
            if not skill_name or skill_name in seen:
                continue
            seen.add(skill_name)
            node = await db.execute(
                "SELECT id, confidence_score FROM nodes WHERE type = 'skill' AND label = ?",
                (skill_name,),
            )
            skill = await node.fetchone()
            if skill:
                importance = item.get("importance", 5)
                prioritized.append({
                    "node_id": skill["id"],
                    "label": skill_name,
                    "confidence": skill["confidence_score"],
                    "priority": importance * (100 - skill["confidence_score"]),
                })

        prioritized.sort(key=lambda x: x["priority"], reverse=True)

        existing = await db.execute("SELECT skill_node_id FROM skill_modules")
        existing_ids = {r["skill_node_id"] for r in await existing.fetchall()}
        candidates = [s for s in prioritized if s["node_id"] not in existing_ids]

        created = []
        for skill in candidates[:limit]:
            module = await generate_skill_module(skill["label"], skill["confidence"])
            cursor = await db.execute(
                """INSERT INTO skill_modules (skill_node_id, lab_exercise, anki_cards, challenge)
                   VALUES (?, ?, ?, ?)""",
                (
                    skill["node_id"],
                    module.get("lab_exercise", ""),
                    json.dumps(module.get("anki_cards", [])),
                    module.get("challenge", ""),
                ),
            )
            created.append({
                "id": cursor.lastrowid,
                "skill_node_id": skill["node_id"],
                "skill_label": skill["label"],
                "lab_exercise": module.get("lab_exercise", ""),
                "anki_cards": module.get("anki_cards", []),
                "challenge": module.get("challenge", ""),
                "status": "pending",
            })

        await db.commit()
        return {"created": len(created), "modules": created}
    finally:
        await db.close()


@router.get("/modules")
async def list_modules(status: str | None = None):
    """List skill modules, optionally filtered by status."""
    db = await get_db()
    try:
        if status:
            rows = await db.execute(
                "SELECT * FROM skill_modules WHERE status = ? ORDER BY created_at DESC",
                (status,),
            )
        else:
            rows = await db.execute("SELECT * FROM skill_modules ORDER BY created_at DESC")
        return [_serialize_module(r) for r in await rows.fetchall()]
    finally:
        await db.close()


@router.get("/modules/{module_id}")
async def get_module(module_id: int):
    """Get a specific skill module."""
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM skill_modules WHERE id = ?", (module_id,))
        module = await row.fetchone()
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")
        return _serialize_module(module)
    finally:
        await db.close()


@router.post("/modules/{module_id}/submit")
async def submit_solution(module_id: int, req: SolutionSubmit):
    """Submit solution for review. The AI score overwrites skill confidence."""
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM skill_modules WHERE id = ?", (module_id,))
        module = await row.fetchone()
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")

        skill_row = await db.execute(
            "SELECT * FROM nodes WHERE id = ?", (module["skill_node_id"],)
        )
        skill = await skill_row.fetchone()
        if not skill:
            raise HTTPException(
                status_code=409,
                detail="The skill node for this module no longer exists.",
            )

        try:
            review = await review_solution(skill["label"], module["challenge"], req.solution)
        except Exception as e:
            log.exception("Solution review failed")
            raise AppError("REVIEW_FAILED", "Could not review this solution.", 502) from e

        # One atomic unit: module update + confidence update
        await db.execute(
            "UPDATE skill_modules SET solution = ?, feedback = ?, status = 'reviewed',"
            " reviewed_at = datetime('now') WHERE id = ?",
            (req.solution, json.dumps(review), module_id),
        )
        await graph.update_confidence(db, module["skill_node_id"], review.get("score", 50))
        await db.commit()

        return {
            "score": review.get("score", 0),
            "feedback": review.get("feedback", ""),
            "strengths": review.get("strengths", []),
            "improvements": review.get("improvements", []),
            "new_confidence": review.get("score", 50),
        }
    finally:
        await db.close()


@router.post("/decay")
async def decay_confidence_scores():
    """Decay confidence for untouched skills (weekly job; settings-driven)."""
    amount = await settings_store.get("advanced.confidence_decay_amount", 5)
    days = await settings_store.get("advanced.confidence_decay_days", 7)
    db = await get_db()
    try:
        cursor = await db.execute(
            """
            UPDATE nodes
            SET confidence_score = MAX(0, confidence_score - ?)
            WHERE type = 'skill'
            AND last_touched < datetime('now', ?)
            AND confidence_score > 0
            """,
            (amount, f"-{days} days"),
        )
        await db.commit()
        if cursor.rowcount:
            log.info("Confidence decay applied to %d skills", cursor.rowcount)
        return {"status": "decay applied", "skills_decayed": cursor.rowcount}
    finally:
        await db.close()
