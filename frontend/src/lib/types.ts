/** Typed data contracts mirroring backend responses (models/schemas.py +
 * router serializers). The backend normalizes JSON columns to real arrays —
 * the frontend never parses storage representation. */

export type ApiErrorShape = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type NodeType =
  | 'vuln' | 'tool' | 'mitigation' | 'skill' | 'project'
  | 'ctf' | 'role' | 'company' | 'interview_q' | 'source';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  description: string;
  confidence_score: number;
  last_touched: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: number;
  from_id: string;
  to_id: string;
  relation: string;
  created_at: string;
}

export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  nodes_by_type: Record<string, number>;
  top_skills: { label: string; confidence_score: number }[];
  recent_activity: { type: string; label: string; last_touched: string }[];
}

export interface GraphVisualization {
  nodes: { id: string; type: NodeType; label: string; score: number }[];
  links: { source: string; target: string; relation: string }[];
}

export type IngestSourceType = 'text' | 'url' | 'rss';

export interface IngestResult {
  id: number;
  status: string;
  source_node: string;
  edges_created: number;
}

export type QueueStatus = 'pending' | 'processing' | 'done' | 'error';

export interface QueueItem {
  id: number;
  source_type: string;
  source_url: string | null;
  raw_content: string;
  status: QueueStatus;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface SkillChecklistItem {
  skill: string;
  importance: number;
  category?: string;
}

export interface TargetRole {
  id: number;
  role_name: string;
  skill_checklist: SkillChecklistItem[];
  created_at: string;
}

export interface SkillGap {
  skill: string;
  importance: number;
  confidence: number;
  priority_score: number;
  category: string;
}

export interface AnkiCard {
  q: string;
  a: string;
}

export interface SkillModule {
  id: number;
  skill_node_id: string;
  lab_exercise: string | null;
  anki_cards: AnkiCard[];
  challenge: string | null;
  solution: string | null;
  feedback: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'reviewed';
  created_at: string;
  reviewed_at: string | null;
}

export interface SolutionReview {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  new_confidence: number;
}

export type ProjectStatus = 'idea' | 'active' | 'completed';

export interface ProjectIdea {
  title: string;
  description: string;
  architecture: string;
  stack: string[];
  stretch_goals: string[];
  skills_targeted: string[];
}

export interface Project {
  id: number;
  node_id: string | null;
  title: string;
  description: string | null;
  architecture: string | null;
  stack: string[];
  stretch_goals: string[];
  status: ProjectStatus;
  repo_path: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CTFWriteup {
  id: number;
  node_id: string | null;
  title: string | null;
  raw_notes: string | null;
  structured: Record<string, string>;
  techniques: string[];
  created_at: string;
}

export type ApplicationStatus = 'interested' | 'applied' | 'interview' | 'closed';

export interface Application {
  id: number;
  company: string;
  role_title: string;
  listing_text: string | null;
  required_skills: string[];
  real_gaps: string[];
  bluffable_gaps: string[];
  resume_bullets: string[];
  cover_letter: string | null;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

export interface WeeklyDigest {
  id: number;
  week_of: string;
  skill_gap_report: string | null;
  actions: string[];
  journal_entry: string | null;
  graph_activity: Record<string, unknown>;
  created_at: string;
}

export interface ObsidianStatus {
  enabled: boolean;
  source: string | null;
  vault_path: string | null;
  scan_interval_minutes: number | null;
  include_folders: string[];
  exclude_folders: string[];
  required_tags: string[];
  max_notes_per_scan: number | null;
  tracked_files: number;
  last_scanned_at: string | null;
  vault_source_nodes: number;
}

export interface ObsidianSyncResult {
  status?: string;
  reason?: string;
  scanned: number;
  ingested: number;
  indexed: number;
  excluded: number;
  unchanged: number;
  errors: number;
  notes: { path: string; status: string }[];
  error_details?: { path: string; error: string }[];
  triggered_at?: string;
  total_files?: number;
}

export interface SettingsMap {
  'ai.provider': string;
  'ai.base_url': string;
  'ai.api_key': string;
  'ai.model': string;
  'ai.vision_model': string;
  'ai.task_models': Record<string, string>;
  'obsidian.vault_path': string;
  'obsidian.scan_interval_minutes': number;
  'obsidian.required_tags': string[];
  'obsidian.include_folders': string[];
  'obsidian.exclude_folders': string[];
  'obsidian.max_notes_per_scan': number;
  'obsidian.max_images_per_note': number;
  'obsidian.max_image_size': number;
  'rss.feeds': string[];
  'advanced.confidence_decay_amount': number;
  'advanced.confidence_decay_days': number;
  [key: string]: unknown;
}

export interface BrowseEntry {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'parent';
  md_count?: number;
  size?: number;
}

export interface BrowseResult {
  current_path: string;
  is_vault: boolean;
  entries: BrowseEntry[];
}

export interface VaultValidation {
  valid: boolean;
  reason?: string;
  is_vault?: boolean;
  path?: string;
  md_count?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ConnectionTest {
  ok: boolean;
  provider: string;
  model: string;
  response?: string;
  error?: string;
}
