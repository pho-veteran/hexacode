from __future__ import annotations

import base64
import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

import boto3
import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

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


def resolve_route(path: str) -> dict[str, Any]:
    for route in ROUTES:
        prefix = route["prefix"]
        if path == prefix or path.startswith(f"{prefix}/"):
            return route

    raise HTTPException(status_code=404, detail=f"No upstream is configured for path '{path}'.")


def resolve_upstream(route: dict[str, Any]) -> str:
    upstream = os.getenv(route["upstream_env"], "").rstrip("/")
    if not upstream:
        raise HTTPException(
            status_code=500,
            detail=f"Route '{route['id']}' is missing env '{route['upstream_env']}'.",
        )
    return upstream


def resolve_lambda_function_name(route: dict[str, Any]) -> str | None:
    function_env = route.get("lambda_function_env")
    if not isinstance(function_env, str) or not function_env.strip():
        return None

    function_name = os.getenv(function_env, "").strip()
    if not function_name:
        raise HTTPException(
            status_code=500,
            detail=f"Route '{route['id']}' is missing env '{function_env}'.",
        )
    return function_name


def resolve_lambda_qualifier(route: dict[str, Any]) -> str | None:
    qualifier_env = route.get("lambda_qualifier_env")
    if not isinstance(qualifier_env, str) or not qualifier_env.strip():
        return None
    qualifier = os.getenv(qualifier_env, "").strip()
    return qualifier or None


def apply_route_headers(route: dict[str, Any], headers: dict[str, str]) -> None:
    raw_header_envs = route.get("request_header_envs")
    if not isinstance(raw_header_envs, dict):
        return

    for header_name, env_name in raw_header_envs.items():
        if not isinstance(header_name, str) or not isinstance(env_name, str):
            continue
        env_value = os.getenv(env_name, "").strip()
        if env_value:
            headers[header_name] = env_value


def resolve_timeout_seconds(route: dict[str, Any]) -> float:
    timeout_env = route.get("timeout_env")
    if isinstance(timeout_env, str) and timeout_env.strip():
        raw_timeout = os.getenv(timeout_env, "").strip()
        if raw_timeout:
            try:
                timeout = float(raw_timeout)
            except ValueError:
                timeout = 0.0
            if timeout > 0:
                return timeout

    raw_timeout = os.getenv("GATEWAY_TIMEOUT_SECONDS", "20").strip()
    try:
        timeout = float(raw_timeout)
    except ValueError:
        return 20.0
    return timeout if timeout > 0 else 20.0


def normalize_query_string_parameters(raw_query: str) -> dict[str, str] | None:
    if not raw_query:
        return None

    merged: dict[str, list[str]] = {}
    for key, value in parse_qsl(raw_query, keep_blank_values=True):
        merged.setdefault(key, []).append(value)

    if not merged:
        return None

    return {key: ",".join(values) for key, values in merged.items()}


def build_lambda_event(
    *,
    request: Request,
    request_path: str,
    route_id: str,
    body_bytes: bytes,
    correlation_id: str,
) -> dict[str, Any]:
    is_base64 = False
    try:
        body = body_bytes.decode("utf-8")
    except UnicodeDecodeError:
        body = base64.b64encode(body_bytes).decode("ascii")
        is_base64 = True

    cookies_header = request.headers.get("cookie", "")
    cookies = [cookie.strip() for cookie in cookies_header.split(";") if cookie.strip()]
    raw_query = request.url.query or ""
    query_string_parameters = normalize_query_string_parameters(raw_query)
    source_ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")

    headers = {key.lower(): value for key, value in request.headers.items()}
    headers["x-correlation-id"] = correlation_id
    headers["x-gateway-route-id"] = route_id

    now = datetime.now(UTC)
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": request_path,
        "rawQueryString": raw_query,
        "cookies": cookies or None,
        "headers": headers,
        "queryStringParameters": query_string_parameters,
        "requestContext": {
            "accountId": "local",
            "apiId": "local-gateway",
            "domainName": "local.hexacode",
            "domainPrefix": "local",
            "requestId": correlation_id,
            "routeKey": "$default",
            "stage": "$default",
            "time": now.strftime("%d/%b/%Y:%H:%M:%S +0000"),
            "timeEpoch": int(now.timestamp() * 1000),
            "http": {
                "method": request.method,
                "path": request_path,
                "protocol": f"HTTP/{request.scope.get('http_version', '1.1')}",
                "sourceIp": source_ip,
                "userAgent": user_agent,
            },
        },
        "pathParameters": None,
        "stageVariables": None,
        "body": body,
        "isBase64Encoded": is_base64,
    }


def build_lambda_client(timeout_seconds: float):
    region_name = os.getenv("AWS_REGION", "").strip() or None
    config = Config(
        read_timeout=timeout_seconds,
        connect_timeout=min(timeout_seconds, 5.0),
        retries={"max_attempts": 1},
    )
    return boto3.client("lambda", region_name=region_name, config=config)


def normalize_lambda_response(
    lambda_payload: Any,
    *,
    correlation_id: str,
) -> tuple[int, bytes, dict[str, str], list[str], str | None]:
    if not isinstance(lambda_payload, dict):
        raise HTTPException(status_code=502, detail="Lambda returned an invalid proxy payload.")

    status_code = lambda_payload.get("statusCode", 200)
    try:
        normalized_status = int(status_code)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Lambda returned an invalid statusCode.") from exc

    headers = lambda_payload.get("headers")
    normalized_headers: dict[str, str] = {}
    if isinstance(headers, dict):
        normalized_headers = {
            str(key): str(value)
            for key, value in headers.items()
            if value is not None
        }

    cookies = lambda_payload.get("cookies")
    normalized_cookies = [str(cookie) for cookie in cookies] if isinstance(cookies, list) else []

    body = lambda_payload.get("body", "")
    if body is None:
        body = ""
    if not isinstance(body, str):
        raise HTTPException(status_code=502, detail="Lambda returned a non-string response body.")

    is_base64 = bool(lambda_payload.get("isBase64Encoded"))
    if is_base64:
        try:
            response_body = base64.b64decode(body)
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Lambda returned an invalid base64 response body.") from exc
    else:
        response_body = body.encode("utf-8")

    if "x-correlation-id" not in {key.lower(): value for key, value in normalized_headers.items()}:
        normalized_headers["x-correlation-id"] = correlation_id

    media_type = normalized_headers.get("content-type") or normalized_headers.get("Content-Type")
    return normalized_status, response_body, normalized_headers, normalized_cookies, media_type


async def invoke_lambda_route(
    *,
    route: dict[str, Any],
    route_id: str,
    request_path: str,
    request: Request,
) -> Response:
    function_name = resolve_lambda_function_name(route)
    if function_name is None:
        raise HTTPException(status_code=500, detail=f"Route '{route_id}' is not configured for Lambda.")

    correlation_id = request.state.correlation_id
    body_bytes = await request.body()
    event = build_lambda_event(
        request=request,
        request_path=request_path,
        route_id=route_id,
        body_bytes=body_bytes,
        correlation_id=correlation_id,
    )

    invoke_kwargs: dict[str, Any] = {
        "FunctionName": function_name,
        "InvocationType": "RequestResponse",
        "Payload": json.dumps(event).encode("utf-8"),
    }
    qualifier = resolve_lambda_qualifier(route)
    if qualifier is not None:
        invoke_kwargs["Qualifier"] = qualifier

    try:
        lambda_client = build_lambda_client(resolve_timeout_seconds(route))
        lambda_response = lambda_client.invoke(**invoke_kwargs)
    except (ClientError, BotoCoreError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Lambda route '{route_id}' is unavailable: {exc.__class__.__name__}.",
        ) from exc

    payload_stream = lambda_response.get("Payload")
    payload_bytes = payload_stream.read() if payload_stream is not None else b""
    try:
        payload = json.loads(payload_bytes.decode("utf-8") or "null")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Lambda returned a non-JSON proxy payload.") from exc

    if lambda_response.get("FunctionError"):
        message = "Lambda execution failed."
        if isinstance(payload, dict):
            message = str(payload.get("errorMessage") or payload.get("message") or message)
        raise HTTPException(status_code=502, detail=message)

    status_code, response_body, response_headers, cookies, media_type = normalize_lambda_response(
        payload,
        correlation_id=correlation_id,
    )

    response = Response(
        content=response_body,
        status_code=status_code,
        headers=response_headers,
        media_type=media_type,
    )
    for cookie in cookies:
        response.raw_headers += ((b"set-cookie", cookie.encode("latin-1")),)
    return response


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
    route = resolve_route(request_path)
    route_id = route["id"]
    lambda_function_name = resolve_lambda_function_name(route)
    if lambda_function_name is not None:
        return await invoke_lambda_route(
            route=route,
            route_id=route_id,
            request_path=request_path,
            request=request,
        )

    upstream = resolve_upstream(route)

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
    apply_route_headers(route, headers)

    timeout_seconds = resolve_timeout_seconds(route)

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
