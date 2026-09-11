"""Page 5: Project Factory API routes."""
import json

from fastapi import APIRouter, HTTPException

from ..core.database import get_db
from ..core.errors import AppError
from ..core.groq_client import generate_project_ideas
from ..core.serialize import as_list
from ..models.schemas import ProjectCreate
from ..services import graph

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/ideas")
async def get_project_ideas():
    """Generate project ideas based on weakest high-priority skills."""
    db = await get_db()
    try:
        roles = await db.execute("SELECT skill_checklist FROM target_roles LIMIT 3")
        all_skills = []
        for role in await roles.fetchall():
            all_skills.extend(as_list(role["skill_checklist"]))

        # Weakest skills ranked by the canonical priority formula.
        weak_skills = []
        for item in all_skills:
            skill_name = item.get("skill", "")
            if not skill_name:
                continue
            skill_id = await graph.find_node(db, "skill", skill_name)
            confidence = 0
            if skill_id:
                conf_row = await db.execute(
                    "SELECT confidence_score FROM nodes WHERE id = ?", (skill_id,)
                )
                hit = await conf_row.fetchone()
                confidence = hit["confidence_score"] if hit else 0
            weak_skills.append({
                "skill": skill_name,
                "priority": item.get("importance", 5) * (100 - confidence),
            })

        weak_skills.sort(key=lambda x: x["priority"], reverse=True)
        top_weak = [s["skill"] for s in weak_skills[:3]]

        if not top_weak:
            top_weak = ["network security", "incident response", "threat hunting"]

        recent = await db.execute(
            "SELECT raw_content FROM ingest_queue WHERE status = 'done' ORDER BY created_at DESC LIMIT 5"
        )
        trends = "\n".join([r["raw_content"][:200] for r in await recent.fetchall()])
        if not trends:
            trends = "Focus on current threats: ransomware, cloud misconfigurations, supply chain attacks"

        try:
            ideas = await generate_project_ideas(top_weak, trends)
        except Exception as e:
            raise AppError("IDEAS_FAILED", "Could not generate project ideas.", 502) from e
        if isinstance(ideas, dict):
            ideas = ideas.get("projects", ideas.get("ideas", []))

        return ideas
    finally:
        await db.close()


@router.post("")
async def create_project(req: ProjectCreate):
    """Create a project and link it to the skills it builds."""
    db = await get_db()
    try:
        # Atomic unit: project node + builds_skill edges + project row
        node_id = await graph.find_or_create_node(db, "project", req.title, req.description or "")

        for skill_name in req.skills_targeted:
            skill_id = await graph.find_node(db, "skill", skill_name)
            if skill_id:
                await graph.create_edge(db, node_id, skill_id, "builds_skill")

        cursor = await db.execute(
            """INSERT INTO projects (node_id, title, description, architecture, stack, stretch_goals)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                node_id, req.title, req.description,
                req.architecture, req.stack,
                json.dumps(req.stretch_goals),
            ),
        )
        await db.commit()

        return {
            "id": cursor.lastrowid,
            "node_id": node_id,
            "title": req.title,
            "status": "active",
        }
    finally:
        await db.close()


@router.get("")
async def list_projects(status: str | None = None):
    """List projects, optionally filtered by status."""
    db = await get_db()
    try:
        if status:
            rows = await db.execute(
                "SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC", (status,)
            )
        else:
            rows = await db.execute("SELECT * FROM projects ORDER BY created_at DESC")
        results = []
        for r in await rows.fetchall():
            d = dict(r)
            d["stretch_goals"] = as_list(d["stretch_goals"])
            d["stack"] = as_list(d["stack"])
            results.append(d)
        return results
    finally:
        await db.close()


@router.post("/{project_id}/complete")
async def mark_project_complete(project_id: int):
    """Mark project as complete and boost linked skill confidence."""
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project = await row.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Atomic unit: project completion + skill confidence boosts
        await db.execute(
            "UPDATE projects SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
            (project_id,),
        )

        if project["node_id"]:
            edges = await db.execute(
                "SELECT to_id FROM edges WHERE from_id = ? AND relation = 'builds_skill'",
                (project["node_id"],),
            )
            for edge in await edges.fetchall():
                await graph.boost_confidence(db, edge["to_id"], 10)

        await db.commit()
        return {"status": "completed", "skills_boosted": True}
    finally:
        await db.close()
