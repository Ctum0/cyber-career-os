# Cyber Career OS

Structured cybersecurity career development platform. Ingest security content into a
knowledge graph, map skill gaps against target roles, train with AI-generated modules,
and analyze job listings — all local-first, with any OpenAI-compatible LLM provider.

## Quick Start

```bash
./start.sh            # backend :8000 + frontend :3000
./test.sh             # backend smoke test (no API key needed)
./test.sh --full      # + frontend type-check build
```

Manual setup:

```bash
# Backend
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # optional; see Configuration below
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev            # http://localhost:3000
```

## Architecture

```
Browser (localhost:3000)
  ↓ Next.js rewrite  /api/:path* → http://localhost:8000/:path*
FastAPI (backend/app/main.py)
  ├─ 10 feature routers (api/*.py)          — HTTP concerns only
  ├─ services/graph.py                      — canonical node/edge writer (all ingestion uses this)
  ├─ services/rss.py, services/obsidian.py  — feed + vault ingestion
  ├─ core/groq_client.py                    — prompts + graceful LLM fallbacks
  ├─ core/llm_client.py                     — provider routing (Groq / OpenAI / custom)
  ├─ core/settings_store.py                 — runtime settings (SQLite, cached)
  └─ core/database.py                       — SQLite + ordered migrations
```

Pages: Dashboard, Ingest, Obsidian Vault, Knowledge Graph, Target Roles,
Skill Pipeline, Projects, CTF Write-ups, Applications, Weekly Digest, Settings.

## Configuration

One runtime source of truth: the SQLite `settings` table, editable in the UI at
`/settings`. Precedence per key:

1. **Settings UI / DB** (wins — takes effect without restarts)
2. **Defaults in `core/settings_store.py`**, which chain to
3. **`.env` bootstrap values** (`core/config.py`)

`.env` values (e.g. `GROQ_API_KEY`, `OBSIDIAN_VAULT_PATH`) are bootstrap fallbacks.
The `ai.api_key` setting is write-only from the UI: the API never returns it, only a
masked placeholder. Folder browsing in Settings is bounded to safe roots.

## Scheduler

One authoritative in-process scheduler (registered in `app/main.py` lifespan):

| Job | Schedule |
|---|---|
| RSS feed ingest | every 6 h |
| Pending queue processing | every 30 min |
| Confidence decay | Sunday 2 AM (amount/days configurable in Settings → Advanced) |
| Obsidian vault scan | every N min (only when a vault path is configured) |

Digest generation is **manual** (`POST /digest/generate` or the Weekly Digest page).
Do not also run `cron` jobs or a second scheduler for the same work.

Queue state machine: `pending → processing → done | error`. Failed items are re-drivable
via the Retry action on the Ingest page (`POST /ingest/queue/{id}/retry`). Items stuck in
`processing` (crash mid-job) are requeued automatically after 60 minutes.

## Database

SQLite at `backend/data/cybercareer.db` (WAL, foreign keys on, per-connection busy timeout).
Schema = baseline in `core/database.py` + ordered migrations tracked in `schema_migrations`.
Migrations run at startup and are idempotent; node identity is `(type, label_norm)` with a
unique index — `label_norm` is the lowercased/whitespace-collapsed comparison key, `label`
keeps the display casing. Before risky schema work, back up the DB file.

## Obsidian sync

Strictly read-only: vault files are opened `rb` only; `.obsidian/`, `.trash/`, `.git` are
always skipped. Incremental via SHA-256 content hashes (`vault_files` table). Notes with a
required tag get LLM entity extraction (embedded images via the vision model); untagged
notes are indexed by title/folder only — no LLM call, no quota burn.

## Development

```bash
cd backend && ./venv/bin/python -m pytest tests/ -q   # unit tests (35)
cd frontend && npx tsc --noEmit                        # type check
cd frontend && npm run build                           # type-check build gate
./test.sh --full                                       # smoke + build
```

Backend tests run against isolated temp databases — the real DB is never touched.

## API

Interactive docs at `http://localhost:8000/docs`. Errors use one shape:
`{"error": {"code": "...", "message": "...", "details": {}}}` — messages are safe to
display; technical detail stays in server logs.
