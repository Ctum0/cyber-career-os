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

## Deployment (Docker, single host)

```bash
docker compose -f docker-compose.yml up --build -d
```

Frontend: http://localhost:3000 · API docs: http://localhost:8000/docs.
Use the explicit `-f docker-compose.yml` — the repo root also has a
`compose.yaml` (development tooling: playwright-mcp) that compose v2 would
otherwise pick first.

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | backend/.env | — | Groq API key (bootstrap; Settings UI overrides) |
| `GROQ_MODEL` | backend/.env | `openai/gpt-oss-120b` | Default LLM model |
| `GROQ_VISION_MODEL` | backend/.env | `qwen/qwen3.6-27b` | Vision model (image extraction) |
| `CORS_ORIGINS` | backend/.env | `http://localhost:3000` | Comma-separated allowed browser origins |
| `BACKEND_URL` | frontend build arg | `http://backend:8000` | Backend address **as reachable from the frontend container** |
| `OBSIDIAN_VAULT_PATH` | backend/.env | unset | Optional: mount a vault and set the path (container-internal, e.g. a volume) |
| Ports | docker-compose.yml | `3000`, `127.0.0.1:8000` | Frontend/backend host ports (backend loopback-only — see Security) |

The backend container reads `backend/.env` via `env_file` — it is the env
source in compose. It feeds the `.env` bootstrap layer only: Settings UI / DB
values still win at runtime for anything configured there. `GROQ_API_KEY` etc.
are bootstrap fallbacks, not overrides of the UI.

`CORS_ORIGINS` must include the public frontend URL users actually browse
(e.g. `http://localhost:3000` locally, `https://your.domain` in production)
— requests blocked by CORS never reach the rewrite proxy.

`BACKEND_URL` is **baked at image build time**: Next.js evaluates the
`/api/:path*` rewrites once during `npm run build` and `next start` never
re-reads the variable (verified against Next 14.1.0). Rebuild the frontend
image to change it — setting a runtime env changes nothing:

```bash
docker compose -f docker-compose.yml up --build -d frontend
```

In compose the value is `http://backend:8000` (service name on the docker
network). It is the address the **frontend server** proxies to; browsers talk
to the frontend on :3000 only and never see it.

### Persistence & sizing

- SQLite database lives in the `backend-data` volume (`/app/data` inside the
  container). It survives container recreation; delete the volume to reset.
- Run exactly **one** backend instance. SQLite + the in-process scheduler
  (RSS ingest, queue processing, confidence decay, vault scans — see
  [Scheduler](#scheduler)) assume a single always-on process; **do not use
  serverless platforms** or scale `backend` beyond 1, or jobs run duplicated
  or split across writers.
- For Obsidian sync, mount the vault into the backend container and set
  `OBSIDIAN_VAULT_PATH` to the container-internal path.

### Security

This is a personal, unauthenticated tool: no route requires auth, including
`/settings` (the API key is masked in GET, but AI test/model endpoints and
all graph/ingest endpoints are open if the port is reachable). Do not expose
`:8000` to a network — compose binds it to `127.0.0.1` only; the frontend
container reaches the backend over the compose network, not the published
port. If you need remote access, put both apps behind a reverse proxy with
auth (e.g. Caddy/Traefik + basic auth) or a VPN (e.g. Tailscale), and keep
the backend port private regardless.
