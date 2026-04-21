from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("hexacode.errors")


def build_error_payload(
    *,
    message: str,
    source: str,
    correlation_id: str | None,
    code: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "error": {
            "message": message,
            "source": source,
        },
        "correlation_id": correlation_id,
    }
    if code is not None:
        payload["error"]["code"] = code
    if details:
        payload["error"]["details"] = details
    return payload


def install_exception_handlers(app: FastAPI, service_name: str) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        correlation_id = getattr(request.state, "correlation_id", None)
        details = exc.detail if isinstance(exc.detail, dict) else None
        message = exc.detail.get("message") if isinstance(exc.detail, dict) else str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content=build_error_payload(
                message=message,
                source=service_name,
                correlation_id=correlation_id,
                details=details,
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        correlation_id = getattr(request.state, "correlation_id", None)
        logger.exception("unhandled application error", extra={"service_name": service_name})
        return JSONResponse(
            status_code=500,
            content=build_error_payload(
                message="Internal server error.",
                source=service_name,
                correlation_id=correlation_id,
                code="internal_error",
            ),
        )

