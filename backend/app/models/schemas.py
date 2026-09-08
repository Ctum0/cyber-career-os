"""Pydantic models for API request/response."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class NodeCreate(BaseModel):
    type: str
    label: str
    description: str = ""
    confidence_score: float = 50.0
    metadata: dict = {}


class NodeResponse(BaseModel):
    id: str
    type: str
    label: str
    description: str
    confidence_score: float
    last_touched: str
    created_at: str
    metadata: dict


class EdgeCreate(BaseModel):
    from_id: str
    to_id: str
    relation: str


class EdgeResponse(BaseModel):
    id: int
    from_id: str
    to_id: str
    relation: str
    created_at: str


class IngestTextRequest(BaseModel):
    content: str
    source_type: str = "text"
    source_url: Optional[str] = None


class IngestResponse(BaseModel):
    id: int
    status: str
    source_node: str = ""
    edges_created: int = 0


class TargetRoleCreate(BaseModel):
    role_name: str
    listing_text: Optional[str] = None


class TargetRoleResponse(BaseModel):
    id: int
    role_name: str
    skill_checklist: list[dict]
    created_at: str


class GapAnalysisResponse(BaseModel):
    skill: str
    importance: int
    confidence: float
    priority_score: float
    category: str


class SkillModuleCreate(BaseModel):
    skill_node_id: str


class SkillModuleResponse(BaseModel):
    id: int
    skill_node_id: str
    lab_exercise: str
    anki_cards: list[dict]
    challenge: str
    status: str


class SolutionSubmit(BaseModel):
    solution: str


class SolutionReviewResponse(BaseModel):
    score: int
    feedback: str
    strengths: list[str]
    improvements: list[str]
    new_confidence: float


class ProjectIdeaResponse(BaseModel):
    title: str
    description: str
    architecture: str
    stack: str
    stretch_goals: list[str]
    skills_targeted: list[str]


class ProjectCreate(BaseModel):
    title: str
    description: str
    architecture: str
    stack: str
    stretch_goals: list[str]
    skills_targeted: list[str]


class ProjectResponse(BaseModel):
    id: int
    node_id: Optional[str]
    title: str
    description: str
    architecture: str
    stack: str
    stretch_goals: str
    status: str
    created_at: str


class CTFWriteupRequest(BaseModel):
    raw_notes: str
    title: Optional[str] = None


class CTFWriteupResponse(BaseModel):
    id: int
    title: str
    structured: dict
    techniques: list[str]
    node_id: Optional[str]


class ApplicationCreate(BaseModel):
    company: str
    role_title: str
    listing_text: str


class ApplicationUpdate(BaseModel):
    status: Optional[str] = None
    listing_text: Optional[str] = None


class ApplicationResponse(BaseModel):
    id: int
    company: str
    role_title: str
    required_skills: list[str]
    real_gaps: list[str]
    bluffable_gaps: list[str]
    resume_bullets: list[str]
    cover_letter: str
    status: str
    created_at: str
    updated_at: str


class WeeklyDigestResponse(BaseModel):
    id: int
    week_of: str
    skill_gap_report: str
    actions: list[str]
    journal_entry: str
    graph_activity: dict
    created_at: str


class GraphStatsResponse(BaseModel):
    total_nodes: int
    total_edges: int
    nodes_by_type: dict[str, int]
    top_skills: list[dict]
    recent_activity: list[dict]


class JournalUpdateRequest(BaseModel):
    journal_entry: str

