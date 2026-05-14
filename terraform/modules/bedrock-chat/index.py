import json
import os
import uuid

import boto3

bedrock_agent = boto3.client("bedrock-agent-runtime")
ALLOWED_ORIGIN = os.environ["ALLOWED_ORIGIN"]
AGENT_ID = os.environ["AGENT_ID"]
AGENT_ALIAS_ID = os.environ["AGENT_ALIAS_ID"]


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "access-control-allow-origin": ALLOWED_ORIGIN,
            "access-control-allow-headers": "authorization,content-type,x-correlation-id",
            "access-control-allow-methods": "POST,OPTIONS",
            "content-type": "application/json",
        },
        "body": json.dumps(body),
    }


def _last_user_message(messages):
    for message in reversed(messages):
        if message.get("role") == "user" and str(message.get("content", "")).strip():
            return str(message["content"]).strip()
    return ""


def handler(event, context):
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return _response(204, {})

    request_id = event.get("requestContext", {}).get("requestId") or str(uuid.uuid4())

    try:
        payload = json.loads(event.get("body") or "{}")
        messages = payload.get("messages") or []
        session_id = str(payload.get("sessionId") or request_id)[:100]
        user_message = _last_user_message(messages)

        if not user_message:
            return _response(400, {"error": {"message": "Message content is required.", "source": "chat-lambda"}})

        page_context = payload.get("pageContext") or {}
        route = page_context.get("route")
        problem_slug = page_context.get("problemSlug")
        context_lines = []
        if route:
            context_lines.append(f"Current route: {route}")
        if problem_slug:
            context_lines.append(f"Problem slug: {problem_slug}")
        input_text = "\n".join([*context_lines, f"User message: {user_message}"])

        stream = bedrock_agent.invoke_agent(
            agentId=AGENT_ID,
            agentAliasId=AGENT_ALIAS_ID,
            sessionId=session_id,
            inputText=input_text,
        ).get("completion", [])

        chunks = []
        for event_chunk in stream:
            chunk = event_chunk.get("chunk")
            if chunk and "bytes" in chunk:
                chunks.append(chunk["bytes"].decode("utf-8"))

        reply = "".join(chunks).strip() or "I could not generate a response from the Hexacode assistant."
        return _response(200, {"data": {"reply": {"role": "assistant", "content": reply}, "requestId": request_id}})
    except Exception as exc:
        return _response(502, {"error": {"message": str(exc), "source": "chat-lambda"}})
