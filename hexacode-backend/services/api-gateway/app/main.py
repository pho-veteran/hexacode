from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]


def _manifest_candidates() -> list[Path]:
    candidates: list[Path] = []
    env_path = os.getenv("ROUTE_MANIFEST_PATH")
    if env_path:
        candidates.append(Path(env_path))

    candidates.append(Path.cwd() / "contracts" / "route-manifest.json")

    module_path = Path(__file__).resolve()
    for parent in module_path.parents:
        candidates.append(parent / "contracts" / "route-manifest.json")

    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key not in seen:
            deduped.append(candidate)
            seen.add(key)
    return deduped


def load_route_manifest() -> dict[str, Any]:
    for candidate in _manifest_candidates():
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise RuntimeError("Unable to locate contracts/route-manifest.json for the gateway.")


MANIFEST = load_route_manifest()
ROUTES = sorted(MANIFEST["routes"], key=lambda item: len(item["prefix"]), reverse=True)

app = FastAPI(
    title="Hexacode API Gateway",
    version="0.1.0",
    description="Thin local gateway that mirrors the public route contract.",
)


def _cors_origins() -> list[str]:
    raw_value = os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173",
    )
    return [value.strip() for value in raw_value.split(",") if value.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _error_payload(message: str, correlation_id: str | None) -> dict[str, Any]:
    return {
        "error": {
            "message": message,
            "source": "api-gateway",
        },
        "correlation_id": correlation_id,
    }


def resolve_upstream(path: str) -> tuple[str, str]:
    for route in ROUTES:
        prefix = route["prefix"]
        if path == prefix or path.startswith(f"{prefix}/"):
            upstream = os.getenv(route["upstream_env"], "").rstrip("/")
            if not upstream:
                raise HTTPException(
                    status_code=500,
                    detail=f"Route '{route['id']}' is missing env '{route['upstream_env']}'.",
                )
            return route["id"], upstream

    raise HTTPException(status_code=404, detail=f"No upstream is configured for path '{path}'.")


@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id", str(uuid.uuid4()))
    request.state.correlation_id = correlation_id
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    correlation_id = getattr(request.state, "correlation_id", None)
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(str(exc.detail), correlation_id),
    )


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "api-gateway",
        "route_count": len(ROUTES),
    }


@app.get("/internal/routes")
async def internal_routes() -> dict[str, Any]:
    return MANIFEST


@app.api_route("/{full_path:path}", methods=HTTP_METHODS)
async def proxy_request(full_path: str, request: Request) -> Response:
    request_path = f"/{full_path}" if full_path else "/"
    route_id, upstream = resolve_upstream(request_path)

    target_url = f"{upstream}{request_path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {"host", "content-length", "connection"}
    }
    headers["x-correlation-id"] = request.state.correlation_id
    headers["x-gateway-route-id"] = route_id

    timeout_seconds = float(os.getenv("GATEWAY_TIMEOUT_SECONDS", "20"))

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=False) as client:
            upstream_response = await client.request(
                request.method,
                target_url,
                content=await request.body(),
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Upstream '{route_id}' is unavailable: {exc.__class__.__name__}.",
        ) from exc

    response_headers = {
        key: value
        for key, value in upstream_response.headers.items()
        if key.lower() not in {"content-encoding", "transfer-encoding", "connection"}
    }

    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=upstream_response.headers.get("content-type"),
    )
