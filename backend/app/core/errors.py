"""Structured API error contract.

All client-facing errors share one shape:

    {"error": {"code": "...", "message": "...", "details": {...}}}

Technical detail (tracebacks, raw exception text) stays in server logs;
responses stay safe and useful.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    """Domain error with a stable machine-readable code."""

    def __init__(self, code: str, message: str, status_code: int = 400, details: dict | None = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


def _payload(code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content=_payload(exc.code, exc.message, exc.details))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        # Routers raise HTTPException with human-readable details for 4xx;
        # never leak raw exception text on 5xx.
        message = str(exc.detail) if exc.status_code < 500 else "Request failed."
        return JSONResponse(status_code=exc.status_code, content=_payload("HTTP_ERROR", message))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=_payload("VALIDATION_ERROR", "Invalid request payload.", {"errors": exc.errors()}),
        )

    @app.exception_handler(Exception)
    async def _unexpected_error(_: Request, exc: Exception):
        log.exception("Unhandled server error: %s", exc)
        return JSONResponse(status_code=500, content=_payload("INTERNAL_ERROR", "Unexpected server error."))
