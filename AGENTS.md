# AGENTS.md

## Project Overview
Cyber Career OS: a personal cybersecurity career-development app (ingest → knowledge graph → skill building → job applications). No root manifest — two independent apps in `backend/` and `frontend/`. Not a git repo; no tests, no CI.

## Run It
- `./start.sh` starts both: backend uvicorn on `:8000`, frontend `next dev` on `:3000`.
- Backend deps install into `backend/venv` (Python 3.13) from `backend/requirements.txt`. Run uvicorn with `backend/venv/bin/uvicorn app.main:app`.
- Backend needs `backend/.env` (`GROQ_API_KEY`, optional `GROQ_MODEL`) — copy `backend/.env.example`. Every LLM feature (ingest, roles, skills, projects, CTF, applications, digest) calls Groq via `backend/app/core/groq_client.py`; no key means runtime 500s for those endpoints (graph/digest-list/health work without it).
- **Settings UI**: Most configuration (AI provider, API key, model selection, Obsidian vault path, RSS feeds) is now configurable from the web UI at `/settings`. Settings are stored in the SQLite `settings` table and take precedence over `.env` values. The `.env` file serves as fallback only.
- **LLM Provider abstraction**: `backend/app/core/llm_client.py` provides a unified `chat_completion()` interface that routes to Groq, OpenAI, or any OpenAI-compatible endpoint based on settings. `groq_client.py` delegates to `llm_client` for all LLM calls. Per-task model overrides are supported (e.g., use Groq for entity extraction, OpenAI for solution review).
- Frontend: `npm run dev` in `frontend/`. No lint/test/typecheck scripts; `npm run build` is the de-facto typecheck gate (Next 14 runs tsc during build). `npm run lint` will interactively scaffold ESLint on first run — don't run it non-interactively.

## Test It
- `./test.sh` smoke-tests the backend: installs missing deps, boots the API, and asserts core endpoints (`/health`, `/graph/*`, `/digest`, `/ingest/queue`) return 200 — these need no GROQ key. With a real `GROQ_API_KEY` in `backend/.env`, it also exercises the LLM endpoints (`/ingest/text`, `/roles`).
- `./test.sh --full` additionally runs `npm run build` to type-check and compile the frontend.
- `PORT=8001 ./test.sh` to run against a non-default port.

## Important: entry point location and relative imports
The FastAPI app entrypoint lives at `backend/app/main.py` (not `backend/main.py`) — run it as `uvicorn app.main:app` from `backend/`. All backend imports are package-relative and must stay resolvable from that location:
- `app/api/*.py`, `app/core/*.py`, `app/models/schemas.py`, `app/services/rss.py` all import siblings via `..core`, `..models`, or `..core.config` (never a bare single-dot sibling across `core`, and `app/services/rss.py` must use `..core.*`, not `.config`/`.database`/`.groq_client`).
- If you add a new `app/<dir>/foo.py`, keep its relative imports consistent with this layout or the API won't import.
- Scheduled jobs registered inside `main.py`'s lifespan run in the running event loop: pass the coroutine function directly (`scheduler.add_job(skills.decay_confidence_scores, ...)`), never `lambda: asyncio.run(...)`.

## Architecture
- **Backend** (`backend/app/`): FastAPI + SQLite via aiosqlite (WAL, no ORM), Pydantic v2 schemas in `models/schemas.py`. One APIRouter file per page feature: `api/{ingest,graph,roles,skills,projects,ctf,applications,digest}.py`, all mounted in `main.py`. DB access is inline `get_db()` + raw SQL everywhere; row_factory is `aiosqlite.Row` (access columns by name).
- **DB**: `backend/data/cybercareer.db`, auto-created and gitignored. Baseline schema + ordered migrations tracked in `schema_migrations` (`app/core/database.py`); `init_db()` runs them at app startup. Node IDs are `{type}_{uuid4hex8}`, identity is `(type, label_norm)` with a DB-unique index; all graph writes go through `app/services/graph.py`.
- **Confidence scores**: 0–100, default 50; weekly decay (Sunday 2 AM) drops untouched skills by `advanced.confidence_decay_amount` (default 5), gated once per UTC day (`advanced.last_decay_run` watermark; `POST /skills/decay?force=true` overrides). Groq review responses overwrite a skill's score.
- **Scheduled jobs** run in one in-process scheduler (main.py lifespan; no standalone scheduler.py exists): RSS ingest every 6 h, pending-ingest processing every 30 min, confidence decay Sunday 2 AM, Obsidian vault scan (only if vault path set; interval changes via Settings reschedule the live job — no restart).

### Settings system (`app/api/settings.py`, `app/core/settings_store.py`)
- **Settings table**: `settings` table in SQLite with `key` (PK), `value` (JSON-encoded), `updated_at`. Schema in `database.py`.
- **Settings store**: `app/core/settings_store.py` provides `get()`, `set()`, `set_many()`, `get_all()`, `get_group()`. In-memory cache populated on first read, updated on every write. Defaults defined in `DEFAULTS` dict.
- **Settings API**: `app/api/settings.py` — `GET /settings` (all), `GET /settings/{prefix}` (group), `PUT /settings` (bulk update), `POST /settings/browse` (folder browser), `POST /settings/obsidian/validate` (vault validation), `GET /settings/ai/models` (fetch models from provider), `POST /settings/ai/test` (test connection).
- **Frontend**: `frontend/src/app/settings/page.tsx` — 4 tabs: AI Provider, Obsidian Vault, RSS Feeds, Advanced. Folder browser with click-through navigation.

### LLM provider abstraction (`app/core/llm_client.py`)
- Unified client that routes to Groq, OpenAI, or any OpenAI-compatible endpoint based on settings.
- `chat_completion()` — raw API call via httpx. `chat_completion_text()` — convenience wrapper. `chat_completion_json()` — parses JSON response.
- `list_models()` — fetches available models from provider's `/models` endpoint.
- `test_connection()` — verifies config works with a simple test prompt.
- Provider defaults in `PROVIDER_DEFAULTS` dict. Per-task model overrides via `ai.task_models` setting.
- `groq_client.py` delegates to `llm_client` for all LLM calls. Prompt templates and fallback logic preserved.

### Obsidian vault sync (`app/services/obsidian.py`)
- Reads an Obsidian vault into the graph **strictly read-only** (vault files opened `rb` only; `.obsidian/`, `.trash/`, `.git` always skipped). Incremental via content hashes in the `vault_files` table — only new/changed notes are processed.
- Source abstraction: `ObsidianSource` ABC → `LocalFolderSource` (default) + `GitRepoSource` stub (unimplemented, for remote hosting later). Add sources by implementing the ABC — parsing/ingestion is shared in `scan_vault()`.
- Config: vault path, include/exclude folders, required tags (gate for LLM extraction; untagged notes are indexed only, no LLM call), max notes per scan, max images per note, max image size (Pillow downscale) — all env-bootstrapped via `backend/.env` (see `.env.example`) and runtime-configurable in Settings → Obsidian Vault (scan interval included).
- Embedded images (`![[name.png]]`) are base64-fed to the Groq vision model (`groq_client.describe_image`) and merged into entity extraction. Uses Pillow + `python-frontmatter`.
- Deps: `Pillow`, `python-frontmatter` were added to `requirements.txt`. Restart the backend after changing vault config (config reads at import).
- **Tests**: `test.sh` builds a throwaway fixture vault at `backend/data/vault_test` (never the real one), overrides `OBSIDIAN_VAULT_PATH` in `.env` if unset, and asserts `/obsidian/status` + `/obsidian/sync` plus config-redection. Keep tests pointed at the fixture, never the real vault.
- **Frontend** (`frontend/src/`): Next.js 14 App Router, TS, Tailwind. Every page is a client component (`'use client'`) in `src/app/<feature>/page.tsx`; fixed Sidebar in `layout.tsx`.
  - **Never call `localhost:8000` directly.** `next.config.js` rewrites `/api/:path*` → `http://localhost:8000/:path*`. Use the typed client in `src/lib/api.ts` (`API_BASE = '/api'`).
  - Use `@/*` alias → `src/*` (tsconfig), e.g. `@/lib/api`, `@/components/Sidebar`.
  - Reuse the app's utility classes from `globals.css` (`.card`, `.btn-primary`, `.btn-secondary`, `.input`, `.badge`) and the `cyber-*` green palette from `tailwind.config.js` instead of ad-hoc styling.

## Code Style
- Use descriptive variable names; follow existing patterns in the codebase; extract complex conditions into meaningful boolean variables.
- Backend: async def + `await` everywhere (aiosqlite + httpx + Groq client are all async); always close the db in a `finally:`.
- Frontend: functional components, Tailwind classes, no extra UI libs beyond `lucide-react`/`clsx`.

## Verify Changes
- Backend: start the API (after fixing the import issue above) and hit `http://localhost:8000/health`; interactive docs at `/docs`.
- Frontend: `npm run build` (type-checks) and `npm run dev`, then exercise the page in the browser against a running backend.
