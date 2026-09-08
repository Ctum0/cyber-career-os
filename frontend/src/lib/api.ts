/** Typed API client — the single frontend boundary for all backend calls.
 * Errors carry the backend's structured message so UI can show actionable
 * feedback instead of bare status codes. */
import type {
  ApiErrorShape, Application, ApplicationStatus, BrowseResult, ConnectionTest,
  CTFWriteup, GraphEdge, GraphNode, GraphStats, GraphVisualization, IngestResult,
  ModelInfo, ObsidianStatus, ObsidianSyncResult, Project, ProjectIdea,
  QueueItem, SettingsMap, SkillGap, SkillModule, SolutionReview, TargetRole,
  VaultValidation, WeeklyDigest,
} from './types';

const API_BASE = '/api';

/** Error with a human-readable message extracted from the backend contract. */
export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch {
    throw new ApiError('Cannot reach the backend. Is it running?', 'NETWORK_ERROR', 0);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = 'HTTP_ERROR';
    let details: Record<string, unknown> = {};
    try {
      const body = (await res.json()) as ApiErrorShape;
      if (body?.error?.message) {
        message = body.error.message;
        code = body.error.code ?? code;
        details = body.error.details ?? details;
      }
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(message, code, res.status, details);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// ------------------------------------------------------------------ //
// Ingest
// ------------------------------------------------------------------ //
export function ingestText(content: string, sourceType = 'text', sourceUrl?: string) {
  return fetchJson<IngestResult>('/ingest/text', {
    method: 'POST',
    body: JSON.stringify({ content, source_type: sourceType, source_url: sourceUrl }),
  });
}

export function getIngestQueue(status?: string) {
  return fetchJson<QueueItem[]>(`/ingest/queue${qs({ status })}`);
}

export function retryQueueItem(id: number) {
  return fetchJson<{ id: number; status: string }>(`/ingest/queue/${id}/retry`, { method: 'POST' });
}

// ------------------------------------------------------------------ //
// Graph
// ------------------------------------------------------------------ //
export function getGraphNodes(type?: string, search?: string) {
  return fetchJson<GraphNode[]>(`/graph/nodes${qs({ type, search })}`);
}

export function getGraphNode(id: string) {
  return fetchJson<{ node: GraphNode; edges_out: GraphEdge[]; edges_in: GraphEdge[] }>(
    `/graph/nodes/${encodeURIComponent(id)}`
  );
}

export function getGraphStats() {
  return fetchJson<GraphStats>('/graph/stats');
}

export function getGraphVisualization() {
  return fetchJson<GraphVisualization>('/graph/visualize');
}

export function updateNodeConfidence(nodeId: string, score: number) {
  return fetchJson<{ id: string; confidence_score: number }>(
    `/graph/nodes/${encodeURIComponent(nodeId)}/confidence${qs({ score })}`,
    { method: 'PATCH' }
  );
}

// ------------------------------------------------------------------ //
// Roles
// ------------------------------------------------------------------ //
export function setTargetRole(roleName: string, listingText?: string) {
  return fetchJson<TargetRole>('/roles', {
    method: 'POST',
    body: JSON.stringify({ role_name: roleName, listing_text: listingText }),
  });
}

export function getTargetRoles() {
  return fetchJson<TargetRole[]>('/roles');
}

export function getSkillGaps(roleName: string) {
  return fetchJson<SkillGap[]>(`/roles/${encodeURIComponent(roleName)}/gaps`);
}

// ------------------------------------------------------------------ //
// Skills
// ------------------------------------------------------------------ //
export function generateSkillModules(limit = 5) {
  return fetchJson<{ created: number; modules: SkillModule[] }>(
    `/skills/modules/generate${qs({ limit })}`,
    { method: 'POST' }
  );
}

export function getSkillModules(status?: string) {
  return fetchJson<SkillModule[]>(`/skills/modules${qs({ status })}`);
}

export function submitSolution(moduleId: number, solution: string) {
  return fetchJson<SolutionReview>(`/skills/modules/${moduleId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ solution }),
  });
}

// ------------------------------------------------------------------ //
// Projects
// ------------------------------------------------------------------ //
export function getProjectIdeas() {
  return fetchJson<ProjectIdea[]>('/projects/ideas');
}

export function createProject(idea: ProjectIdea) {
  return fetchJson<{ id: number; node_id: string; title: string; status: string }>(
    '/projects',
    { method: 'POST', body: JSON.stringify(idea) }
  );
}

export function getProjects(status?: string) {
  return fetchJson<Project[]>(`/projects${qs({ status })}`);
}

export function completeProject(projectId: number) {
  return fetchJson<{ status: string; skills_boosted: boolean }>(
    `/projects/${projectId}/complete`,
    { method: 'POST' }
  );
}

// ------------------------------------------------------------------ //
// CTF
// ------------------------------------------------------------------ //
export function createCTFWriteup(rawNotes: string, title?: string) {
  return fetchJson<CTFWriteup>('/ctf/writeup', {
    method: 'POST',
    body: JSON.stringify({ raw_notes: rawNotes, title }),
  });
}

export function getCTFWriteups() {
  return fetchJson<CTFWriteup[]>('/ctf/writeups');
}

// ------------------------------------------------------------------ //
// Applications
// ------------------------------------------------------------------ //
export function createApplication(company: string, roleTitle: string, listingText: string) {
  return fetchJson<Application>('/applications', {
    method: 'POST',
    body: JSON.stringify({ company, role_title: roleTitle, listing_text: listingText }),
  });
}

export function getApplications(status?: string) {
  return fetchJson<Application[]>(`/applications${qs({ status })}`);
}

export function updateApplication(appId: number, updates: { status?: ApplicationStatus }) {
  return fetchJson<Application>(`/applications/${appId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// ------------------------------------------------------------------ //
// Digest
// ------------------------------------------------------------------ //
export function generateDigest() {
  return fetchJson<WeeklyDigest>('/digest/generate', { method: 'POST' });
}

export function getDigests() {
  return fetchJson<WeeklyDigest[]>('/digest');
}

export function updateJournal(digestId: number, journalEntry: string) {
  return fetchJson<WeeklyDigest>(`/digest/${digestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ journal_entry: journalEntry }),
  });
}

// ------------------------------------------------------------------ //
// Obsidian
// ------------------------------------------------------------------ //
export function getObsidianStatus() {
  return fetchJson<ObsidianStatus>('/obsidian/status');
}

export function triggerObsidianSync(limit?: number) {
  return fetchJson<ObsidianSyncResult>(`/obsidian/sync${qs({ limit })}`, { method: 'POST' });
}

// ------------------------------------------------------------------ //
// Health & Settings
// ------------------------------------------------------------------ //
export function getHealthCheck() {
  return fetchJson<{ status: string }>('/health');
}

export function getAllSettings() {
  return fetchJson<SettingsMap>('/settings');
}

export function updateSettings(settings: Record<string, unknown>) {
  return fetchJson<{ status: string; updated: string[] }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
}

export function browseFolders(path?: string) {
  return fetchJson<BrowseResult>('/settings/browse', {
    method: 'POST',
    body: JSON.stringify({ path: path || '' }),
  });
}

export function validateVaultPath(path: string) {
  return fetchJson<VaultValidation>('/settings/obsidian/validate', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function getAvailableModels() {
  return fetchJson<{ models: ModelInfo[] }>('/settings/ai/models');
}

export function testAIConnection() {
  return fetchJson<ConnectionTest>('/settings/ai/test', { method: 'POST' });
}
