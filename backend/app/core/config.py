"""Environment bootstrap configuration.

Precedence (documented contract):

    1. SQLite `settings` table (user-configurable at /settings) — runtime truth
    2. The DEFAULTS in settings_store, which point here — bootstrap values
    3. This module reads `.env` / process environment — deployment bootstrap

Feature code must consume configuration through settings_store (which falls
back to DEFAULTS), NOT by importing constants from here — except where a
consumer deliberately chains `db_value or config.ENV_VALUE` for bootstrap.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = BASE_DIR / "data" / "cybercareer.db"

# --- AI provider bootstrap (also configurable at /settings → AI Provider) --- #
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.6-27b")

# --- Obsidian vault sync bootstrap (also configurable at /settings) --------- #
# Feature is disabled until a vault path is set (DB setting or this env var).
OBSIDIAN_VAULT_PATH = os.getenv("OBSIDIAN_VAULT_PATH", "")
OBSIDIAN_SCAN_INTERVAL_MINUTES = int(os.getenv("OBSIDIAN_SCAN_INTERVAL_MINUTES", "30"))
OBSIDIAN_INCLUDE_FOLDERS = [p.strip() for p in os.getenv("OBSIDIAN_INCLUDE_FOLDERS", "").split(",") if p.strip()]
OBSIDIAN_EXCLUDE_FOLDERS = [p.strip() for p in os.getenv("OBSIDIAN_EXCLUDE_FOLDERS", "").split(",") if p.strip()]
OBSIDIAN_REQUIRED_TAGS = [t.strip().lstrip("#") for t in os.getenv("OBSIDIAN_REQUIRED_TAGS", "").split(",") if t.strip()]
OBSIDIAN_ATTACHMENTS_DIR = os.getenv("OBSIDIAN_ATTACHMENTS_DIR", "")
OBSIDIAN_MAX_NOTES_PER_SCAN = int(os.getenv("OBSIDIAN_MAX_NOTES_PER_SCAN", "10"))
OBSIDIAN_MAX_IMAGES_PER_NOTE = int(os.getenv("OBSIDIAN_MAX_IMAGES_PER_NOTE", "5"))
OBSIDIAN_MAX_IMAGE_SIZE = int(os.getenv("OBSIDIAN_MAX_IMAGE_SIZE", "1024"))

# Deferred: GitHub mirror source
OBSIDIAN_REPO_URL = os.getenv("OBSIDIAN_REPO_URL", "")
OBSIDIAN_GITHUB_TOKEN = os.getenv("OBSIDIAN_GITHUB_TOKEN", "")

# --- RSS bootstrap ---------------------------------------------------------- #
# RSS_FEEDS env var (comma-separated) overrides the built-in default feeds.
# The effective feed list lives in settings_store ("rss.feeds").
_DEFAULT_RSS_FEEDS = [
    "https://feeds.feedburner.com/TheHackersNews",
    "https://krebsonsecurity.com/feed/",
    "https://www.bleepingcomputer.com/feed/",
    "https://blog.malwarebytes.com/feed/",
    "https://www.schneier.com/feed/atom/",
    "https://cvefeed.io/rssfeed",
    "https://nvd.nist.gov/feeds/xml/cve/misc/nvd-rss.xml",
]
RSS_FEEDS = [f.strip() for f in os.getenv("RSS_FEEDS", "").split(",") if f.strip()] or _DEFAULT_RSS_FEEDS

# Ensure data directory exists
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
