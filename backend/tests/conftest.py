"""Test fixtures. Every test runs against an isolated temp database —
the user's real cybercareer.db is never touched."""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Isolated DB BEFORE importing app modules (config computes DB_PATH at import).
_tmp = tempfile.mkdtemp(prefix="cco-test-")
os.environ.setdefault("PYTEST_CURRENT_TEST", "1")


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def isolated_db(monkeypatch):
    """Point the database module at a fresh temp DB for each test."""
    import importlib
    import app.core.database as dbmod
    import app.core.config as configmod

    dbfile = Path(_tmp) / f"test-{id(monkeypatch)}.db"
    monkeypatch.setattr(configmod, "DB_PATH", dbfile)
    monkeypatch.setattr(dbmod, "DB_PATH", dbfile)
    dbmod.invalidate = None  # no such attr; keep linters honest
    yield dbfile


@pytest.fixture(autouse=True)
def _init_schema(isolated_db):
    import app.core.database as dbmod

    asyncio.get_event_loop_policy()
    asyncio.run(dbmod.init_db())
    yield
