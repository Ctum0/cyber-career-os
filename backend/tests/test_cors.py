"""CORS middleware tests: origins come from config (env-configurable) and the
allow-origin header is emitted only for configured origins."""
import asyncio
import importlib
import logging

import httpx

import app.core.config as configmod
import app.main as mainmod

logging.getLogger("httpx").setLevel(logging.WARNING)  # keep request logs out of pytest output


def _build_app(monkeypatch, cors=None):
    """Reload app.main so its middleware binds the current config state.

    CORS origins are import-time wiring (deployment config, not a runtime
    /settings value), so tests re-derive them from the environment. The app's
    lifespan (DB init, scheduler) never runs — GET /health needs neither.
    """
    if cors is None:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        importlib.reload(configmod)  # re-derive the default from a clean env
    else:
        monkeypatch.setattr(configmod, "CORS_ORIGINS", cors)
    return importlib.reload(mainmod)


def _get_health(mod, origin):
    """GET /health with the given Origin header against the freshly-built app."""

    async def scenario():
        transport = httpx.ASGITransport(app=mod.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get("/health", headers={"Origin": origin})

    return asyncio.run(scenario())


def test_default_origins_allow_localhost(monkeypatch):
    mod = _build_app(monkeypatch)
    resp = _get_health(mod, "http://localhost:3000")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_disallowed_origin_served_without_cors_header(monkeypatch):
    # CORS is browser-enforced: the request is still served, but no
    # access-control-allow-origin header is emitted for unknown origins.
    mod = _build_app(monkeypatch)
    resp = _get_health(mod, "https://evil.example.com")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    assert "access-control-allow-origin" not in resp.headers


def test_overridden_origins_get_cors_header(monkeypatch):
    mod = _build_app(monkeypatch, cors=["https://cco.example.com"])

    allowed = _get_health(mod, "https://cco.example.com")
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://cco.example.com"

    # The override replaces the default list; the old default no longer passes.
    unallowed = _get_health(mod, "http://localhost:3000")
    assert unallowed.status_code == 200
    assert "access-control-allow-origin" not in unallowed.headers


def test_config_parses_comma_separated_origins(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", " https://a.example.com , https://b.example.com ,")
    importlib.reload(configmod)
    assert configmod.CORS_ORIGINS == ["https://a.example.com", "https://b.example.com"]
    # Leave the module tidy for anything imported afterwards.
    monkeypatch.delenv("CORS_ORIGINS")
    importlib.reload(configmod)
    assert configmod.CORS_ORIGINS == ["http://localhost:3000"]
