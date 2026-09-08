"""Cyber Career OS - FastAPI Backend."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .core.config import CORS_ORIGINS
from .core.database import init_db
from .core.errors import register_error_handlers
from .api import ingest, graph, roles, skills, projects, ctf, applications, digest, obsidian, settings
from .services.rss import ingest_rss_feeds, process_pending_ingests
from .services.obsidian import is_enabled
from .core import settings_store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# The single authoritative in-process scheduler. Do not also run
# backend/scheduler.py or external crons for the same jobs (README).
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()

    scheduler.add_job(ingest_rss_feeds, "interval", hours=6, id="rss_ingest")
    scheduler.add_job(process_pending_ingests, "interval", minutes=30, id="process_pending")
    scheduler.add_job(
        skills.decay_confidence_scores,
        "cron", day_of_week="sun", hour=2, id="confidence_decay",
    )
    if await is_enabled():
        interval = int(await settings_store.get("obsidian.scan_interval_minutes", 30)) or 30
        from .services.obsidian import scan_vault
        scheduler.add_job(scan_vault, "interval", minutes=interval, id="obsidian_scan")
    scheduler.start()
    logging.getLogger(__name__).info("Scheduler started with jobs: %s", [j.id for j in scheduler.get_jobs()])

    yield

    # Shutdown
    scheduler.shutdown()


app = FastAPI(
    title="Cyber Career OS",
    description="Structured cybersecurity career development platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

# Register routers
app.include_router(ingest.router)
app.include_router(graph.router)
app.include_router(roles.router)
app.include_router(skills.router)
app.include_router(projects.router)
app.include_router(ctf.router)
app.include_router(applications.router)
app.include_router(digest.router)
app.include_router(obsidian.router)
app.include_router(settings.router)


@app.get("/")
async def root():
    return {
        "name": "Cyber Career OS",
        "version": "1.0.0",
        "endpoints": {
            "ingest": "/ingest",
            "graph": "/graph",
            "roles": "/roles",
            "skills": "/skills",
            "projects": "/projects",
            "ctf": "/ctf",
            "applications": "/applications",
            "digest": "/digest",
        }
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
