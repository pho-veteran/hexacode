from __future__ import annotations

import json
import logging
from datetime import date, datetime, time
from decimal import Decimal
from functools import lru_cache
from typing import Any
from uuid import UUID

from redis import Redis
from redis.exceptions import RedisError

logger = logging.getLogger("hexacode.cache")


def _json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")


@lru_cache(maxsize=8)
def _get_client(redis_url: str) -> Redis | None:
    if not redis_url:
        return None
    return Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=1.0,
        socket_timeout=1.0,
    )


def read_json_cache(redis_url: str, key: str) -> Any | None:
    client = _get_client(redis_url)
    if client is None:
        return None

    try:
        raw_value = client.get(key)
    except RedisError:
        logger.exception("redis get failed", extra={"key": key})
        return None

    if raw_value is None:
        return None

    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        logger.warning("redis value was not valid json", extra={"key": key})
        try:
            client.delete(key)
        except RedisError:
            logger.exception("redis delete failed after invalid json", extra={"key": key})
        return None


def write_json_cache(redis_url: str, key: str, payload: Any, ttl_seconds: int) -> bool:
    client = _get_client(redis_url)
    if client is None:
        return False

    try:
        client.set(
            key,
            json.dumps(payload, default=_json_default),
            ex=max(ttl_seconds, 1),
        )
        return True
    except (RedisError, TypeError, ValueError):
        logger.exception("redis set failed", extra={"key": key})
        return False


def get_cache_version(redis_url: str, key: str) -> int:
    client = _get_client(redis_url)
    if client is None:
        return 0

    try:
        raw_value = client.get(key)
    except RedisError:
        logger.exception("redis get version failed", extra={"key": key})
        return 0

    if raw_value is None:
        return 0

    try:
        return int(raw_value)
    except ValueError:
        logger.warning("redis version value was invalid", extra={"key": key, "value": raw_value})
        return 0


def bump_cache_version(redis_url: str, key: str) -> int:
    client = _get_client(redis_url)
    if client is None:
        return 0

    try:
        return int(client.incr(key))
    except RedisError:
        logger.exception("redis incr failed", extra={"key": key})
        return 0
