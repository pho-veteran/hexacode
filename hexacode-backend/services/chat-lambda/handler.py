from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

SERVICE_NAME = "chat-lambda"
CHAT_AREA_CODES = {"public", "dashboard", "workspace"}
CHAT_MESSAGE_ROLE_CODES = {"user", "assistant"}
CHAT_SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$")
MAX_CHAT_MESSAGES_DEFAULT = 12
MAX_CHAT_MESSAGE_CHARS_DEFAULT = 4_000
MAX_CHAT_ROUTE_CHARS_DEFAULT = 240
AGENT_RUNTIME_TIMEOUT_SECONDS_DEFAULT = 20.0

logger = logging.getLogger(SERVICE_NAME)
if not logger.handlers:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())


def env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        parsed = int(raw_value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def env_float(name: str, default: float) -> float:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        parsed = float(raw_value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def env_optional_float(name: str) -> float | None:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return None
    try:
        return float(raw_value)
    except ValueError:
        return None


def env_optional_int(name: str) -> int | None:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return None
    try:
        return int(raw_value)
    except ValueError:
        return None


def normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def build_error_payload(message: str, correlation_id: str | None) -> dict[str, Any]:
    return {
        "error": {
            "message": message,
            "source": SERVICE_NAME,
        },
        "correlation_id": correlation_id,
    }


def response(
    *,
    status_code: int,
    body: dict[str, Any],
    correlation_id: str | None,
) -> dict[str, Any]:
    headers = {
        "content-type": "application/json",
    }
    if correlation_id:
        headers["x-correlation-id"] = correlation_id
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(body),
        "isBase64Encoded": False,
    }


def error_response(status_code: int, message: str, correlation_id: str | None) -> dict[str, Any]:
    return response(
        status_code=status_code,
        body=build_error_payload(message, correlation_id),
        correlation_id=correlation_id,
    )


def empty_response(status_code: int, correlation_id: str | None) -> dict[str, Any]:
    headers: dict[str, str] = {}
    if correlation_id:
        headers["x-correlation-id"] = correlation_id
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": "",
        "isBase64Encoded": False,
    }


def get_http_method(event: dict[str, Any]) -> str:
    request_context = event.get("requestContext")
    if isinstance(request_context, dict):
        http_context = request_context.get("http")
        if isinstance(http_context, dict):
            method = normalize_optional_text(http_context.get("method"))
            if method:
                return method.upper()

    method = normalize_optional_text(event.get("httpMethod"))
    return method.upper() if method else ""


def decode_event_body(event: dict[str, Any]) -> Any:
    body = event.get("body")
    if body in (None, ""):
        return {}

    if not isinstance(body, str):
        raise ValueError("Request body must be a JSON string.")

    if event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(body).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError("Request body is not valid base64-encoded UTF-8.") from exc

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("Request body must be valid JSON.") from exc


def normalize_chat_session_id(value: Any) -> str:
    session_id = normalize_optional_text(value)
    if session_id is None or not CHAT_SESSION_ID_PATTERN.fullmatch(session_id):
        raise ValueError(
            "sessionId must be 8-120 characters using letters, numbers, '.', '_', ':', or '-'.",
        )
    return session_id


def normalize_chat_content(value: Any, *, field_name: str, max_chars: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string.")
    content = value.strip()
    if not content:
        raise ValueError(f"{field_name} must not be empty.")
    if len(content) > max_chars:
        raise ValueError(f"{field_name} must be at most {max_chars} characters.")
    return content


def normalize_chat_message(value: Any, *, index: int, max_chars: int) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError(f"messages[{index}] must be an object.")
    role = normalize_optional_text(value.get("role"))
    if role not in CHAT_MESSAGE_ROLE_CODES:
        raise ValueError(
            f"messages[{index}].role must be one of: {', '.join(sorted(CHAT_MESSAGE_ROLE_CODES))}.",
        )
    return {
        "role": role,
        "content": normalize_chat_content(
            value.get("content"),
            field_name=f"messages[{index}].content",
            max_chars=max_chars,
        ),
    }


def normalize_chat_page_context(value: Any, *, max_route_chars: int) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("pageContext must be an object when provided.")

    route = normalize_optional_text(value.get("route"))
    if route is None or not route.startswith("/"):
        raise ValueError("pageContext.route must be an absolute app path.")
    if len(route) > max_route_chars:
        raise ValueError(f"pageContext.route must be at most {max_route_chars} characters.")

    area = normalize_optional_text(value.get("area"))
    if area not in CHAT_AREA_CODES:
        raise ValueError(f"pageContext.area must be one of: {', '.join(sorted(CHAT_AREA_CODES))}.")

    problem_slug = normalize_optional_text(value.get("problemSlug"))
    if problem_slug is not None and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", problem_slug):
        raise ValueError("pageContext.problemSlug must be a valid slug.")

    return {
        "route": route,
        "area": area,
        "problemSlug": problem_slug,
    }


def normalize_chat_request(payload: Any) -> dict[str, Any]:
    max_messages = env_int("CHAT_MAX_MESSAGES", MAX_CHAT_MESSAGES_DEFAULT)
    max_chars = env_int("CHAT_MAX_MESSAGE_CHARS", MAX_CHAT_MESSAGE_CHARS_DEFAULT)
    max_route_chars = env_int("CHAT_MAX_ROUTE_CHARS", MAX_CHAT_ROUTE_CHARS_DEFAULT)

    if not isinstance(payload, dict):
        raise ValueError("Chat payload must be a JSON object.")

    raw_messages = payload.get("messages")
    if not isinstance(raw_messages, list) or not raw_messages:
        raise ValueError("messages must be a non-empty array.")
    if len(raw_messages) > max_messages:
        raise ValueError(f"messages must contain at most {max_messages} items.")

    messages = [
        normalize_chat_message(item, index=index, max_chars=max_chars)
        for index, item in enumerate(raw_messages)
    ]
    if messages[-1]["role"] != "user":
        raise ValueError("The last chat message must come from the user.")

    normalized_payload: dict[str, Any] = {
        "sessionId": normalize_chat_session_id(payload.get("sessionId")),
        "messages": messages,
    }
    page_context = normalize_chat_page_context(payload.get("pageContext"), max_route_chars=max_route_chars)
    if page_context is not None:
        normalized_payload["pageContext"] = page_context
    return normalized_payload


def build_agent_input_text(payload: dict[str, Any], headers: dict[str, str]) -> str:
    page_context = payload.get("pageContext") or {}
    context_lines: list[str] = []

    route = normalize_optional_text(page_context.get("route"))
    area = normalize_optional_text(page_context.get("area"))
    problem_slug = normalize_optional_text(page_context.get("problemSlug"))
    if route:
        context_lines.append(f"Current route: {route}")
    if area:
        context_lines.append(f"Current app area: {area}")
    if problem_slug:
        context_lines.append(f"Current problem slug: {problem_slug}")

    authenticated = headers.get("x-chat-authenticated")
    if authenticated == "true":
        context_lines.append("The caller is authenticated.")
        username = normalize_optional_text(headers.get("x-chat-username"))
        if username:
            context_lines.append(f"Authenticated username: {username}")
    else:
        context_lines.append("The caller is anonymous.")

    user_message = payload["messages"][-1]["content"]
    if not context_lines:
        return user_message
    return "Hexacode page context:\n- " + "\n- ".join(context_lines) + f"\n\nUser request:\n{user_message}"


def get_agent_runtime_client():
    region_name = os.getenv("BEDROCK_AGENT_REGION", "").strip() or os.getenv("AWS_REGION", "").strip() or None
    timeout_seconds = env_float("BEDROCK_AGENT_TIMEOUT_SECONDS", AGENT_RUNTIME_TIMEOUT_SECONDS_DEFAULT)
    config = Config(
        read_timeout=timeout_seconds,
        connect_timeout=min(timeout_seconds, 5.0),
        retries={"max_attempts": 2},
    )
    return boto3.client("bedrock-agent-runtime", region_name=region_name, config=config)


def iter_agent_chunks(completion: Any) -> tuple[str, str | None]:
    text_parts: list[str] = []
    trace_id: str | None = None
    for event in completion:
        if not isinstance(event, dict):
            continue

        chunk = event.get("chunk")
        if isinstance(chunk, dict):
            raw_bytes = chunk.get("bytes")
            if isinstance(raw_bytes, (bytes, bytearray)):
                text_parts.append(bytes(raw_bytes).decode("utf-8"))

        trace = event.get("trace")
        if isinstance(trace, dict):
            trace_id = trace_id or normalize_optional_text(trace.get("traceId"))

    return "".join(text_parts).strip(), trace_id


def build_retrieval_configuration() -> dict[str, Any] | None:
    number_of_results = env_optional_int("BEDROCK_AGENT_NUMBER_OF_RESULTS")
    if number_of_results is None or number_of_results <= 0:
        return None

    vector_search_configuration: dict[str, Any] = {
        "numberOfResults": number_of_results,
    }
    override_search_type = normalize_optional_text(os.getenv("BEDROCK_AGENT_OVERRIDE_SEARCH_TYPE"))
    if override_search_type in {"HYBRID", "SEMANTIC"}:
        vector_search_configuration["overrideSearchType"] = override_search_type

    knowledge_base_id = os.getenv("BEDROCK_KNOWLEDGE_BASE_ID", "").strip()
    if not knowledge_base_id:
        return None

    return {
        "knowledgeBaseConfigurations": [
            {
                "knowledgeBaseId": knowledge_base_id,
                "retrievalConfiguration": {
                    "vectorSearchConfiguration": vector_search_configuration,
                },
            }
        ]
    }


def invoke_agent(payload: dict[str, Any], headers: dict[str, str]) -> tuple[str, str | None]:
    agent_id = os.getenv("BEDROCK_AGENT_ID", "").strip()
    if not agent_id:
        raise RuntimeError("BEDROCK_AGENT_ID must be configured.")

    agent_alias_id = os.getenv("BEDROCK_AGENT_ALIAS_ID", "").strip()
    if not agent_alias_id:
        raise RuntimeError("BEDROCK_AGENT_ALIAS_ID must be configured.")

    client = get_agent_runtime_client()
    request_kwargs: dict[str, Any] = {
        "agentId": agent_id,
        "agentAliasId": agent_alias_id,
        "sessionId": payload["sessionId"],
        "inputText": build_agent_input_text(payload, headers),
        "enableTrace": str(os.getenv("BEDROCK_AGENT_ENABLE_TRACE", "")).strip().lower() in {"1", "true", "yes", "on"},
    }

    end_session = str(os.getenv("BEDROCK_AGENT_END_SESSION", "")).strip().lower()
    if end_session in {"1", "true", "yes", "on"}:
        request_kwargs["endSession"] = True

    memory_id = os.getenv("BEDROCK_AGENT_MEMORY_ID", "").strip()
    if memory_id:
        request_kwargs["memoryId"] = memory_id

    prompt_turns = env_optional_int("BEDROCK_AGENT_PREVIOUS_TURNS")
    if prompt_turns is not None and prompt_turns >= 0:
        request_kwargs["promptCreationConfigurations"] = {
            "previousConversationTurnsToInclude": prompt_turns,
        }

    session_attributes: dict[str, str] = {}
    page_context = payload.get("pageContext") or {}
    route = normalize_optional_text(page_context.get("route"))
    area = normalize_optional_text(page_context.get("area"))
    problem_slug = normalize_optional_text(page_context.get("problemSlug"))
    if route:
        session_attributes["hexacode_route"] = route
    if area:
        session_attributes["hexacode_area"] = area
    if problem_slug:
        session_attributes["hexacode_problem_slug"] = problem_slug
    if session_attributes:
        request_kwargs["sessionState"] = {"sessionAttributes": session_attributes}

    retrieval_configuration = build_retrieval_configuration()
    if retrieval_configuration is not None:
        request_kwargs.setdefault("sessionState", {})
        request_kwargs["sessionState"]["knowledgeBaseConfigurations"] = retrieval_configuration["knowledgeBaseConfigurations"]

    response = client.invoke_agent(**request_kwargs)
    completion = response.get("completion")
    if completion is None:
        raise ValueError("Bedrock Agent response is missing completion.")

    reply_text, trace_id = iter_agent_chunks(completion)
    if not reply_text:
        raise ValueError("Bedrock Agent did not return any response text.")

    request_id = None
    metadata = response.get("ResponseMetadata")
    if isinstance(metadata, dict):
        request_id = normalize_optional_text(metadata.get("RequestId"))
    return reply_text, request_id or trace_id


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    headers = event.get("headers")
    normalized_headers = {
        str(key).lower(): str(value)
        for key, value in headers.items()
        if value is not None
    } if isinstance(headers, dict) else {}

    correlation_id = (
        normalize_optional_text(normalized_headers.get("x-correlation-id"))
        or normalize_optional_text(getattr(context, "aws_request_id", None))
        or "unknown"
    )

    if get_http_method(event) == "OPTIONS":
        return empty_response(204, correlation_id)

    try:
        payload = normalize_chat_request(decode_event_body(event))
    except ValueError as exc:
        return error_response(400, str(exc), correlation_id)

    try:
        reply_content, bedrock_request_id = invoke_agent(payload, normalized_headers)
    except RuntimeError as exc:
        logger.exception("chat lambda misconfigured")
        return error_response(500, str(exc), correlation_id)
    except (ClientError, BotoCoreError) as exc:
        logger.exception("bedrock agent invoke failed")
        return error_response(502, f"Bedrock Agent request failed: {exc.__class__.__name__}.", correlation_id)
    except ValueError as exc:
        logger.exception("invalid bedrock agent response")
        return error_response(502, str(exc), correlation_id)

    return response(
        status_code=200,
        body={
            "data": {
                "reply": {
                    "role": "assistant",
                    "content": reply_content,
                },
                "requestId": bedrock_request_id or correlation_id,
            },
            "meta": {
                "source": SERVICE_NAME,
                "agent_id": os.getenv("BEDROCK_AGENT_ID", "").strip() or None,
                "knowledge_base_id": os.getenv("BEDROCK_KNOWLEDGE_BASE_ID", "").strip() or None,
                "session_id": payload["sessionId"],
            },
        },
        correlation_id=correlation_id,
    )
