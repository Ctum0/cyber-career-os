"""Obsidian Vault sync API routes."""
from datetime import datetime

from fastapi import APIRouter

from ..core import settings_store
from ..core.database import get_db
from ..services.obsidian import is_enabled, load_config, scan_vault

router = APIRouter(prefix="/obsidian", tags=["obsidian"])


@router.get("/status")
async def get_status():
    """Report vault sync configuration and last-run statistics."""
    enabled = await is_enabled()
    db = await get_db()
    try:
        row = await db.execute(
            "SELECT COUNT(*) as c, MAX(last_scanned_at) as last_scan FROM vault_files"
        )
        stats = await row.fetchone()

        nodes = await db.execute(
            "SELECT COUNT(*) as c FROM nodes WHERE type = 'source' AND metadata LIKE '%vault%'"
        )
        source_count = (await nodes.fetchone())["c"]
    finally:
        await db.close()

    if enabled:
        cfg = await load_config()
        interval = (await settings_store.get("obsidian.scan_interval_minutes", 0)) or 30
        return {
            "enabled": True,
            "source": "local",
            "vault_path": cfg.vault_path,
            "scan_interval_minutes": interval,
            "include_folders": cfg.include_folders,
            "exclude_folders": cfg.exclude_folders,
            "required_tags": cfg.required_tags,
            "max_notes_per_scan": cfg.max_notes_per_scan,
            "tracked_files": stats["c"],
            "last_scanned_at": stats["last_scan"],
            "vault_source_nodes": source_count,
        }

    return {
        "enabled": False,
        "source": None,
        "vault_path": None,
        "scan_interval_minutes": None,
        "include_folders": [],
        "exclude_folders": [],
        "required_tags": [],
        "max_notes_per_scan": None,
        "tracked_files": stats["c"],
        "last_scanned_at": stats["last_scan"],
        "vault_source_nodes": source_count,
    }


@router.post("/sync")
async def trigger_sync(limit: int | None = None):
    """Run a vault sync pass now."""
    results = await scan_vault(limit=limit)
    results["triggered_at"] = datetime.now().isoformat(timespec="seconds")
    return results
