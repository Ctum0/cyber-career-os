"""Settings API — CRUD for app settings, folder browser, model list, connection test.

Security notes:
- `ai.api_key` is write-only: GET responses never return the stored secret,
  only a masked placeholder. The frontend sends an empty string to keep the
  existing key unchanged.
- The folder browser is bounded to configurable safe roots (or the user's
  home directory) and rejects traversal outside them.
"""
import logging
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from ..core import config, settings_store
from ..core.llm_client import list_models, test_connection

log = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

SECRET_KEYS = {"ai.api_key"}
SECRET_PLACEHOLDER = "••••••••"

# Safe roots for the folder browser: home + configured roots.
BROWSE_ROOTS = [
    str(Path.home()),
] + [p for p in os.getenv("SETTINGS_BROWSE_ROOTS", "").split(":") if p.strip()]


class SettingsUpdate(BaseModel):
    settings: dict[str, Any]


class PathBrowseRequest(BaseModel):
    path: str = ""


def _mask(settings: dict[str, Any]) -> dict[str, Any]:
    """Replace secret values with a masked placeholder for transport."""
    out = dict(settings)
    for key in SECRET_KEYS:
        if out.get(key):
            out[key] = SECRET_PLACEHOLDER
    return out


def _strip_secrets(settings: dict[str, Any]) -> dict[str, Any]:
    """Drop empty-string secrets so writes never clobber a stored key."""
    return {k: v for k, v in settings.items() if not (k in SECRET_KEYS and v == "")}


# ------------------------------------------------------------------ #
# CRUD
# ------------------------------------------------------------------ #
@router.get("")
async def get_all_settings():
    """Return all current settings (merged with defaults; secrets masked)."""
    return _mask(await settings_store.get_all())


@router.get("/{prefix}")
async def get_settings_group(prefix: str):
    """Return settings for a group (e.g. 'ai', 'obsidian', 'rss', 'advanced')."""
    return _mask(await settings_store.get_group(f"{prefix}."))


@router.put("")
async def update_settings(req: SettingsUpdate):
    """Update multiple settings at once. Keys must be fully qualified.

    A masked placeholder value for a secret key is ignored (keeps stored key).
    """
    valid_prefixes = {"ai", "obsidian", "rss", "advanced"}
    for key in req.settings:
        prefix = key.split(".")[0] if "." in key else ""
        if prefix not in valid_prefixes:
            raise HTTPException(status_code=400, detail=f"Unknown setting prefix: {prefix or key}")

    payload = {k: v for k, v in req.settings.items() if v != SECRET_PLACEHOLDER}
    await settings_store.set_many(_strip_secrets(payload))
    return {"status": "ok", "updated": list(req.settings.keys())}


# ------------------------------------------------------------------ #
# Folder browser (bounded)
# ------------------------------------------------------------------ #
def _is_within_roots(target: Path) -> bool:
    resolved = target.resolve()
    return any(
        resolved == Path(root).resolve() or root in resolved.parents
        for root in BROWSE_ROOTS
        if Path(root).exists()
    )


@router.post("/browse")
async def browse_folders(req: PathBrowseRequest):
    """Browse local folders (bounded to safe roots) for vault path selection."""
    if not req.path:
        start = str(Path.home())
    else:
        start = req.path

    target = Path(start).expanduser().resolve()

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {start}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {start}")
    if not _is_within_roots(target):
        raise HTTPException(status_code=403, detail="Path is outside the allowed browse roots")

    try:
        entries = []
        parent = target.parent
        if parent != target and _is_within_roots(parent):
            entries.append({"name": "..", "path": str(parent), "type": "parent"})

        try:
            items = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            raise HTTPException(status_code=403, detail=f"Permission denied: {start}")

        for item in items:
            if item.name.startswith(".") and item.name != ".obsidian":
                continue
            try:
                is_dir = item.is_dir()
            except PermissionError:
                continue

            entry = {
                "name": item.name,
                "path": str(item),
                "type": "directory" if is_dir else "file",
            }
            if is_dir:
                try:
                    entry["md_count"] = sum(
                        1 for f in item.iterdir() if f.is_file() and f.suffix == ".md"
                    )
                except PermissionError:
                    entry["md_count"] = -1
            else:
                try:
                    entry["size"] = item.stat().st_size if item.exists() else 0
                except OSError:
                    entry["size"] = 0
            entries.append(entry)

        return {
            "current_path": str(target),
            "is_vault": (target / ".obsidian").is_dir(),
            "entries": entries,
        }
    except HTTPException:
        raise
    except Exception as e:
        log.exception("Browse failed")
        raise HTTPException(status_code=500, detail="Could not browse this path.") from e


# ------------------------------------------------------------------ #
# AI Provider helpers
# ------------------------------------------------------------------ #
@router.get("/ai/models")
async def get_available_models():
    """Fetch available models from the configured AI provider."""
    try:
        models = await list_models()
        return {"models": models}
    except Exception as e:
        log.warning("Model list fetch failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not fetch models from the provider.") from e


@router.post("/ai/test")
async def test_ai_connection():
    """Test the configured AI provider connection."""
    result = await test_connection()
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result)
    return result


# ------------------------------------------------------------------ #
# Obsidian helpers
# ------------------------------------------------------------------ #
@router.post("/obsidian/validate")
async def validate_vault_path(req: PathBrowseRequest):
    """Validate that a path is a valid Obsidian vault (bounded to safe roots)."""
    target = Path(req.path).expanduser().resolve()

    if not target.exists():
        return {"valid": False, "reason": "Path does not exist"}
    if not target.is_dir():
        return {"valid": False, "reason": "Path is not a directory"}
    if not _is_within_roots(target):
        return {"valid": False, "reason": "Path is outside the allowed browse roots"}

    is_vault = (target / ".obsidian").is_dir()
    md_count = sum(
        1 for f in target.rglob("*.md")
        if not any(part.startswith(".") for part in f.relative_to(target).parts)
    )

    return {
        "valid": True,
        "is_vault": is_vault,
        "path": str(target),
        "md_count": md_count,
        "has_obsidian_config": is_vault,
    }
