"""Unified LLM client — routes to Groq, OpenAI, or any OpenAI-compatible endpoint.

Usage:
    from ..core.llm_client import chat_completion
    result = await chat_completion(messages, task="entity_extraction")

The `task` parameter selects per-task model overrides from settings.
Available tasks: entity_extraction, skill_checklist, skill_module, solution_review,
                 project_ideas, ctf_restructure, job_analysis, weekly_digest, image_description.
"""
import json
import logging
from typing import Any
from . import settings_store

log = logging.getLogger(__name__)

# Provider-specific defaults
PROVIDER_DEFAULTS = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "openai/gpt-oss-120b",
        "default_vision_model": "qwen/qwen3.6-27b",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "default_vision_model": "gpt-4o-mini",
    },
    "custom": {
        "base_url": "http://localhost:11434/v1",
        "default_model": "llama3.3",
        "default_vision_model": "llama3.3",
    },
}


async def _get_config() -> dict:
    """Load provider config from settings store."""
    provider = await settings_store.get("ai.provider", "groq")
    base_url = await settings_store.get("ai.base_url", "")
    api_key = await settings_store.get("ai.api_key", "")
    model = await settings_store.get("ai.model", "")
    vision_model = await settings_store.get("ai.vision_model", "")
    task_models = await settings_store.get("ai.task_models", {})

    defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["groq"])

    if not base_url:
        base_url = defaults["base_url"]
    if not model:
        model = defaults["default_model"]
    if not vision_model:
        vision_model = defaults["default_vision_model"]

    return {
        "provider": provider,
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "model": model,
        "vision_model": vision_model,
        "task_models": task_models if isinstance(task_models, dict) else {},
    }


def _resolve_model(config: dict, task: str | None = None, vision: bool = False) -> str:
    """Resolve the model ID for a given task."""
    if vision:
        return config["vision_model"]
    if task and task in config["task_models"]:
        return config["task_models"][task]
    return config["model"]


async def chat_completion(
    messages: list[dict],
    task: str | None = None,
    model: str | None = None,
    vision: bool = False,
    temperature: float = 0.3,
    response_format: dict | None = None,
    max_tokens: int | None = None,
) -> dict:
    """Send a chat completion request to the configured provider.

    Returns the raw API response dict (OpenAI-compatible format).
    Raises on HTTP errors.
    """
    import httpx

    config = await _get_config()
    resolved_model = model or _resolve_model(config, task, vision=vision)

    headers = {"Content-Type": "application/json"}
    if config["api_key"]:
        headers["Authorization"] = f"Bearer {config['api_key']}"

    body: dict[str, Any] = {
        "model": resolved_model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        body["response_format"] = response_format
    if max_tokens:
        body["max_tokens"] = max_tokens

    url = f"{config['base_url']}/chat/completions"

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, json=body, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def chat_completion_text(
    messages: list[dict],
    task: str | None = None,
    model: str | None = None,
    vision: bool = False,
    temperature: float = 0.3,
    response_format: dict | None = None,
    max_tokens: int | None = None,
) -> str:
    """Convenience: return just the assistant message content as a string."""
    resp = await chat_completion(
        messages, task=task, model=model, vision=vision, temperature=temperature,
        response_format=response_format, max_tokens=max_tokens,
    )
    return resp.get("choices", [{}])[0].get("message", {}).get("content", "")


async def chat_completion_json(
    messages: list[dict],
    task: str | None = None,
    model: str | None = None,
    temperature: float = 0.3,
) -> dict | list:
    """Convenience: parse the response as JSON."""
    raw = await chat_completion_text(
        messages, task=task, model=model, temperature=temperature,
        response_format={"type": "json_object"},
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON from markdown fences
        if "```" in raw:
            start = raw.find("```")
            end = raw.find("```", start + 3)
            if end > start:
                snippet = raw[start:end].split("\n", 1)[-1]
                return json.loads(snippet)
        raise


async def list_models() -> list[dict]:
    """Fetch available models from the configured provider's /models endpoint."""
    import httpx

    config = await _get_config()
    headers = {"Content-Type": "application/json"}
    if config["api_key"]:
        headers["Authorization"] = f"Bearer {config['api_key']}"

    url = f"{config['base_url']}/models"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            models = data.get("data", [])
            return [{"id": m.get("id", ""), "name": m.get("id", "")} for m in models if m.get("id")]
    except Exception:
        # Provider unreachable/misconfigured: raise so callers can surface a
        # real error instead of silently showing provider defaults as if the
        # fetch had succeeded.
        log.warning("list_models failed for provider %s at %s", config["provider"], url)
        raise


async def test_connection() -> dict:
    """Test the configured provider connection. Returns {ok, provider, model, error?}."""
    config = await _get_config()
    try:
        resp = await chat_completion(
            [{"role": "user", "content": "Say 'ok' in one word."}],
            max_tokens=10,
        )
        content = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {
            "ok": True,
            "provider": config["provider"],
            "model": _resolve_model(config),
            "response": content[:50],
        }
    except Exception as e:
        return {
            "ok": False,
            "provider": config["provider"],
            "model": _resolve_model(config),
            "error": str(e),
        }
