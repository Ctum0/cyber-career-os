"""Obsidian vault ingestion: read-only sync into the knowledge graph.

The app NEVER writes to the vault. All vault reads happen via the source's
read_file() (opened 'rb'), and Obsidian's internal .obsidian/ folder is always
skipped. Change detection is content-hash based, so only new or modified notes
are re-processed.

Configuration is read per-scan from the settings store (DB values win over
.env bootstrap values in core.config). Changing vault settings takes effect on
the next scan — no restart needed.
"""
import asyncio
import base64
import hashlib
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from ..core import config, settings_store
from ..core.database import get_db
from ..core import groq_client
from . import graph

log = logging.getLogger(__name__)

# Prevent concurrent scans (scheduler job + manual endpoint).
_scan_lock = asyncio.Lock()

SKIP_DIRS = {".obsidian", ".trash", ".git", ".metadata", "node_modules"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


@dataclass
class VaultConfig:
    """Effective Obsidian configuration, resolved per scan."""

    vault_path: str
    include_folders: list[str] = field(default_factory=list)
    exclude_folders: list[str] = field(default_factory=list)
    required_tags: list[str] = field(default_factory=list)
    attachments_dir: str = ""
    max_notes_per_scan: int = 10
    max_images_per_note: int = 5
    max_image_size: int = 1024


async def load_config() -> VaultConfig:
    """Resolve effective config: DB setting wins, else env bootstrap value."""
    vault_path = (await settings_store.get("obsidian.vault_path", "") or "").strip()
    return VaultConfig(
        vault_path=vault_path or config.OBSIDIAN_VAULT_PATH.strip(),
        include_folders=await settings_store.get("obsidian.include_folders", []) or config.OBSIDIAN_INCLUDE_FOLDERS,
        exclude_folders=await settings_store.get("obsidian.exclude_folders", []) or config.OBSIDIAN_EXCLUDE_FOLDERS,
        required_tags=await settings_store.get("obsidian.required_tags", []) or config.OBSIDIAN_REQUIRED_TAGS,
        attachments_dir=(await settings_store.get("obsidian.attachments_dir", "")) or config.OBSIDIAN_ATTACHMENTS_DIR,
        max_notes_per_scan=(await settings_store.get("obsidian.max_notes_per_scan", 0)) or config.OBSIDIAN_MAX_NOTES_PER_SCAN,
        max_images_per_note=(await settings_store.get("obsidian.max_images_per_note", 0)) or config.OBSIDIAN_MAX_IMAGES_PER_NOTE,
        max_image_size=(await settings_store.get("obsidian.max_image_size", 0)) or config.OBSIDIAN_MAX_IMAGE_SIZE,
    )


async def is_enabled() -> bool:
    cfg = await load_config()
    return bool(cfg.vault_path)


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #
class ObsidianSource(ABC):
    """Read-only abstraction over a vault. Implementations must not write."""

    source_type = "unknown"

    @abstractmethod
    def list_markdown_files(self) -> list[str]:
        """Return relative paths (POSIX-style) of all .md files in the vault."""

    @abstractmethod
    def read_file(self, rel_path: str) -> bytes:
        """Return raw bytes of a vault file."""

    @abstractmethod
    def stat_mtime(self, rel_path: str) -> float:
        """Return file mtime (seconds since epoch)."""


class LocalFolderSource(ObsidianSource):
    """Reads the vault folder in place. Strictly read-only."""

    source_type = "local"

    def __init__(self, root: str):
        self.root = Path(root)

    def list_markdown_files(self) -> list[str]:
        found = []
        for p in sorted(self.root.rglob("*")):
            rel = p.relative_to(self.root)
            if self._is_skipped(rel):
                continue
            if p.is_file() and p.suffix.lower() == ".md":
                found.append(rel.as_posix())
        return found

    def _is_skipped(self, rel: Path) -> bool:
        parts = rel.parts
        return any(part in SKIP_DIRS for part in parts) or rel.name.startswith(".")

    def read_file(self, rel_path: str) -> bytes:
        with open(self.root / rel_path, "rb") as f:
            return f.read()

    def stat_mtime(self, rel_path: str) -> float:
        return (self.root / rel_path).stat().st_mtime


class GitRepoSource(ObsidianSource):
    """Deferred: pulls the vault from a private GitHub repo into an app-owned
    mirror directory, then reads it. The vault itself is never touched."""

    source_type = "git"

    def __init__(self, repo_url: str, token: str, mirror_dir: Path):
        if not repo_url or not token:
            raise NotImplementedError(
                "GitHub Obsidian source not configured (OBSIDIAN_REPO_URL / OBSIDIAN_GITHUB_TOKEN)"
            )
        self.repo_url = repo_url
        self.token = token
        self.mirror = mirror_dir
        raise NotImplementedError("GitHub Obsidian source is not implemented yet.")


def build_source(cfg: VaultConfig) -> ObsidianSource:
    if not cfg.vault_path:
        raise ValueError("Obsidian vault sync is not enabled (no vault path configured)")
    return LocalFolderSource(cfg.vault_path)


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #
def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Return (frontmatter dict, body-without-frontmatter)."""
    if not content.startswith("---"):
        return {}, content
    lines = content.split("\n")
    end = None
    for i in range(1, min(len(lines), 200)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}, content

    fm: dict = {}
    for line in lines[1:end]:
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if not key:
            continue
        if value.startswith("["):
            value = value.strip("[]")
            items = [v.strip().strip("'\"") for v in value.split(",") if v.strip()]
            fm[key] = items
        else:
            fm[key] = value.strip("'\"")
    body = "\n".join(lines[end + 1:])
    return fm, body


def extract_tags(content: str, fm: dict) -> list[str]:
    """Collect tags from frontmatter and inline #tags in the body."""
    tags: list[str] = []
    raw = fm.get("tags")
    if isinstance(raw, list):
        tags.extend(raw)
    elif isinstance(raw, str):
        tags.extend([t.strip().lstrip("#") for t in raw.split(",") if t.strip()])

    for token in content.split():
        if token.startswith("#") and len(token) > 1:
            candidate = token[1:].split("|")[0]
            if not candidate or candidate.replace("#", "").strip() == "":
                continue
            if "/" not in candidate and candidate.isprintable():
                tags.append(candidate)
    # De-dupe, keep order, normalize to lowercase for matching
    seen, out = set(), []
    for t in tags:
        key = t.lower()
        if key not in seen:
            seen.add(key)
            out.append(t)
    return out


def extract_title(content: str, fm: dict, rel_path: str) -> str:
    title = str(fm.get("title", "")).strip()
    if title:
        return title
    for line in content.split("\n"):
        if line.startswith("# ") and line.strip() != "#":
            return line[2:].strip()
    return Path(rel_path).stem


def extract_embeds(content: str) -> list[str]:
    """Return embedded attachment names from ![[name.ext]] references."""
    names = []
    for token in content.split():
        if not token.startswith("![["):
            continue
        inner = token[3:]
        if "]]" in inner:
            inner = inner.split("]]")[0]
        inner = inner.split("|")[0].strip()
        if inner:
            names.append(inner)
    return names


# --------------------------------------------------------------------------- #
# Filtering
# --------------------------------------------------------------------------- #
def folder_included(cfg: VaultConfig, rel_path: str) -> bool:
    """Hard filter: include/exclude folder lists decide what enters the graph at all."""
    if cfg.exclude_folders:
        for folder in cfg.exclude_folders:
            if rel_path == folder or rel_path.startswith(folder.rstrip("/") + "/"):
                return False
    if cfg.include_folders:
        for folder in cfg.include_folders:
            if rel_path == folder or rel_path.startswith(folder.rstrip("/") + "/"):
                return True
        return False
    return True


def llm_eligible(cfg: VaultConfig, tags: list[str]) -> bool:
    """Required-tag gate for the LLM-backed entity extraction (rate-limit bound)."""
    if not cfg.required_tags:
        return True
    tag_set = {t.lower() for t in tags}
    return any(req.lower() in tag_set for req in cfg.required_tags)


# --------------------------------------------------------------------------- #
# Images
# --------------------------------------------------------------------------- #
def resolve_image_path(root: Path, rel_path: str, image_name: str, attachments_dir: str) -> Path | None:
    note_dir = (root / rel_path).parent
    candidates = [note_dir / image_name]
    if attachments_dir:
        candidates.append(root / attachments_dir / image_name)
    # Vault-wide search as a last resort (Obsidian resolves by unique name).
    if len(candidates) == 1 or not candidates[1].exists():
        candidates.append(root / image_name)
        if not candidates[1].exists():
            for p in root.rglob(image_name):
                if not any(part in SKIP_DIRS for part in p.relative_to(root).parts):
                    candidates.append(p)
                    break
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def image_to_base64(path: Path, max_size: int) -> tuple[str, str] | None:
    """Read, downscale, and base64-encode an image. Returns (b64, mime) or None."""
    try:
        from PIL import Image, ImageOps
        import io

        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode in ("RGBA", "P", "LA"):
                im = im.convert("RGB")
            if max(im.size) > max_size:
                im.thumbnail((max_size, max_size), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=85)
            data = buf.getvalue()
    except Exception:
        # Fall back to raw bytes if Pillow is unavailable or the file is invalid.
        with open(path, "rb") as f:
            data = f.read()
        ext = Path(path).suffix.lower()
        mime = MIME_BY_EXT.get(ext, "image/png")
        return base64.b64encode(data).decode("utf-8"), mime

    if not data:
        return None
    return base64.b64encode(data).decode("utf-8"), "image/jpeg"

def _content_fingerprint(content: bytes, mtime: float) -> str:
    """Content hash for change detection (mtime kept for fast-path compare)."""
    return hashlib.sha256(content).hexdigest()


async def _read_images(root: Path, rel_path: str, embeds: list[str], cfg: VaultConfig) -> str:
    """Transcribe embedded images via the vision model; return combined text."""
    if not embeds:
        return ""
    parts = []
    for name in embeds[: cfg.max_images_per_note]:
        img_path = resolve_image_path(root, rel_path, name, cfg.attachments_dir)
        if img_path is None:
            continue
        encoded = image_to_base64(img_path, cfg.max_image_size)
        if encoded is None:
            continue
        b64, mime = encoded
        try:
            result = await groq_client.describe_image(b64, mime)
        except Exception as e:
            parts.append(f"[Image {name}: analysis failed ({e})]")
            continue
        description = result.get("description", "")
        transcript = result.get("text_transcript", "")
        parts.append(f"[Image: {name}] {description} {transcript}".strip())
    return "\n".join(parts)


async def _process_note(
    source: ObsidianSource,
    db,
    root: Path,
    rel_path: str,
    content: bytes,
    cfg: VaultConfig,
) -> dict:
    """Handle a single note. Returns a per-note result dict."""
    text = content.decode("utf-8", errors="replace")
    fm, body = parse_frontmatter(text)
    tags = extract_tags(text, fm)
    title = extract_title(text, fm, rel_path)
    embeds = extract_embeds(text)
    folder = str(Path(rel_path).parent)

    meta = {
        "vault": source.source_type,
        "path": rel_path,
        "folder": folder,
        "tags": tags,
        "images": embeds,
    }

    if not folder_included(cfg, rel_path):
        return {"path": rel_path, "status": "excluded", "node_id": None}

    description = body[:200].strip() or title

    if not llm_eligible(cfg, tags):
        node_id = await graph.create_source_node(db, title, description, meta)
        return {"path": rel_path, "status": "indexed", "node_id": node_id, "tags": tags}

    # Full LLM extraction path (tagged/eligible notes).
    image_text = ""
    if embeds:
        image_text = await _read_images(root, rel_path, embeds, cfg)
        meta["image_transcripts"] = True

    combined = f"{body}\n\n{image_text}".strip()
    entities = await groq_client.extract_entities(combined)

    node_id = await graph.create_source_node(db, title, description, meta)
    await graph.apply_entities(db, node_id, entities)

    return {"path": rel_path, "status": "ingested", "node_id": node_id, "tags": tags}


async def scan_vault(limit: int | None = None) -> dict:
    """Run one sync pass. Idempotent; only new/changed notes are processed."""
    cfg = await load_config()
    if not cfg.vault_path:
        return {"status": "disabled", "reason": "No vault path configured (set it in Settings)"}

    async with _scan_lock:
        source = build_source(cfg)
        root = Path(cfg.vault_path)
        db = await get_db()
        results = {"scanned": 0, "ingested": 0, "indexed": 0, "excluded": 0,
                   "unchanged": 0, "errors": 0, "notes": []}
        try:
            rel_paths = source.list_markdown_files()
            known = {}
            rows = await db.execute("SELECT relative_path, sha256, mtime, note_node_id FROM vault_files")
            for r in await rows.fetchall():
                known[r["relative_path"]] = r

            effective_limit = limit or cfg.max_notes_per_scan
            for rel_path in rel_paths:
                if results["scanned"] >= effective_limit:
                    break
                try:
                    content = source.read_file(rel_path)
                except OSError:
                    results["errors"] += 1
                    continue
                results["scanned"] += 1
                mtime = source.stat_mtime(rel_path)
                sha = _content_fingerprint(content, mtime)
                prev = known.get(rel_path)
                if prev and prev["sha256"] == sha and prev["mtime"] == mtime:
                    results["unchanged"] += 1
                    continue

                try:
                    note = await _process_note(source, db, root, rel_path, content, cfg)
                    await db.execute(
                        """INSERT INTO vault_files (path, relative_path, sha256, mtime, note_node_id)
                           VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT(path) DO UPDATE SET
                               sha256 = excluded.sha256, mtime = excluded.mtime,
                               note_node_id = excluded.note_node_id,
                               last_scanned_at = datetime('now')""",
                        (str(root / rel_path), rel_path, sha, mtime, note.get("node_id")),
                    )
                    await db.commit()
                    status = note["status"]
                    results[status] = results.get(status, 0) + 1
                    if status in ("ingested", "indexed"):
                        results["notes"].append({"path": rel_path, "status": status})
                except Exception as e:
                    results["errors"] += 1
                    results.setdefault("error_details", []).append({"path": rel_path, "error": str(e)})

            # Drop tracking rows for files that no longer exist (nodes are left intact).
            current = set(rel_paths)
            stale = [k for k in known if k not in current]
            for rel in stale:
                await db.execute("DELETE FROM vault_files WHERE relative_path = ?", (rel,))
            if stale:
                await db.commit()
        finally:
            await db.close()

        results["total_files"] = len(rel_paths)
        log.info(
            "Vault scan: %d scanned, %d ingested, %d indexed, %d unchanged, %d errors",
            results["scanned"], results["ingested"], results["indexed"],
            results["unchanged"], results["errors"],
        )
        return results


async def sync_obsidian() -> dict:
    return await scan_vault()
