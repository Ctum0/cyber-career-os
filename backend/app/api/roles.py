"""Page 3: Target Roles API routes."""
import json

from fastapi import APIRouter, HTTPException

from ..core.database import get_db
from ..core.errors import AppError
from ..core.groq_client import generate_skill_checklist
from ..core.serialize import as_list
from ..models.schemas import TargetRoleCreate
from ..services import graph

router = APIRouter(prefix="/roles", tags=["roles"])


@router.post("")
async def set_target_role(req: TargetRoleCreate):
    """Set a target role and generate its skill checklist."""
    db = await get_db()
    try:
        listing_context = f"\nJob listing context:\n{req.listing_text}" if req.listing_text else ""
        try:
            checklist = await generate_skill_checklist(req.role_name, listing_context)
        except Exception as e:
            raise AppError("CHECKLIST_FAILED", "Could not generate the skill checklist.", 502) from e

        if isinstance(checklist, dict):
            checklist = checklist.get("skills", checklist.get("checklist", []))

        # Atomic unit: role row + skill nodes + role edges
        await db.execute(
            "INSERT OR REPLACE INTO target_roles (role_name, skill_checklist) VALUES (?, ?)",
            (req.role_name, json.dumps(checklist)),
        )

        # Ensure the role node exists once, then link every checklist skill.
        role_row = await db.execute(
            "SELECT id FROM nodes WHERE type = 'role' AND label = ?", (req.role_name,)
        )
        role = await role_row.fetchone()
        if role:
            role_id = role["id"]
        else:
            role_id = await graph.find_or_create_node(db, "role", req.role_name)

        for item in checklist:
            skill_name = item.get("skill", "")
            if not skill_name:
                continue
            node_id = await graph.find_or_create_node(
                db, "skill", skill_name,
                metadata={"importance": item.get("importance", 5)},
            )
            await graph.create_edge(db, role_id, node_id, "requires_skill")

        await db.commit()

        row = await db.execute(
            "SELECT * FROM target_roles WHERE role_name = ?", (req.role_name,)
        )
        role_row = await row.fetchone()
        role_dict = dict(role_row)
        role_dict["skill_checklist"] = as_list(role_dict["skill_checklist"])
        return role_dict
    finally:
        await db.close()


@router.get("")
async def list_target_roles():
    """List all target roles."""
    db = await get_db()
    try:
        rows = await db.execute("SELECT * FROM target_roles ORDER BY created_at DESC")
        results = []
        for r in await rows.fetchall():
            d = dict(r)
            d["skill_checklist"] = as_list(d["skill_checklist"])
            results.append(d)
        return results
    finally:
        await db.close()


@router.get("/{role_name}/gaps")
async def get_skill_gaps(role_name: str):
    """Get prioritized skill gaps for a target role."""
    db = await get_db()
    try:
        row = await db.execute(
            "SELECT skill_checklist FROM target_roles WHERE role_name = ?", (role_name,)
        )
        role = await row.fetchone()
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")

        checklist = as_list(role["skill_checklist"])
        gaps = []

        for item in checklist:
            skill_name = item.get("skill", "")
            importance = item.get("importance", 5)

            skill_node = await db.execute(
                "SELECT confidence_score FROM nodes WHERE type = 'skill' AND label = ?",
                (skill_name,),
            )
            skill = await skill_node.fetchone()
            confidence = skill["confidence_score"] if skill else 0.0

            gaps.append({
                "skill": skill_name,
                "importance": importance,
                "confidence": confidence,
                # Canonical priority formula: importance × (100 − confidence)
                "priority_score": importance * (100 - confidence),
                "category": item.get("category", "technical"),
            })

        gaps.sort(key=lambda x: x["priority_score"], reverse=True)
        return gaps
    finally:
        await db.close()
