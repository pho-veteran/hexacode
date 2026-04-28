from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, Response
from psycopg.rows import dict_row
from psycopg.types.json import Json

from backend_common.auth import AuthContext, require_authenticated_user
from backend_common.authz import (
    PERM_OPS_READ_DASHBOARD,
    PERM_SUBMISSION_CREATE,
    require_local_permission,
)
from backend_common.bootstrap import bootstrap_service
from backend_common.cors import install_cors
from backend_common.database import get_connection
from backend_common.errors import install_exception_handlers
from backend_common.identity import ensure_local_user
from backend_common.queue import JudgeJobMessage, SQSJudgeQueue
from backend_common.settings import load_service_settings
from backend_common.storage import download_object_bytes

SETTINGS = load_service_settings("submission-service")
BOOTSTRAP_SUMMARY: dict[str, Any] = {}
logger = logging.getLogger("hexacode.submission-service")

SAMPLE_RUNTIMES = [
    {
        "profile_key": "cpp17-gcc",
        "runtime_name": "C++ 17",
        "runtime_version": "GCC 13",
        "source_file_name": "main.cpp",
        "compile_command": "g++ -std=c++17 -O2 -pipe -o main main.cpp",
        "run_command": "./main",
    },
    {
        "profile_key": "python3-default",
        "runtime_name": "Python 3",
        "runtime_version": "3.12",
        "source_file_name": "main.py",
        "compile_command": "",
        "run_command": "python3 main.py",
    },
]


def ensure_local_actor(actor: AuthContext) -> dict[str, Any]:
    return ensure_local_user(
        SETTINGS.database_url,
        actor.cognito_sub,
        username=actor.username,
        bootstrap_groups=actor.groups,
    )


def normalize_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none"}:
        return None
    return text


def normalize_custom_cases(value: Any) -> list[dict[str, str | None]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="custom_cases must be an array when provided.")

    normalized: list[dict[str, str | None]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=400,
                detail=f"custom_cases[{index}] must be an object.",
            )
        case_id = normalize_optional_string(item.get("id")) or f"custom-case-{index + 1}"
        if case_id in seen_ids:
            raise HTTPException(
                status_code=400,
                detail="custom_cases ids must be unique within a submission.",
            )
        seen_ids.add(case_id)

        input_text = str(item.get("input") or "")
        if not input_text.strip():
            continue

        expected_output_raw = item.get("expected_output")
        expected_output = None if expected_output_raw is None else str(expected_output_raw)
        normalized.append(
            {
                "id": case_id,
                "input": input_text,
                "expected_output": expected_output,
            }
        )

    return normalized


def invalidate_problem_service_public_cache(*, problem_id: str) -> None:
    problem_service_url = os.getenv("PROBLEM_SERVICE_URL", "").rstrip("/")
    if not problem_service_url or not problem_id:
        return

    try:
        response = httpx.post(
            f"{problem_service_url}/internal/cache/public-problems/invalidate",
            json={
                "reason": "submission-stats-update",
                "problem_id": problem_id,
            },
            timeout=2.0,
        )
        response.raise_for_status()
    except Exception:
        logger.exception(
            "problem-service public cache invalidation failed",
            extra={"problem_id": problem_id},
        )


def seed_runtime_catalog() -> None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            for runtime in SAMPLE_RUNTIMES:
                cursor.execute(
                    """
                    insert into submission.runtimes (
                      profile_key,
                      runtime_name,
                      runtime_version,
                      source_file_name,
                      compile_command,
                      run_command
                    )
                    select %s, %s, %s, %s, %s, %s
                    where not exists (
                      select 1
                      from submission.runtimes
                      where lower(profile_key) = lower(%s)
                    )
                    """,
                    (
                        runtime["profile_key"],
                        runtime["runtime_name"],
                        runtime["runtime_version"],
                        runtime["source_file_name"],
                        runtime["compile_command"],
                        runtime["run_command"],
                        runtime["profile_key"],
                    ),
                )


def list_runtime_rows() -> list[dict[str, Any]]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  id::text as id,
                  profile_key,
                  runtime_name,
                  runtime_version,
                  source_file_name,
                  compile_command,
                  run_command,
                  default_time_limit_ms,
                  default_memory_limit_kb,
                  default_output_limit_kb
                from submission.runtimes
                where is_active
                order by runtime_name asc
                """
            )
            return list(cursor.fetchall())


def get_runtime_row(profile_key: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  id::text as id,
                  profile_key,
                  runtime_name,
                  runtime_version,
                  source_file_name,
                  compile_command,
                  run_command,
                  default_time_limit_ms,
                  default_memory_limit_kb,
                  default_output_limit_kb
                from submission.runtimes
                where lower(profile_key) = lower(%s) and is_active
                """,
                (profile_key,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def storage_object_from_row(
    row: dict[str, Any],
    *,
    prefix: str,
) -> dict[str, Any] | None:
    object_id = row.get(f"{prefix}_id")
    if object_id is None:
        return None

    return {
        "id": object_id,
        "bucket": row.get(f"{prefix}_bucket"),
        "object_key": row.get(f"{prefix}_object_key"),
        "content_type": row.get(f"{prefix}_content_type"),
        "original_filename": row.get(f"{prefix}_original_filename"),
        "size_bytes": row.get(f"{prefix}_size_bytes"),
        "sha256": row.get(f"{prefix}_sha256"),
        "etag": row.get(f"{prefix}_etag"),
    }


def update_outbox_status(event_id: str, *, status_code: str, last_error: str | None = None) -> None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update submission.outbox_events
                set
                  status_code = %s,
                  retry_count = case when %s = 'failed' then retry_count + 1 else retry_count end,
                  last_error = %s,
                  published_at = case when %s = 'published' then now() else published_at end,
                  updated_at = now()
                where id = %s::uuid
                """,
                (status_code, status_code, last_error, status_code, event_id),
            )
        connection.commit()


def create_submission_and_dispatch(payload: dict[str, Any], actor: AuthContext, trace_id: str) -> dict[str, Any]:
    problem_id = str(payload.get("problem_id", "")).strip()
    runtime_profile_key = str(payload.get("runtime_profile_key", "")).strip()
    source_code = str(payload.get("source_code", ""))
    if not problem_id or not runtime_profile_key or not source_code:
        raise HTTPException(
            status_code=400,
            detail="problem_id, runtime_profile_key, and source_code are required.",
        )

    try:
        uuid.UUID(problem_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="problem_id must be a valid UUID.") from exc

    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_SUBMISSION_CREATE,
        detail="Sign-in with contestant permissions is required to submit solutions.",
    )
    queue_message: JudgeJobMessage | None = None
    outbox_event_id = ""
    created_submission: dict[str, Any] | None = None

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select id::text as id, profile_key, source_file_name
                from submission.runtimes
                where lower(profile_key) = lower(%s) and is_active
                """,
                (runtime_profile_key,),
            )
            runtime_row = cursor.fetchone()
            if runtime_row is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Runtime '{runtime_profile_key}' was not found.",
                )

            cursor.execute(
                """
                select id::text as id
                from problem.problems
                where id = %s::uuid
                """,
                (problem_id,),
            )
            problem_row = cursor.fetchone()
            if problem_row is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Problem '{problem_id}' was not found.",
                )

            requested_testset_id = normalize_optional_string(payload.get("testset_id"))
            if requested_testset_id is not None:
                try:
                    uuid.UUID(requested_testset_id)
                except ValueError as exc:
                    raise HTTPException(
                        status_code=400,
                        detail="testset_id must be a valid UUID when provided.",
                    ) from exc

            custom_input_raw = payload.get("custom_input")
            custom_input = (
                None
                if custom_input_raw is None
                else str(custom_input_raw) if str(custom_input_raw) != "" else None
            )
            custom_cases = normalize_custom_cases(payload.get("custom_cases"))
            submission_kind = str(
                payload.get("submission_kind_code")
                or ("run" if requested_testset_id is not None or custom_input or custom_cases else "practice")
            ).strip().lower()
            if submission_kind not in {"practice", "run"}:
                raise HTTPException(
                    status_code=400,
                    detail="submission_kind_code must be one of: practice, run.",
                )

            if submission_kind == "practice":
                if requested_testset_id is not None or custom_input is not None or custom_cases:
                    raise HTTPException(
                        status_code=400,
                        detail="practice submissions cannot include testset_id, custom_input, or custom_cases.",
                    )
            else:
                if requested_testset_id is None and custom_input is None and not custom_cases:
                    raise HTTPException(
                        status_code=400,
                        detail="run submissions require sample testcases, custom_input, custom_cases, or a combination of them.",
                    )
                if requested_testset_id is not None:
                    cursor.execute(
                        """
                        select
                          testsets.id::text as id,
                          (
                            select count(*)::int
                            from problem.testcases as testcases
                            where testcases.testset_id = testsets.id and testcases.is_sample
                          ) as sample_case_count
                        from problem.testsets as testsets
                        where
                          testsets.problem_id = %s::uuid
                          and testsets.id = %s::uuid
                          and testsets.is_active
                        """,
                        (problem_id, requested_testset_id),
                    )
                    requested_testset = cursor.fetchone()
                    if requested_testset is None:
                        raise HTTPException(
                            status_code=404,
                            detail=f"Testset '{requested_testset_id}' was not found for problem '{problem_id}'.",
                        )
                    if int(requested_testset["sample_case_count"] or 0) <= 0:
                        raise HTTPException(
                            status_code=400,
                            detail="run submissions require at least one visible sample testcase in the selected testset.",
                        )

            source_filename = payload.get("source_filename") or runtime_row["source_file_name"]
            metadata_json: dict[str, Any] = {}
            if custom_cases:
                metadata_json["custom_cases"] = custom_cases

            cursor.execute(
                """
                insert into submission.submissions (
                  user_id,
                  problem_id,
                  runtime_id,
                  source_code,
                  source_size_bytes,
                  source_filename,
                  submission_kind_code,
                  testset_id,
                  custom_input,
                  note,
                  user_agent,
                  metadata_json
                )
                values (
                  %s::uuid,
                  %s::uuid,
                  %s::uuid,
                  %s,
                  %s,
                  %s,
                  %s,
                  %s::uuid,
                  %s,
                  %s,
                  %s,
                  %s
                )
                returning
                  id::text as id,
                  status_code as status,
                  submission_kind_code,
                  created_at
                """,
                (
                    local_user["id"],
                    problem_id,
                    runtime_row["id"],
                    source_code,
                    len(source_code.encode("utf-8")),
                    source_filename,
                    submission_kind,
                    requested_testset_id,
                    custom_input,
                    payload.get("note"),
                    payload.get("user_agent"),
                    Json(metadata_json),
                ),
            )
            created_submission = cursor.fetchone()

            cursor.execute(
                """
                insert into submission.judge_jobs (
                  submission_id,
                  triggered_by_user_id,
                  trigger_type_code,
                  trigger_reason
                )
                values (%s::uuid, %s::uuid, 'submit', %s)
                returning id::text as id
                """,
                (
                    created_submission["id"],
                    local_user["id"],
                    payload.get("trigger_reason") or "user_submission",
                ),
            )
            judge_job_row = cursor.fetchone()

            queue_message = JudgeJobMessage.new(
                judge_job_id=judge_job_row["id"],
                submission_id=created_submission["id"],
                problem_id=problem_id,
                runtime_profile_key=runtime_row["profile_key"],
                user_id=local_user["id"],
                trace_id=trace_id,
            )

            cursor.execute(
                """
                insert into submission.outbox_events (
                  aggregate_type,
                  aggregate_id,
                  event_type,
                  payload_json
                )
                values ('submission', %s::uuid, 'judge_job_queued', %s)
                returning id::text as id
                """,
                (
                    created_submission["id"],
                    Json(queue_message.to_dict()),
                ),
            )
            outbox_event_id = cursor.fetchone()["id"]

        connection.commit()

    queue_response: dict[str, Any] | None = None
    dispatch_status = "queued"
    try:
        queue_response = SQSJudgeQueue(SETTINGS.queue).publish(queue_message)
        update_outbox_status(outbox_event_id, status_code="published")
    except Exception as exc:
        dispatch_status = "pending_outbox_retry"
        update_outbox_status(outbox_event_id, status_code="failed", last_error=str(exc))

    return {
        "id": created_submission["id"],
        "status": created_submission["status"],
        "submission_kind_code": created_submission["submission_kind_code"],
        "dispatch_status": dispatch_status,
        "queue": queue_response,
        "outbox_event_id": outbox_event_id,
    }


def get_submission_row(submission_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  submissions.id::text as id,
                  submissions.problem_id::text as problem_id,
                  problems.slug as problem_slug,
                  problems.title as problem_title,
                  submissions.status_code as status,
                  submissions.verdict_code as verdict,
                  submissions.final_score,
                  submissions.time_ms,
                  submissions.memory_kb,
                  submissions.created_at,
                  submissions.judged_at,
                  submissions.submission_kind_code,
                  submissions.source_filename,
                  submissions.custom_input,
                  submissions.note,
                  runtimes.profile_key as runtime_profile_key,
                  runtimes.runtime_name
                from submission.submissions as submissions
                join problem.problems as problems on problems.id = submissions.problem_id
                join submission.runtimes as runtimes on runtimes.id = submissions.runtime_id
                where submissions.id = %s::uuid
                """,
                (submission_id,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def list_user_submission_rows(
    user_id: str,
    *,
    problem_id: str | None = None,
    search_query: str | None = None,
    status: str | None = None,
    verdict: str | None = None,
    submission_kind: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    search_pattern = f"%{search_query.strip()}%" if search_query and search_query.strip() else None
    normalized_limit = max(1, min(int(limit or 50), 200))
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  submissions.id::text as id,
                  submissions.problem_id::text as problem_id,
                  problems.slug as problem_slug,
                  problems.title as problem_title,
                  submissions.status_code as status,
                  submissions.verdict_code as verdict,
                  submissions.final_score,
                  submissions.time_ms,
                  submissions.memory_kb,
                  submissions.created_at,
                  submissions.judged_at,
                  submissions.submission_kind_code,
                  submissions.source_filename,
                  runtimes.profile_key as runtime_profile_key,
                  runtimes.runtime_name
                from submission.submissions as submissions
                join problem.problems as problems on problems.id = submissions.problem_id
                join submission.runtimes as runtimes on runtimes.id = submissions.runtime_id
                where
                  submissions.user_id = %s::uuid
                  and (%s::uuid is null or submissions.problem_id = %s::uuid)
                  and (%s::text is not null or submissions.submission_kind_code <> 'run')
                  and (%s::text is null or submissions.status_code = %s::text)
                  and (%s::text is null or coalesce(submissions.verdict_code, '') = %s::text)
                  and (%s::text is null or submissions.submission_kind_code = %s::text)
                  and (
                    %s::text is null
                    or problems.slug ilike %s::text
                    or problems.title ilike %s::text
                    or coalesce(submissions.source_filename, '') ilike %s::text
                  )
                order by submissions.created_at desc
                limit %s
                """,
                (
                    user_id,
                    problem_id,
                    problem_id,
                    submission_kind,
                    status,
                    status,
                    verdict,
                    verdict,
                    submission_kind,
                    submission_kind,
                    search_pattern,
                    search_pattern,
                    search_pattern,
                    search_pattern,
                    normalized_limit,
                ),
            )
            return list(cursor.fetchall())


def list_problem_submission_states(
    user_id: str,
    *,
    problem_ids: list[str],
) -> list[dict[str, Any]]:
    if not problem_ids:
        return []

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  submissions.problem_id::text as problem_id,
                  count(*)::int as submission_count,
                  bool_or(submissions.status_code = 'done' and submissions.verdict_code = 'ac') as solved,
                  true as attempted,
                  max(submissions.created_at) as last_submission_at,
                  max(
                    case
                      when submissions.status_code = 'done' and submissions.verdict_code = 'ac'
                      then submissions.created_at
                      else null
                    end
                  ) as solved_at
                from submission.submissions as submissions
                where
                  submissions.user_id = %s::uuid
                  and submissions.submission_kind_code <> 'run'
                  and submissions.problem_id = any(%s::uuid[])
                group by submissions.problem_id
                """,
                (user_id, problem_ids),
            )
            return list(cursor.fetchall())


def list_submission_results(submission_id: str) -> list[dict[str, Any]]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  results.id::text as id,
                  results.testcase_id::text as testcase_id,
                  testcases.ordinal as testcase_ordinal,
                  results.result_type_code,
                  results.status_code,
                  results.runtime_ms,
                  results.memory_kb,
                  results.input_preview,
                  results.expected_output_preview,
                  results.actual_output_preview,
                  results.stdout_object_id::text as stdout_object_id,
                  results.stderr_object_id::text as stderr_object_id,
                  results.checker_message,
                  results.exit_code,
                  results.signal,
                  results.message,
                  results.note,
                  results.created_at
                from submission.results as results
                left join problem.testcases as testcases on testcases.id = results.testcase_id
                where results.submission_id = %s::uuid
                order by
                  case results.result_type_code
                    when 'compile' then 0
                    when 'testcase' then 1
                    when 'custom_case' then 2
                    else 3
                  end asc,
                  testcases.ordinal asc nulls first,
                  results.created_at asc
                """,
                (submission_id,),
            )
            return list(cursor.fetchall())


def get_submission_source_code(submission_id: str, user_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  submissions.id::text as id,
                  submissions.source_code,
                  submissions.source_filename,
                  problems.slug as problem_slug
                from submission.submissions as submissions
                join problem.problems as problems on problems.id = submissions.problem_id
                where submissions.id = %s::uuid and submissions.user_id = %s::uuid
                """,
                (submission_id, user_id),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def get_submission_file_row(submission_id: str, object_id: str, user_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  objects.id::text as id,
                  objects.bucket,
                  objects.object_key,
                  objects.content_type,
                  objects.original_filename,
                  objects.size_bytes
                from submission.submissions as submissions
                left join submission.judge_runs as judge_runs
                  on judge_runs.submission_id = submissions.id
                left join submission.results as results
                  on results.submission_id = submissions.id
                join storage.objects as objects
                  on objects.id = %s::uuid
                where
                  submissions.id = %s::uuid
                  and submissions.user_id = %s::uuid
                  and (
                    objects.id = judge_runs.compile_log_object_id
                    or objects.id = results.stdout_object_id
                    or objects.id = results.stderr_object_id
                    or objects.id = submissions.source_object_id
                  )
                limit 1
                """,
                (object_id, submission_id, user_id),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def compute_submission_score(submission_id: str) -> tuple[float | None, int, int]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  problems.scoring_code,
                  submissions.verdict_code,
                  coalesce(sum(testcases.weight), 0)::int as total_weight,
                  coalesce(
                    sum(
                      case
                        when results.result_type_code = 'testcase' and results.status_code = 'ac'
                        then testcases.weight
                        else 0
                      end
                    ),
                    0
                  )::int as passed_weight
                from submission.submissions as submissions
                join problem.problems as problems on problems.id = submissions.problem_id
                left join submission.results as results on results.submission_id = submissions.id
                left join problem.testcases as testcases on testcases.id = results.testcase_id
                where submissions.id = %s::uuid
                group by problems.scoring_code, submissions.verdict_code
                """,
                (submission_id,),
            )
            row = cursor.fetchone()
            if row is None:
                return None, 0, 0

    total_weight = int(row["total_weight"] or 0)
    passed_weight = int(row["passed_weight"] or 0)
    if row["scoring_code"] == "ioi":
        score = 0.0 if total_weight <= 0 else round((passed_weight / total_weight) * 100.0, 2)
    else:
        score = 100.0 if row["verdict_code"] == "ac" else 0.0
    return score, passed_weight, total_weight


def list_dashboard_operations_rows() -> dict[str, Any]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  id::text as id,
                  name,
                  version,
                  status_code,
                  max_parallel_jobs,
                  running_jobs,
                  cpu_usage_percent,
                  memory_used_mb,
                  memory_total_mb,
                  last_seen_at,
                  registered_at
                from submission.judge_workers
                order by last_seen_at desc nulls last, name asc
                limit 20
                """
            )
            workers = list(cursor.fetchall())

            cursor.execute(
                """
                select
                  jobs.id::text as id,
                  jobs.status_code,
                  jobs.attempts,
                  jobs.max_attempts,
                  jobs.trigger_type_code,
                  jobs.trigger_reason,
                  jobs.last_error,
                  jobs.enqueue_at,
                  jobs.finished_at,
                  submissions.id::text as submission_id,
                  problems.slug as problem_slug,
                  workers.name as worker_name
                from submission.judge_jobs as jobs
                join submission.submissions as submissions on submissions.id = jobs.submission_id
                join problem.problems as problems on problems.id = submissions.problem_id
                left join submission.judge_workers as workers on workers.id = jobs.dequeued_by_worker_id
                order by jobs.enqueue_at desc
                limit 25
                """
            )
            jobs = list(cursor.fetchall())

            cursor.execute(
                """
                select
                  runs.id::text as id,
                  runs.status_code,
                  runs.started_at,
                  runs.finished_at,
                  runs.compile_exit_code,
                  runs.compile_time_ms,
                  runs.total_time_ms,
                  runs.total_memory_kb,
                  submissions.id::text as submission_id,
                  problems.slug as problem_slug,
                  workers.name as worker_name
                from submission.judge_runs as runs
                join submission.submissions as submissions on submissions.id = runs.submission_id
                join problem.problems as problems on problems.id = submissions.problem_id
                left join submission.judge_workers as workers on workers.id = runs.worker_id
                order by runs.started_at desc
                limit 25
                """
            )
            runs = list(cursor.fetchall())

            cursor.execute(
                """
                select
                  id::text as id,
                  aggregate_type,
                  aggregate_id::text as aggregate_id,
                  event_type,
                  status_code,
                  retry_count,
                  next_retry_at,
                  last_error,
                  occurred_at,
                  published_at
                from submission.outbox_events
                order by occurred_at desc
                limit 25
                """
            )
            outbox = list(cursor.fetchall())

            cursor.execute(
                """
                select
                  submissions.id::text as submission_id,
                  problems.slug as problem_slug,
                  metrics.runtime_ms,
                  metrics.memory_kb,
                  metrics.passed_testcases,
                  metrics.total_testcases,
                  submissions.final_score,
                  submissions.created_at
                from submission.run_metrics as metrics
                join submission.submissions as submissions on submissions.id = metrics.submission_id
                join problem.problems as problems on problems.id = submissions.problem_id
                order by submissions.created_at desc
                limit 25
                """
            )
            metrics = list(cursor.fetchall())

    return {
        "workers": workers,
        "jobs": jobs,
        "runs": runs,
        "outbox": outbox,
        "metrics": metrics,
    }


def get_judge_job_context(job_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  judge_jobs.id::text as judge_job_id,
                  judge_jobs.status_code as judge_job_status,
                  submissions.id::text as submission_id,
                  submissions.problem_id::text as problem_id,
                  submissions.source_code,
                  submissions.source_filename,
                  submissions.submission_kind_code,
                  submissions.custom_input,
                  submissions.metadata_json,
                  submissions.note as submission_note,
                  submissions.testset_id::text as requested_testset_id,
                  submissions.testcase_id::text as requested_testcase_id,
                  source_objects.id::text as source_id,
                  source_objects.bucket as source_bucket,
                  source_objects.object_key as source_object_key,
                  source_objects.content_type as source_content_type,
                  source_objects.original_filename as source_original_filename,
                  source_objects.size_bytes as source_size_bytes,
                  source_objects.sha256 as source_sha256,
                  source_objects.etag as source_etag,
                  runtimes.id::text as runtime_id,
                  runtimes.profile_key,
                  runtimes.runtime_name,
                  runtimes.runtime_version,
                  runtimes.source_file_name,
                  runtimes.compile_command,
                  runtimes.run_command,
                  runtimes.default_time_limit_ms,
                  runtimes.default_memory_limit_kb,
                  runtimes.default_output_limit_kb
                from submission.judge_jobs as judge_jobs
                join submission.submissions as submissions on submissions.id = judge_jobs.submission_id
                join submission.runtimes as runtimes on runtimes.id = submissions.runtime_id
                left join storage.objects as source_objects on source_objects.id = submissions.source_object_id
                where judge_jobs.id = %s::uuid
                """,
                (job_id,),
            )
            row = cursor.fetchone()
            if row is None:
                return None

    row_dict = dict(row)
    return {
        "judge_job_id": row_dict["judge_job_id"],
        "judge_job_status": row_dict["judge_job_status"],
        "submission": {
            "id": row_dict["submission_id"],
            "problem_id": row_dict["problem_id"],
            "source_code": row_dict["source_code"],
            "source_filename": row_dict["source_filename"],
            "submission_kind_code": row_dict["submission_kind_code"],
            "custom_input": row_dict["custom_input"],
            "custom_cases": list((row_dict.get("metadata_json") or {}).get("custom_cases") or []),
            "note": row_dict["submission_note"],
            "requested_testset_id": row_dict["requested_testset_id"],
            "requested_testcase_id": row_dict["requested_testcase_id"],
            "source_object": storage_object_from_row(row_dict, prefix="source"),
        },
        "runtime": {
            "id": row_dict["runtime_id"],
            "profile_key": row_dict["profile_key"],
            "runtime_name": row_dict["runtime_name"],
            "runtime_version": row_dict["runtime_version"],
            "source_file_name": row_dict["source_file_name"],
            "compile_command": row_dict["compile_command"],
            "run_command": row_dict["run_command"],
            "default_time_limit_ms": row_dict["default_time_limit_ms"],
            "default_memory_limit_kb": row_dict["default_memory_limit_kb"],
            "default_output_limit_kb": row_dict["default_output_limit_kb"],
        },
    }


def mark_judge_job_started(job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    worker_name = str(payload.get("worker_name", "")).strip()
    worker_version = str(payload.get("worker_version", "")).strip() or None
    if not worker_name:
        raise HTTPException(status_code=400, detail="worker_name is required.")
    limits_json = payload.get("limits_json") or {}
    note = str(payload.get("note", "")).strip() or None

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                insert into submission.judge_workers (
                  name,
                  version,
                  status_code,
                  running_jobs,
                  last_seen_at
                )
                values (%s, %s, 'busy', 1, now())
                on conflict (name)
                do update set
                  version = excluded.version,
                  status_code = 'busy',
                  running_jobs = 1,
                  last_seen_at = now(),
                  updated_at = now()
                returning id::text as id
                """,
                (worker_name, worker_version),
            )
            worker_row = cursor.fetchone()

            cursor.execute(
                """
                update submission.judge_jobs
                set
                  status_code = 'running',
                  dequeued_by_worker_id = %s::uuid,
                  dequeued_at = coalesce(dequeued_at, now()),
                  attempts = attempts + 1,
                  updated_at = now()
                where id = %s::uuid
                returning submission_id::text as submission_id
                """,
                (worker_row["id"], job_id),
            )
            job_row = cursor.fetchone()
            if job_row is None:
                raise HTTPException(status_code=404, detail=f"Judge job '{job_id}' was not found.")

            cursor.execute(
                """
                update submission.submissions
                set status_code = 'running', updated_at = now()
                where id = %s::uuid
                returning runtime_id::text as runtime_id
                """,
                (job_row["submission_id"],),
            )
            submission_row = cursor.fetchone()

            cursor.execute(
                """
                insert into submission.judge_runs (
                  submission_id,
                  judge_job_id,
                  worker_id,
                  status_code,
                  runtime_id,
                  limits_json,
                  note
                )
                values (%s::uuid, %s::uuid, %s::uuid, 'running', %s::uuid, %s, %s)
                returning id::text as id
                """,
                (
                    job_row["submission_id"],
                    job_id,
                    worker_row["id"],
                    submission_row["runtime_id"],
                    Json(limits_json),
                    note,
                ),
            )
            judge_run_row = cursor.fetchone()

        connection.commit()

    return {
        "judge_run_id": judge_run_row["id"],
        "submission_id": job_row["submission_id"],
        "worker_id": worker_row["id"],
    }


def mark_judge_job_completed(job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    worker_name = str(payload.get("worker_name", "")).strip()
    verdict_code = str(payload.get("verdict_code", "ac")).strip().lower()
    status_code = str(payload.get("status_code", "done")).strip().lower()
    runtime_ms = int(payload.get("runtime_ms", 0) or 0)
    memory_kb = int(payload.get("memory_kb", 0) or 0)
    results = payload.get("results", [])
    compile_log_object_id = payload.get("compile_log_object_id")
    compile_result = next(
        (
            result
            for result in results
            if str(result.get("result_type_code", "")).strip().lower() == "compile"
        ),
        None,
    )
    compile_exit_code = (
        payload.get("compile_exit_code")
        if payload.get("compile_exit_code") is not None
        else (compile_result.get("exit_code") if compile_result is not None else None)
    )
    compile_time_ms = (
        payload.get("compile_time_ms")
        if payload.get("compile_time_ms") is not None
        else (compile_result.get("runtime_ms") if compile_result is not None else None)
    )

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            if worker_name:
                cursor.execute(
                    """
                    update submission.judge_workers
                    set
                      status_code = 'online',
                      running_jobs = 0,
                      last_seen_at = now(),
                      updated_at = now()
                    where name = %s
                    """,
                    (worker_name,),
                )

            cursor.execute(
                """
                update submission.judge_runs
                set
                  status_code = %s,
                  finished_at = now(),
                  compile_log_object_id = %s::uuid,
                  compile_exit_code = %s,
                  compile_time_ms = %s,
                  total_time_ms = %s,
                  total_memory_kb = %s
                where judge_job_id = %s::uuid and status_code = 'running'
                returning id::text as id, submission_id::text as submission_id
                """,
                (
                    status_code,
                    compile_log_object_id,
                    compile_exit_code,
                    compile_time_ms,
                    runtime_ms,
                    memory_kb,
                    job_id,
                ),
            )
            judge_run_row = cursor.fetchone()
            if judge_run_row is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"No running judge run was found for job '{job_id}'.",
                )

            for result in results:
                result_type_code = str(result.get("result_type_code", "compile")).strip().lower()
                if result_type_code not in {"compile", "testcase", "custom_case"}:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported result_type_code '{result_type_code}'.",
                    )
                testcase_id = result.get("testcase_id")
                if result_type_code == "testcase" and not testcase_id:
                    raise HTTPException(
                        status_code=400,
                        detail="testcase results must include testcase_id.",
                    )
                if result_type_code == "custom_case" and testcase_id:
                    raise HTTPException(
                        status_code=400,
                        detail="custom_case results cannot include testcase_id.",
                    )
                cursor.execute(
                    """
                    insert into submission.results (
                      submission_id,
                      judge_run_id,
                      testcase_id,
                      result_type_code,
                      status_code,
                      runtime_ms,
                      memory_kb,
                      input_preview,
                      expected_output_preview,
                      actual_output_preview,
                      stdout_object_id,
                      stderr_object_id,
                      message,
                      checker_message,
                      exit_code,
                      signal,
                      note
                    )
                    values (
                      %s::uuid,
                      %s::uuid,
                      %s::uuid,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s
                    )
                    """,
                    (
                        judge_run_row["submission_id"],
                        judge_run_row["id"],
                        testcase_id,
                        result_type_code,
                        result.get("status_code", verdict_code),
                        result.get("runtime_ms"),
                        result.get("memory_kb"),
                        result.get("input_preview"),
                        result.get("expected_output_preview"),
                        result.get("actual_output_preview"),
                        result.get("stdout_object_id"),
                        result.get("stderr_object_id"),
                        result.get("message"),
                        result.get("checker_message"),
                        result.get("exit_code"),
                        result.get("signal"),
                        result.get("note"),
                    ),
                )

            final_verdict_code = verdict_code if status_code == "done" else (verdict_code or "ie")
            cursor.execute(
                """
                update submission.submissions
                set
                  status_code = %s,
                  verdict_code = %s,
                  time_ms = %s,
                  memory_kb = %s,
                  judged_at = now(),
                  updated_at = now()
                where id = %s::uuid
                returning problem_id::text as problem_id, submission_kind_code
                """,
                (
                    status_code,
                    final_verdict_code,
                    runtime_ms,
                    memory_kb,
                    judge_run_row["submission_id"],
                ),
            )
            submission_row = cursor.fetchone()

            cursor.execute(
                """
                update submission.judge_jobs
                set
                  status_code = %s,
                  finished_at = now(),
                  updated_at = now()
                where id = %s::uuid
                """,
                (status_code, job_id),
            )

            if submission_row["submission_kind_code"] != "run":
                cursor.execute(
                    """
                    insert into problem.problem_stats (
                      problem_id,
                      submissions_count,
                      accepted_count,
                      unique_solvers_count
                    )
                    values (
                      %s::uuid,
                      1,
                      case when %s = 'ac' then 1 else 0 end,
                      0
                    )
                    on conflict (problem_id)
                    do update set
                      submissions_count = problem.problem_stats.submissions_count + 1,
                      accepted_count = problem.problem_stats.accepted_count
                        + case when %s = 'ac' then 1 else 0 end,
                      updated_at = now()
                    """,
                    (
                        submission_row["problem_id"],
                        verdict_code,
                        verdict_code,
                    ),
                )

            testcase_results = [
                result
                for result in results
                if str(result.get("result_type_code", "compile")).strip() == "testcase"
            ]
            cursor.execute(
                """
                insert into submission.run_metrics (
                  submission_id,
                  runtime_ms,
                  memory_kb,
                  passed_testcases,
                  total_testcases
                )
                values (%s::uuid, %s, %s, %s, %s)
                on conflict (submission_id)
                do update set
                  runtime_ms = excluded.runtime_ms,
                  memory_kb = excluded.memory_kb,
                  passed_testcases = excluded.passed_testcases,
                  total_testcases = excluded.total_testcases,
                  updated_at = now()
                """,
                (
                    judge_run_row["submission_id"],
                    runtime_ms,
                    memory_kb,
                    sum(
                        1
                        for result in testcase_results
                        if str(result.get("status_code", "")).strip().lower() == "ac"
                    ),
                    len(testcase_results),
                ),
            )

        connection.commit()

    final_score, passed_weight, total_weight = compute_submission_score(judge_run_row["submission_id"])
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update submission.submissions
                set
                  final_score = %s,
                  updated_at = now(),
                  metadata_json = jsonb_set(
                    jsonb_set(metadata_json, '{passed_weight}', to_jsonb(%s::int), true),
                    '{total_weight}',
                    to_jsonb(%s::int),
                    true
                  )
                where id = %s::uuid
                """,
                (final_score, passed_weight, total_weight, judge_run_row["submission_id"]),
            )

        connection.commit()

    invalidate_problem_service_public_cache(problem_id=submission_row["problem_id"])

    return {
        "submission_id": judge_run_row["submission_id"],
        "judge_run_id": judge_run_row["id"],
        "status": status_code,
        "verdict": final_verdict_code,
        "final_score": final_score,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    global BOOTSTRAP_SUMMARY
    BOOTSTRAP_SUMMARY = bootstrap_service(
        SETTINGS,
        apply_schema=True,
        # Submission APIs can serve requests without mutating bucket state at startup.
        # In production the submission bucket is externally managed, and auto-create
        # attempts currently fail against the bucket namespace configuration.
        ensure_storage_buckets=False,
        ensure_judge_queue=True,
    )
    seed_runtime_catalog()
    yield


app = FastAPI(
    title="Hexacode Submission Service",
    version="0.2.0",
    description="Submission service with queue dispatch and worker callback contracts.",
    lifespan=lifespan,
)
install_cors(app)
install_exception_handlers(app, SETTINGS.service_name)


@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id", str(uuid.uuid4()))
    request.state.correlation_id = correlation_id
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    return response


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": SETTINGS.service_name,
        "queue_driver": SETTINGS.queue.driver,
        "judge_queue_url": BOOTSTRAP_SUMMARY.get("judge_queue_url"),
        "schema_files": BOOTSTRAP_SUMMARY.get("schema_files", []),
    }


@app.get("/api/runtimes")
async def list_runtimes() -> dict[str, Any]:
    runtimes = list_runtime_rows()
    return {"data": runtimes, "meta": {"count": len(runtimes)}}


@app.get("/internal/runtimes/{profile_key}")
async def get_internal_runtime(profile_key: str) -> dict[str, Any]:
    runtime = get_runtime_row(profile_key)
    if runtime is None:
        raise HTTPException(status_code=404, detail=f"Runtime '{profile_key}' was not found.")
    return {"data": runtime}


@app.post("/api/submissions", status_code=202)
async def create_submission(
    payload: dict[str, Any],
    request: Request,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    created_submission = create_submission_and_dispatch(
        payload,
        actor,
        request.state.correlation_id,
    )
    return {
        "data": created_submission,
        "meta": {"source": SETTINGS.service_name},
    }


@app.get("/api/submissions")
async def list_my_submissions(
    problem_id: str | None = None,
    q: str | None = None,
    status: str | None = None,
    verdict: str | None = None,
    kind: str | None = None,
    limit: int = 50,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    if problem_id:
        try:
            uuid.UUID(problem_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="problem_id must be a valid UUID.") from exc

    local_user = ensure_local_actor(actor)
    submissions = list_user_submission_rows(
        local_user["id"],
        problem_id=problem_id,
        search_query=str(q or "").strip() or None,
        status=str(status or "").strip() or None,
        verdict=str(verdict or "").strip().lower() or None,
        submission_kind=str(kind or "").strip().lower() or None,
        limit=limit,
    )
    return {
        "data": submissions,
        "meta": {"count": len(submissions), "limit": max(1, min(int(limit or 50), 200))},
    }


@app.get("/api/submissions/problem-states")
async def list_my_problem_submission_states(
    problem_ids: list[str] = Query(default=[]),
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    normalized_problem_ids: list[str] = []
    for problem_id in problem_ids:
        if not problem_id:
            continue
        try:
            normalized_problem_ids.append(str(uuid.UUID(problem_id)))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="problem_ids must all be valid UUIDs.") from exc

    local_user = ensure_local_actor(actor)
    states = list_problem_submission_states(local_user["id"], problem_ids=normalized_problem_ids)
    return {
        "data": states,
        "meta": {"count": len(states)},
    }


@app.get("/api/submissions/{submission_id}")
async def get_submission(submission_id: str) -> dict[str, Any]:
    submission = get_submission_row(submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail=f"Submission '{submission_id}' was not found.")
    return {"data": submission}


@app.get("/api/submissions/{submission_id}/source")
async def get_submission_source(
    submission_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    source_row = get_submission_source_code(submission_id, local_user["id"])
    if source_row is None:
        raise HTTPException(status_code=404, detail=f"Submission '{submission_id}' was not found.")
    return {"data": source_row}


@app.get("/api/submissions/{submission_id}/results")
async def get_submission_results(submission_id: str) -> dict[str, Any]:
    return {
        "data": {
            "submission_id": submission_id,
            "results": list_submission_results(submission_id),
        }
    }


@app.get("/api/submissions/{submission_id}/files/{object_id}")
async def download_submission_file(
    submission_id: str,
    object_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> Response:
    local_user = ensure_local_actor(actor)
    object_row = get_submission_file_row(submission_id, object_id, local_user["id"])
    if object_row is None:
        raise HTTPException(status_code=404, detail="The requested submission file was not found.")

    file_bytes = download_object_bytes(
        SETTINGS.storage,
        bucket=object_row["bucket"],
        object_key=object_row["object_key"],
    )
    filename = object_row["original_filename"] or object_row["object_key"].rsplit("/", 1)[-1]
    response = Response(
        content=file_bytes,
        media_type=object_row["content_type"] or "application/octet-stream",
    )
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.get("/api/dashboard/operations")
async def get_dashboard_operations(
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_OPS_READ_DASHBOARD,
        detail="Moderator permissions are required for operations views.",
    )
    return {"data": list_dashboard_operations_rows(), "meta": {"source": SETTINGS.service_name}}


@app.get("/internal/judge-jobs/{job_id}/context")
async def get_internal_judge_job_context(job_id: str) -> dict[str, Any]:
    context = get_judge_job_context(job_id)
    if context is None:
        raise HTTPException(status_code=404, detail=f"Judge job '{job_id}' was not found.")
    return {"data": context}


@app.post("/internal/judge-jobs/{job_id}/started")
async def start_judge_job(job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"data": mark_judge_job_started(job_id, payload)}


@app.post("/internal/judge-jobs/{job_id}/completed")
async def complete_judge_job(job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"data": mark_judge_job_completed(job_id, payload)}
