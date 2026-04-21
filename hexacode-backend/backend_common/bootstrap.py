from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Callable, TypeVar

from backend_common.settings import ServiceSettings

logger = logging.getLogger("hexacode.bootstrap")
T = TypeVar("T")


def _find_repo_path(relative_path: str) -> Path | None:
    module_path = Path(__file__).resolve()
    candidates = [
        Path.cwd() / relative_path,
        module_path.parent.parent / relative_path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _retry(operation_name: str, operation: Callable[[], T], *, attempts: int = 20, delay_seconds: float = 2.0) -> T:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as exc:  # pragma: no cover - startup retry path
            last_error = exc
            if attempt == attempts:
                break
            logger.warning(
                "bootstrap operation failed, retrying",
                extra={
                    "operation_name": operation_name,
                    "attempt": attempt,
                    "attempts": attempts,
                    "delay_seconds": delay_seconds,
                    "error": str(exc),
                },
            )
            time.sleep(delay_seconds)
    assert last_error is not None
    raise last_error


def bootstrap_service(
    settings: ServiceSettings,
    *,
    apply_schema: bool,
    ensure_storage_buckets: bool,
    ensure_judge_queue: bool,
) -> dict[str, object]:
    summary: dict[str, object] = {
        "service_name": settings.service_name,
        "schema_files": [],
        "buckets": [],
        "judge_queue_url": None,
    }

    if apply_schema:
        schema_path = _find_repo_path("db/new-app-schema.sql")
        if schema_path is None:
            raise RuntimeError("Unable to locate db/new-app-schema.sql for service bootstrap.")
        from backend_common.database import apply_sql_schema

        summary["schema_files"] = _retry(
            "apply_sql_schema",
            lambda: apply_sql_schema(
                settings.database_url,
                schema_path,
            ),
        )

    if ensure_storage_buckets:
        from backend_common.storage import ensure_buckets

        summary["buckets"] = _retry(
            "ensure_storage_buckets",
            lambda: ensure_buckets(settings.storage),
        )

    if ensure_judge_queue:
        from backend_common.queue import SQSJudgeQueue

        queue = SQSJudgeQueue(settings.queue)
        summary["judge_queue_url"] = _retry(
            "ensure_judge_queue",
            queue.ensure_queue,
        )

    logger.info("service bootstrap complete", extra=summary)
    return summary
