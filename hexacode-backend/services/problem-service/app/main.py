from __future__ import annotations

import hashlib
import io
import json
import mimetypes
import re
import uuid
import zipfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from psycopg.rows import dict_row
from psycopg.types.json import Json
from starlette.datastructures import FormData, UploadFile

from backend_common.auth import AuthContext, require_authenticated_user
from backend_common.authz import (
    PERM_ADMIN_FULL,
    PERM_OPS_MANAGE_STORAGE_ORPHANS,
    PERM_PROBLEM_ARCHIVE_ANY,
    PERM_PROBLEM_ARCHIVE_OWN,
    PERM_PROBLEM_CREATE,
    PERM_PROBLEM_PUBLISH,
    PERM_PROBLEM_READ_OWN_DASHBOARD,
    PERM_PROBLEM_READ_REVIEW_QUEUE,
    PERM_PROBLEM_REQUEST_REVIEW_OWN,
    PERM_PROBLEM_REVIEW,
    PERM_PROBLEM_UNPUBLISH,
    PERM_PROBLEM_UPDATE_OWN_DRAFT,
    PERM_TAG_CREATE,
    PERM_TAG_DELETE,
    PERM_TAG_LIFECYCLE,
    PERM_TAG_READ_DASHBOARD,
    PERM_TAG_UPDATE,
    PERM_TESTSET_MANAGE_OWN,
    local_user_has_permission,
    require_local_permission,
)
from backend_common.bootstrap import bootstrap_service
from backend_common.cache import (
    bump_cache_version,
    get_cache_version,
    read_json_cache,
    write_json_cache,
)
from backend_common.cors import install_cors
from backend_common.database import get_connection
from backend_common.errors import install_exception_handlers
from backend_common.identity import ensure_local_user
from backend_common.settings import load_service_settings
from backend_common.storage import delete_object, download_object_bytes, upload_object_bytes

SETTINGS = load_service_settings("problem-service")
BOOTSTRAP_SUMMARY: dict[str, Any] = {}

SAMPLE_TAGS = [
    {
        "slug": "arrays",
        "name": "Arrays",
        "description": "Indexing, prefix sums, and sequence reasoning.",
        "color": "#0f766e",
    },
    {
        "slug": "graphs",
        "name": "Graphs",
        "description": "Traversal, shortest paths, and graph modeling.",
        "color": "#1d4ed8",
    },
]

SAMPLE_PROBLEMS = [
    {
        "slug": "two-sum",
        "title": "Two Sum",
        "difficulty_code": "easy",
        "visibility_code": "public",
        "status_code": "published",
        "statement_md": "# Two Sum\n\nReturn the two indices whose values add up to the target.",
        "tag_slugs": ["arrays"],
    },
    {
        "slug": "range-min-query",
        "title": "Range Minimum Query",
        "difficulty_code": "hard",
        "visibility_code": "private",
        "status_code": "draft",
        "statement_md": "# Range Minimum Query\n\nSupport fast range minimum queries over a static array.",
        "tag_slugs": ["arrays", "graphs"],
    },
]

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DIFFICULTY_CODES = {"easy", "medium", "hard"}
VISIBILITY_CODES = {"private", "public"}
STATUS_CODES = {"draft", "pending_review", "approved", "published", "rejected", "archived"}
SCORING_CODES = {"icpc", "ioi"}
TYPE_CODES = {"traditional"}
TESTSET_TYPE_CODES = {"primary", "samples", "hidden", "custom"}
CHECKER_TYPE_CODES = {"diff", "custom"}
PROBLEM_LIST_SORT_CODES = {"newest", "title", "acceptance"}
DASHBOARD_SCOPE_CODES = {"mine", "review"}
PUBLIC_PROBLEM_VISIBILITY_CODE = "public"
PUBLIC_PROBLEM_STATUS_CODE = "published"
AUTHOR_EDITABLE_STATUS_CODES = {"draft", "pending_review"}
HEX_COLOR_PATTERN = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
INPUT_SUFFIXES = (".in", ".inp", ".input")
OUTPUT_SUFFIXES = (".out", ".ans", ".answer", ".output")
MAX_STATEMENT_BYTES = 2 * 1024 * 1024
MAX_STATEMENT_ASSET_BYTES = 10 * 1024 * 1024
MAX_TESTSET_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_TESTCASE_BYTES = 8 * 1024 * 1024
MAX_CHECKER_SOURCE_BYTES = 2 * 1024 * 1024
INLINE_TESTCASE_TEXT_BYTES = 16 * 1024
PUBLIC_CACHE_VERSION_KEY = f"{SETTINGS.service_name}:public-problems:version"
PROBLEM_LIST_CACHE_TTL_SECONDS = 15
PROBLEM_DETAIL_CACHE_TTL_SECONDS = 60
PROBLEM_SOLVE_CACHE_TTL_SECONDS = 30


@dataclass(frozen=True)
class UploadedBinary:
    filename: str
    content_type: str | None
    data: bytes


@dataclass(frozen=True)
class StoredObject:
    id: str
    bucket: str
    object_key: str
    content_type: str | None
    original_filename: str | None
    size_bytes: int
    sha256: str
    etag: str | None
    metadata_json: dict[str, Any]


@dataclass(frozen=True)
class ExtractedArchiveCase:
    case_key: str
    input_archive_path: str
    input_suffix: str
    input_bytes: bytes
    output_archive_path: str
    output_suffix: str
    output_bytes: bytes


def build_public_problem_list_cache_key(filters: dict[str, Any]) -> str:
    version = get_cache_version(SETTINGS.redis.url, PUBLIC_CACHE_VERSION_KEY)
    fingerprint = hashlib.sha256(
        json.dumps(filters, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"{SETTINGS.service_name}:public-problems:list:v{version}:{fingerprint}"


def build_public_problem_detail_cache_key(problem_slug: str) -> str:
    version = get_cache_version(SETTINGS.redis.url, PUBLIC_CACHE_VERSION_KEY)
    normalized_slug = problem_slug.strip().lower()
    return f"{SETTINGS.service_name}:public-problems:detail:v{version}:{normalized_slug}"


def build_public_problem_solve_cache_key(problem_slug: str) -> str:
    version = get_cache_version(SETTINGS.redis.url, PUBLIC_CACHE_VERSION_KEY)
    normalized_slug = problem_slug.strip().lower()
    return f"{SETTINGS.service_name}:public-problems:solve:v{version}:{normalized_slug}"


def invalidate_public_problem_cache(
    *,
    reason: str,
    problem_id: str | None = None,
    problem_slug: str | None = None,
) -> int:
    _ = problem_id
    _ = problem_slug
    version = bump_cache_version(SETTINGS.redis.url, PUBLIC_CACHE_VERSION_KEY)
    return version


def ensure_local_actor(actor: AuthContext) -> dict[str, Any]:
    return ensure_local_user(
        SETTINGS.database_url,
        actor.cognito_sub,
        username=actor.username,
        bootstrap_groups=actor.groups,
    )


def normalize_dashboard_scope(scope: str | None) -> str:
    normalized_scope = str(scope or "mine").strip().lower() or "mine"
    if normalized_scope not in DASHBOARD_SCOPE_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"scope must be one of: {', '.join(sorted(DASHBOARD_SCOPE_CODES))}.",
        )
    return normalized_scope


def enforce_problem_create_policy(
    actor: AuthContext,
    *,
    visibility_code: str,
    status_code: str,
) -> tuple[str, str]:
    if status_code not in AUTHOR_EDITABLE_STATUS_CODES:
        raise HTTPException(
            status_code=403,
            detail="Use explicit lifecycle actions to approve, publish, reject, archive, or unpublish problems.",
        )
    _ = actor
    return "private", status_code


def enforce_problem_update_policy(
    *,
    current_visibility_code: str,
    current_status_code: str,
    requested_visibility_code: str,
    requested_status_code: str,
) -> tuple[str, str]:
    if (
        requested_visibility_code == current_visibility_code
        and requested_status_code == current_status_code
    ):
        return requested_visibility_code, requested_status_code

    if requested_status_code not in AUTHOR_EDITABLE_STATUS_CODES:
        raise HTTPException(
            status_code=403,
            detail="Use explicit lifecycle actions to approve, publish, reject, archive, or unpublish problems.",
        )

    if current_status_code not in (*AUTHOR_EDITABLE_STATUS_CODES, "rejected"):
        raise HTTPException(
            status_code=403,
            detail="This problem lifecycle state can only change through explicit review actions.",
        )

    return "private", requested_status_code


def seed_problem_catalog() -> None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            for tag in SAMPLE_TAGS:
                cursor.execute(
                    """
                    insert into problem.tags (slug, name, description, color)
                    select %s, %s, %s, %s
                    where not exists (
                      select 1 from problem.tags where lower(slug) = lower(%s)
                    )
                    """,
                    (
                        tag["slug"],
                        tag["name"],
                        tag["description"],
                        tag["color"],
                        tag["slug"],
                    ),
                )

            for problem in SAMPLE_PROBLEMS:
                cursor.execute(
                    """
                    insert into problem.problems (
                      slug,
                      title,
                      statement_source_code,
                      statement_md,
                      difficulty_code,
                      visibility_code,
                      status_code
                    )
                    select
                      %s,
                      %s,
                      'inline_md',
                      %s,
                      %s,
                      %s,
                      %s
                    where not exists (
                      select 1 from problem.problems where lower(slug) = lower(%s)
                    )
                    """,
                    (
                        problem["slug"],
                        problem["title"],
                        problem["statement_md"],
                        problem["difficulty_code"],
                        problem["visibility_code"],
                        problem["status_code"],
                        problem["slug"],
                    ),
                )

                cursor.execute(
                    """
                    select id::text as id
                    from problem.problems
                    where lower(slug) = lower(%s)
                    """,
                    (problem["slug"],),
                )
                problem_row = cursor.fetchone()
                if problem_row is None:
                    continue

                for tag_slug in problem["tag_slugs"]:
                    cursor.execute(
                        """
                        insert into problem.problem_tags (problem_id, tag_id)
                        select %s::uuid, tags.id
                        from problem.tags as tags
                        where lower(tags.slug) = lower(%s)
                        on conflict do nothing
                        """,
                        (problem_row["id"], tag_slug),
                    )


def normalize_choice(
    value: Any,
    *,
    field_name: str,
    allowed: set[str],
    default: str,
) -> str:
    normalized = str(value or default).strip().lower() or default
    if normalized not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be one of: {', '.join(sorted(allowed))}.",
        )
    return normalized


def normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def coerce_positive_int(value: Any, *, field_name: str) -> int | None:
    normalized = normalize_optional_text(value)
    if normalized is None:
        return None
    try:
        parsed = int(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a positive integer.") from exc
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a positive integer.")
    return parsed


def parse_bool_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def parse_tag_slugs(value: Any) -> list[str]:
    if value is None:
        return []

    raw_values = value if isinstance(value, list) else [value]
    tags: list[str] = []
    for raw_value in raw_values:
        for piece in str(raw_value).replace("\n", ",").split(","):
            tag_slug = piece.strip().lower()
            if tag_slug and tag_slug not in tags:
                tags.append(tag_slug)
    return tags


def normalize_tag_slug(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="slug is required.")
    if not SLUG_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="slug may only contain lowercase letters, numbers, and single hyphens.",
        )
    return normalized


def normalize_tag_name(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="name is required.")
    return normalized


def normalize_tag_color(value: Any) -> str | None:
    normalized = normalize_optional_text(value)
    if normalized is None:
        return None
    if not HEX_COLOR_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="color must be a hex value such as #0f766e.",
        )
    return normalized


def parse_tag_write_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": normalize_tag_slug(payload.get("slug")),
        "name": normalize_tag_name(payload.get("name")),
        "description": normalize_optional_text(payload.get("description")),
        "color": normalize_tag_color(payload.get("color")),
        "icon": normalize_optional_text(payload.get("icon")),
        "is_active": parse_bool_flag(payload.get("is_active", True)),
    }


def sanitize_file_component(filename: str | None, fallback: str = "file") -> str:
    if filename:
        normalized = PurePosixPath(str(filename).replace("\\", "/")).name
    else:
        normalized = fallback
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", normalized).strip(".-_")
    return cleaned or fallback


def infer_content_type(filename: str, provided_type: str | None) -> str:
    if provided_type:
        return provided_type
    guessed_type, _ = mimetypes.guess_type(filename)
    return guessed_type or "application/octet-stream"


def infer_statement_source(upload: UploadedBinary) -> str:
    lowered_name = upload.filename.lower()
    content_type = (upload.content_type or "").lower()
    if lowered_name.endswith(".pdf") or content_type == "application/pdf":
        return "object_pdf"
    if lowered_name.endswith(".md") or lowered_name.endswith(".markdown") or "markdown" in content_type:
        return "object_md"
    raise HTTPException(
        status_code=400,
        detail="statement_file must be a Markdown or PDF file.",
    )


def split_case_archive_path(path: str) -> tuple[str, str, str] | None:
    normalized = PurePosixPath(path).as_posix()
    lowered = normalized.lower()
    for suffix in INPUT_SUFFIXES:
        if lowered.endswith(suffix):
            return ("input", normalized[: -len(suffix)], suffix)
    for suffix in OUTPUT_SUFFIXES:
        if lowered.endswith(suffix):
            return ("output", normalized[: -len(suffix)], suffix)
    return None


def natural_sort_key(value: str) -> list[Any]:
    parts = re.split(r"(\d+)", value.lower())
    return [int(part) if part.isdigit() else part for part in parts]


def extract_testcases_from_archive(archive: UploadedBinary) -> list[ExtractedArchiveCase]:
    try:
        zip_file = zipfile.ZipFile(io.BytesIO(archive.data))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="testset_archive must be a valid zip file.") from exc

    case_files: dict[str, dict[str, dict[str, Any]]] = {}
    with zip_file:
        for member in zip_file.infolist():
            if member.is_dir():
                continue

            normalized_name = PurePosixPath(member.filename).as_posix()
            base_name = PurePosixPath(normalized_name).name
            if normalized_name.startswith("__MACOSX/") or base_name.startswith("."):
                continue

            parsed_path = split_case_archive_path(normalized_name)
            if parsed_path is None:
                continue

            case_kind, case_key, suffix = parsed_path
            payload = zip_file.read(member)
            if len(payload) > MAX_TESTCASE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Testcase file '{normalized_name}' exceeds the {MAX_TESTCASE_BYTES // (1024 * 1024)} MB limit.",
                )

            case_entry = case_files.setdefault(case_key, {})
            if case_kind in case_entry:
                raise HTTPException(
                    status_code=400,
                    detail=f"Duplicate testcase {case_kind} detected for '{case_key}' in the uploaded archive.",
                )
            case_entry[case_kind] = {
                "archive_path": normalized_name,
                "suffix": suffix,
                "data": payload,
            }

    if not case_files:
        raise HTTPException(
            status_code=400,
            detail="testset_archive must contain matching input/output files like `1.in` and `1.out`.",
        )

    missing_pairs = [
        case_key
        for case_key, files in case_files.items()
        if "input" not in files or "output" not in files
    ]
    if missing_pairs:
        preview = ", ".join(missing_pairs[:3])
        suffix = "..." if len(missing_pairs) > 3 else ""
        raise HTTPException(
            status_code=400,
            detail=f"Every testcase needs both input and output files. Missing pairs for: {preview}{suffix}",
        )

    cases: list[ExtractedArchiveCase] = []
    for case_key in sorted(case_files, key=natural_sort_key):
        files = case_files[case_key]
        cases.append(
            ExtractedArchiveCase(
                case_key=case_key,
                input_archive_path=files["input"]["archive_path"],
                input_suffix=files["input"]["suffix"],
                input_bytes=files["input"]["data"],
                output_archive_path=files["output"]["archive_path"],
                output_suffix=files["output"]["suffix"],
                output_bytes=files["output"]["data"],
            )
        )
    return cases


def maybe_inline_testcase_text(data: bytes) -> str | None:
    if len(data) > INLINE_TESTCASE_TEXT_BYTES:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def build_stored_object(
    *,
    object_id: str,
    bucket: str,
    object_key: str,
    upload: UploadedBinary,
    metadata_json: dict[str, Any],
) -> StoredObject:
    upload_result = upload_object_bytes(
        SETTINGS.storage,
        bucket=bucket,
        object_key=object_key,
        data=upload.data,
        content_type=upload.content_type,
        metadata=metadata_json,
    )
    return StoredObject(
        id=object_id,
        bucket=bucket,
        object_key=object_key,
        content_type=upload.content_type,
        original_filename=upload.filename,
        size_bytes=len(upload.data),
        sha256=hashlib.sha256(upload.data).hexdigest(),
        etag=upload_result.get("etag"),
        metadata_json=metadata_json,
    )


def cleanup_uploaded_objects(uploaded_objects: list[StoredObject]) -> None:
    for stored_object in uploaded_objects:
        try:
            delete_object(
                SETTINGS.storage,
                bucket=stored_object.bucket,
                object_key=stored_object.object_key,
            )
        except Exception:
            continue


def prune_storage_object_records(
    cursor: Any,
    candidate_object_ids: list[str],
) -> list[dict[str, Any]]:
    normalized_ids = [object_id for object_id in candidate_object_ids if object_id]
    if not normalized_ids:
        return []

    cursor.execute(
        """
        with candidate_objects as (
          select distinct unnest(%s::uuid[]) as object_id
        ),
        still_referenced as (
          select statement_object_id as object_id
          from problem.problems
          where statement_object_id = any(%s::uuid[])
          union
          select storage_object_id
          from problem.problem_assets
          where storage_object_id = any(%s::uuid[])
          union
          select archive_object_id
          from problem.testsets
          where archive_object_id = any(%s::uuid[])
          union
          select input_object_id
          from problem.testcases
          where input_object_id = any(%s::uuid[])
          union
          select expected_output_object_id
          from problem.testcases
          where expected_output_object_id = any(%s::uuid[])
          union
          select source_object_id
          from problem.checkers
          where source_object_id = any(%s::uuid[])
          union
          select compiled_object_id
          from problem.checkers
          where compiled_object_id = any(%s::uuid[])
          union
          select source_object_id
          from submission.submissions
          where source_object_id = any(%s::uuid[])
          union
          select compile_log_object_id
          from submission.judge_runs
          where compile_log_object_id = any(%s::uuid[])
          union
          select stdout_object_id
          from submission.results
          where stdout_object_id = any(%s::uuid[])
          union
          select stderr_object_id
          from submission.results
          where stderr_object_id = any(%s::uuid[])
        )
        select
          objects.id::text as id,
          objects.bucket,
          objects.object_key
        from storage.objects as objects
        join candidate_objects on candidate_objects.object_id = objects.id
        where not exists (
          select 1
          from still_referenced
          where still_referenced.object_id = objects.id
        )
        """,
        (
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
            normalized_ids,
        ),
    )
    object_rows = [dict(row) for row in cursor.fetchall()]
    if not object_rows:
        return []

    cursor.execute(
        "delete from storage.objects where id = any(%s::uuid[])",
        ([row["id"] for row in object_rows],),
    )
    return object_rows


def cleanup_storage_object_rows(object_rows: list[dict[str, Any]]) -> None:
    for object_row in object_rows:
        try:
            delete_object(
                SETTINGS.storage,
                bucket=object_row["bucket"],
                object_key=object_row["object_key"],
            )
        except Exception:
            continue


def list_unreferenced_storage_object_rows(
    cursor: Any,
    *,
    limit: int,
) -> tuple[int, list[dict[str, Any]]]:
    normalized_limit = max(1, min(limit, 500))
    referenced_objects_cte = """
        with referenced_objects as (
          select statement_object_id as object_id from problem.problems where statement_object_id is not null
          union
          select storage_object_id from problem.problem_assets
          union
          select archive_object_id from problem.testsets where archive_object_id is not null
          union
          select input_object_id from problem.testcases where input_object_id is not null
          union
          select expected_output_object_id from problem.testcases where expected_output_object_id is not null
          union
          select source_object_id from problem.checkers where source_object_id is not null
          union
          select compiled_object_id from problem.checkers where compiled_object_id is not null
          union
          select source_object_id from submission.submissions where source_object_id is not null
          union
          select compile_log_object_id from submission.judge_runs where compile_log_object_id is not null
          union
          select stdout_object_id from submission.results where stdout_object_id is not null
          union
          select stderr_object_id from submission.results where stderr_object_id is not null
        )
    """
    cursor.execute(
        f"""
        {referenced_objects_cte}
        select count(*)::int as count
        from storage.objects as objects
        where not exists (
          select 1
          from referenced_objects
          where referenced_objects.object_id = objects.id
        )
        """
    )
    total_count = int((cursor.fetchone() or {}).get("count") or 0)

    cursor.execute(
        f"""
        {referenced_objects_cte}
        select
          objects.id::text as id,
          objects.bucket,
          objects.object_key,
          objects.content_type,
          objects.original_filename,
          objects.size_bytes,
          objects.created_at,
          objects.metadata_json->>'role' as role,
          objects.metadata_json->>'problem_id' as problem_id,
          objects.metadata_json->>'testset_id' as testset_id,
          objects.metadata_json->>'checker_type_code' as checker_type_code
        from storage.objects as objects
        where not exists (
          select 1
          from referenced_objects
          where referenced_objects.object_id = objects.id
        )
        order by objects.created_at asc
        limit %s
        """,
        (normalized_limit,),
    )
    return total_count, [dict(row) for row in cursor.fetchall()]


def inspect_storage_lifecycle(limit: int, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_OPS_MANAGE_STORAGE_ORPHANS,
        detail="Moderator permissions are required to inspect storage lifecycle state.",
    )

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            total_count, object_rows = list_unreferenced_storage_object_rows(cursor, limit=limit)

    return {
        "total_count": total_count,
        "objects": object_rows,
        "limit": max(1, min(limit, 500)),
    }


def cleanup_storage_lifecycle(limit: int, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_OPS_MANAGE_STORAGE_ORPHANS,
        detail="Moderator permissions are required to clean storage lifecycle state.",
    )

    deleted_rows: list[dict[str, Any]] = []
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            total_count, candidate_rows = list_unreferenced_storage_object_rows(cursor, limit=limit)
            deleted_rows = prune_storage_object_records(
                cursor,
                [row["id"] for row in candidate_rows],
            )
        connection.commit()

    cleanup_storage_object_rows(deleted_rows)
    return {
        "scanned_count": min(max(1, min(limit, 500)), total_count),
        "deleted_count": len(deleted_rows),
        "deleted_objects": deleted_rows,
        "remaining_estimate": max(0, total_count - len(deleted_rows)),
    }


def insert_storage_object_record(
    cursor: Any,
    *,
    stored_object: StoredObject,
    uploaded_by_user_id: str | None,
) -> None:
    cursor.execute(
        """
        insert into storage.objects (
          id,
          bucket,
          object_key,
          content_type,
          original_filename,
          size_bytes,
          sha256,
          etag,
          metadata_json,
          uploaded_by_user_id
        )
        values (
          %s::uuid,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s::uuid
        )
        """,
        (
            stored_object.id,
            stored_object.bucket,
            stored_object.object_key,
            stored_object.content_type,
            stored_object.original_filename,
            stored_object.size_bytes,
            stored_object.sha256,
            stored_object.etag,
            Json(stored_object.metadata_json),
            uploaded_by_user_id,
        ),
    )


def upsert_storage_object_record(
    cursor: Any,
    *,
    stored_object: StoredObject,
    uploaded_by_user_id: str | None,
) -> dict[str, Any]:
    cursor.execute(
        """
        insert into storage.objects (
          id,
          bucket,
          object_key,
          content_type,
          original_filename,
          size_bytes,
          sha256,
          etag,
          metadata_json,
          uploaded_by_user_id
        )
        values (
          %s::uuid,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s,
          %s::uuid
        )
        on conflict (bucket, object_key)
        do update set
          content_type = excluded.content_type,
          original_filename = excluded.original_filename,
          size_bytes = excluded.size_bytes,
          sha256 = excluded.sha256,
          etag = excluded.etag,
          metadata_json = excluded.metadata_json,
          updated_at = now()
        returning
          id::text as id,
          bucket,
          object_key,
          content_type,
          original_filename,
          size_bytes,
          sha256,
          etag
        """,
        (
            stored_object.id,
            stored_object.bucket,
            stored_object.object_key,
            stored_object.content_type,
            stored_object.original_filename,
            stored_object.size_bytes,
            stored_object.sha256,
            stored_object.etag,
            Json(stored_object.metadata_json),
            uploaded_by_user_id,
        ),
    )
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Failed to upsert storage object metadata.")
    return dict(row)


def shape_storage_object_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "bucket": row["bucket"],
        "object_key": row["object_key"],
        "content_type": row["content_type"],
        "original_filename": row["original_filename"],
        "size_bytes": row["size_bytes"],
        "sha256": row["sha256"],
        "etag": row["etag"],
    }


def shape_prefixed_storage_object_row(row: dict[str, Any], *, prefix: str) -> dict[str, Any] | None:
    object_id = row.get(f"{prefix}_object_id")
    if object_id is None:
        return None
    return shape_storage_object_row(
        {
            "id": object_id,
            "bucket": row.get(f"{prefix}_bucket"),
            "object_key": row.get(f"{prefix}_object_key"),
            "content_type": row.get(f"{prefix}_content_type"),
            "original_filename": row.get(f"{prefix}_original_filename"),
            "size_bytes": row.get(f"{prefix}_size_bytes"),
            "sha256": row.get(f"{prefix}_sha256"),
            "etag": row.get(f"{prefix}_etag"),
        }
    )


def read_object_markdown(object_row: dict[str, Any] | None) -> str | None:
    return read_object_text(object_row)


def read_object_text(object_row: dict[str, Any] | None) -> str | None:
    if object_row is None:
        return None
    try:
        return download_object_bytes(
            SETTINGS.storage,
            bucket=object_row["bucket"],
            object_key=object_row["object_key"],
        ).decode("utf-8")
    except Exception:
        return None


def download_storage_object_response(object_row: dict[str, Any]) -> Response:
    file_bytes = download_object_bytes(
        SETTINGS.storage,
        bucket=object_row["bucket"],
        object_key=object_row["object_key"],
    )
    filename = object_row.get("original_filename") or object_row["object_key"].rsplit("/", 1)[-1]
    response = Response(
        content=file_bytes,
        media_type=object_row.get("content_type") or "application/octet-stream",
    )
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def get_public_problem_file_row(problem_slug: str, object_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                with public_problem as (
                  select id
                  from problem.problems
                  where
                    lower(slug) = lower(%s)
                    and is_active
                    and visibility_code = %s::text
                    and status_code = %s::text
                ),
                candidate_objects as (
                  select problems.statement_object_id as object_id
                  from problem.problems as problems
                  join public_problem on public_problem.id = problems.id
                  union
                  select assets.storage_object_id
                  from problem.problem_assets as assets
                  join public_problem on public_problem.id = assets.problem_id
                )
                select
                  objects.id::text as id,
                  objects.bucket,
                  objects.object_key,
                  objects.content_type,
                  objects.original_filename,
                  objects.size_bytes
                from candidate_objects
                join storage.objects as objects on objects.id = candidate_objects.object_id
                where objects.id = %s::uuid
                limit 1
                """,
                (
                    problem_slug,
                    PUBLIC_PROBLEM_VISIBILITY_CODE,
                    PUBLIC_PROBLEM_STATUS_CODE,
                    object_id,
                ),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def get_dashboard_problem_file_row(
    problem_id: str,
    object_id: str,
    actor: AuthContext,
) -> dict[str, Any] | None:
    local_user = ensure_local_actor(actor)
    reviewer = local_user_has_permission(local_user, PERM_PROBLEM_READ_REVIEW_QUEUE)
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select 1
                from problem.problems
                where
                  id = %s::uuid
                  and (%s::boolean = true or created_by_user_id = %s::uuid)
                """,
                (problem_id, reviewer, local_user["id"]),
            )
            if cursor.fetchone() is None:
                return None

            cursor.execute(
                """
                with candidate_objects as (
                  select problems.statement_object_id as object_id
                  from problem.problems as problems
                  where problems.id = %s::uuid
                  union
                  select assets.storage_object_id
                  from problem.problem_assets as assets
                  where assets.problem_id = %s::uuid
                  union
                  select testsets.archive_object_id
                  from problem.testsets as testsets
                  where testsets.problem_id = %s::uuid
                  union
                  select testcases.input_object_id
                  from problem.testsets as testsets
                  join problem.testcases as testcases on testcases.testset_id = testsets.id
                  where testsets.problem_id = %s::uuid
                  union
                  select testcases.expected_output_object_id
                  from problem.testsets as testsets
                  join problem.testcases as testcases on testcases.testset_id = testsets.id
                  where testsets.problem_id = %s::uuid
                  union
                  select checkers.source_object_id
                  from problem.checkers as checkers
                  where checkers.problem_id = %s::uuid
                  union
                  select checkers.compiled_object_id
                  from problem.checkers as checkers
                  where checkers.problem_id = %s::uuid
                )
                select
                  objects.id::text as id,
                  objects.bucket,
                  objects.object_key,
                  objects.content_type,
                  objects.original_filename,
                  objects.size_bytes
                from candidate_objects
                join storage.objects as objects on objects.id = candidate_objects.object_id
                where objects.id = %s::uuid
                limit 1
                """,
                (
                    problem_id,
                    problem_id,
                    problem_id,
                    problem_id,
                    problem_id,
                    problem_id,
                    problem_id,
                    object_id,
                ),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def problem_slug_exists(problem_slug: str) -> bool:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select 1 from problem.problems where lower(slug) = lower(%s)",
                (problem_slug,),
            )
            return cursor.fetchone() is not None


def runtime_profile_exists(profile_key: str) -> bool:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select 1
                from submission.runtimes
                where lower(profile_key) = lower(%s) and is_active
                """,
                (profile_key,),
            )
            return cursor.fetchone() is not None


def require_hex_sha256(value: Any, *, field_name: str) -> str:
    normalized = str(value or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", normalized):
        raise HTTPException(status_code=400, detail=f"{field_name} must be a 64-character SHA-256 hex string.")
    return normalized


def register_compiled_checker_artifact(checker_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    bucket = str(payload.get("bucket", "")).strip()
    object_key = str(payload.get("object_key", "")).strip()
    original_filename = normalize_optional_text(payload.get("original_filename"))
    content_type = normalize_optional_text(payload.get("content_type"))
    etag = normalize_optional_text(payload.get("etag"))
    object_id = normalize_optional_text(payload.get("id")) or str(uuid.uuid4())

    if not bucket:
        raise HTTPException(status_code=400, detail="bucket is required.")
    if not object_key:
        raise HTTPException(status_code=400, detail="object_key is required.")

    try:
        size_bytes = int(payload.get("size_bytes", 0) or 0)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="size_bytes must be a non-negative integer.") from exc
    if size_bytes < 0:
        raise HTTPException(status_code=400, detail="size_bytes must be a non-negative integer.")

    metadata_json = payload.get("metadata_json") or {}
    if not isinstance(metadata_json, dict):
        raise HTTPException(status_code=400, detail="metadata_json must be an object.")

    stored_object = StoredObject(
        id=object_id,
        bucket=bucket,
        object_key=object_key,
        content_type=content_type,
        original_filename=original_filename,
        size_bytes=size_bytes,
        sha256=require_hex_sha256(payload.get("sha256"), field_name="sha256"),
        etag=etag,
        metadata_json=metadata_json,
    )

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  checkers.id::text as id,
                  checkers.problem_id::text as problem_id,
                  checkers.compiled_object_id::text as compiled_object_id
                from problem.checkers as checkers
                where checkers.id = %s::uuid
                """,
                (checker_id,),
            )
            checker_row = cursor.fetchone()
            if checker_row is None:
                raise HTTPException(status_code=404, detail=f"Checker '{checker_id}' was not found.")

            object_row = upsert_storage_object_record(
                cursor,
                stored_object=stored_object,
                uploaded_by_user_id=None,
            )

            cursor.execute(
                """
                update problem.checkers
                set
                  compiled_object_id = %s::uuid,
                  updated_at = now()
                where id = %s::uuid
                """,
                (object_row["id"], checker_id),
            )
        connection.commit()

    invalidate_public_problem_cache(
        reason="checker-compiled-artifact",
        problem_id=checker_row["problem_id"],
    )
    return {
        "checker_id": checker_id,
        "problem_id": checker_row["problem_id"],
        "compiled_object": shape_storage_object_row(object_row),
    }


def list_problem_rows(
    *,
    search_query: str | None = None,
    difficulty: str | None = None,
    visibility: str | None = None,
    status: str | None = None,
    tag_slugs: list[str] | None = None,
    sort: str = "newest",
    public_only: bool = False,
) -> list[dict[str, Any]]:
    tag_filters = [tag_slug.strip().lower() for tag_slug in (tag_slugs or []) if tag_slug.strip()]
    search_pattern = f"%{search_query.strip()}%" if search_query and search_query.strip() else None
    sort_key = sort if sort in PROBLEM_LIST_SORT_CODES else "newest"

    if sort_key == "title":
        order_by = "lower(problems.title) asc, problems.created_at desc"
    elif sort_key == "acceptance":
        order_by = """
                case
                  when coalesce(stats.submissions_count, 0) = 0 then -1
                  else stats.accepted_count::float / nullif(stats.submissions_count, 0)
                end desc,
                coalesce(stats.submissions_count, 0) desc,
                lower(problems.title) asc
                """
    else:
        order_by = "problems.updated_at desc, problems.created_at desc"

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                select
                  problems.id::text as id,
                  problems.slug,
                  problems.title,
                  problems.summary_md,
                  problems.difficulty_code as difficulty,
                  problems.visibility_code as visibility,
                  problems.status_code as status,
                  problems.created_at,
                  coalesce(stats.submissions_count, 0) as submissions_count,
                  coalesce(stats.accepted_count, 0) as accepted_count,
                  coalesce(stats.unique_solvers_count, 0) as unique_solvers_count,
                  coalesce(problem_tags.tags, '[]'::jsonb) as tags
                from problem.problems as problems
                left join problem.problem_stats as stats on stats.problem_id = problems.id
                left join lateral (
                  select jsonb_agg(
                    jsonb_build_object(
                      'slug', tags.slug,
                      'name', tags.name,
                      'description', tags.description,
                      'color', tags.color
                    )
                    order by tags.name asc
                  ) as tags
                  from problem.problem_tags as problem_tags
                  join problem.tags as tags on tags.id = problem_tags.tag_id
                  where problem_tags.problem_id = problems.id
                ) as problem_tags on true
                  where
                    (%s::text is null or (
                      problems.slug ilike %s::text
                      or problems.title ilike %s::text
                      or coalesce(problems.summary_md, '') ilike %s::text
                    ))
                    and (
                      %s::boolean = false
                      or (
                        problems.is_active
                        and problems.visibility_code = %s::text
                        and problems.status_code = %s::text
                      )
                    )
                    and (%s::text is null or problems.difficulty_code = %s::text)
                    and (%s::boolean = true or %s::text is null or problems.visibility_code = %s::text)
                    and (%s::boolean = true or %s::text is null or problems.status_code = %s::text)
                  and (
                    %s::text[] is null
                    or exists (
                      select 1
                      from problem.problem_tags as selected_problem_tags
                      join problem.tags as selected_tags on selected_tags.id = selected_problem_tags.tag_id
                      where
                        selected_problem_tags.problem_id = problems.id
                        and lower(selected_tags.slug) = any(%s::text[])
                    )
                  )
                order by {order_by}
                """,
                    (
                        search_pattern,
                        search_pattern,
                        search_pattern,
                        search_pattern,
                        public_only,
                        PUBLIC_PROBLEM_VISIBILITY_CODE,
                        PUBLIC_PROBLEM_STATUS_CODE,
                        difficulty,
                        difficulty,
                        public_only,
                        visibility,
                        visibility,
                        public_only,
                        status,
                        status,
                        tag_filters or None,
                    tag_filters or None,
                ),
            )
            rows = list(cursor.fetchall())
            for row in rows:
                row["tags"] = row.get("tags") or []
            return rows


def list_dashboard_problem_rows(
    local_user: dict[str, Any],
    owner_user_id: str,
    *,
    scope: str = "mine",
) -> list[dict[str, Any]]:
    normalized_scope = normalize_dashboard_scope(scope)
    review_scope = normalized_scope == "review"
    if review_scope:
        require_local_permission(
            local_user,
            PERM_PROBLEM_READ_REVIEW_QUEUE,
            detail="Reviewer permissions are required for the review queue.",
        )
    else:
        require_local_permission(
            local_user,
            PERM_PROBLEM_READ_OWN_DASHBOARD,
            detail="Author permissions are required for problem authoring views.",
        )

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  problems.id::text as id,
                  problems.slug,
                  problems.title,
                  problems.difficulty_code as difficulty,
                  problems.visibility_code as visibility,
                  problems.status_code as status,
                  problems.created_at,
                  problems.updated_at,
                  (problems.created_by_user_id = %s::uuid) as authored_by_me,
                  coalesce(testsets.active_testset_count, 0) as active_testset_count,
                  checker.checker_type_code as active_checker_type_code
                from problem.problems as problems
                left join lateral (
                  select count(*)::int as active_testset_count
                  from problem.testsets
                  where problem_id = problems.id and is_active
                ) as testsets on true
                left join lateral (
                  select checker_type_code
                  from problem.checkers
                  where problem_id = problems.id and is_active
                  order by created_at desc
                  limit 1
                  ) as checker on true
                  where
                    (
                      (%s::boolean = false and problems.created_by_user_id = %s::uuid)
                      or
                      (%s::boolean = true and problems.status_code = 'pending_review')
                    )
                  order by
                    case when %s::boolean = true then problems.created_at end asc,
                    problems.updated_at desc,
                    problems.created_at desc
                  """,
                  (
                      owner_user_id,
                      review_scope,
                      owner_user_id,
                      review_scope,
                      review_scope,
                  ),
            )
            return list(cursor.fetchall())


def get_problem_row(problem_slug: str, *, public_only: bool = False) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                  select
                    id::text as id,
                    slug,
                  title,
                  summary_md,
                  statement_source_code as statement_source,
                  statement_md,
                  statement_object_id::text as statement_object_id,
                  difficulty_code as difficulty,
                  type_code,
                  visibility_code as visibility,
                  scoring_code,
                  status_code as status,
                    time_limit_ms,
                    memory_limit_kb,
                    output_limit_kb
                  from problem.problems
                  where
                    lower(slug) = lower(%s)
                    and (
                      %s::boolean = false
                      or (
                        is_active
                        and visibility_code = %s::text
                        and status_code = %s::text
                      )
                    )
                  """,
                  (
                      problem_slug,
                      public_only,
                      PUBLIC_PROBLEM_VISIBILITY_CODE,
                      PUBLIC_PROBLEM_STATUS_CODE,
                  ),
              )
            problem_row = cursor.fetchone()
            if problem_row is None:
                return None

            statement_object_row: dict[str, Any] | None = None
            if problem_row["statement_object_id"] is not None:
                cursor.execute(
                    """
                    select
                      id::text as id,
                      bucket,
                      object_key,
                      content_type,
                      original_filename,
                      size_bytes,
                      sha256,
                      etag
                    from storage.objects
                    where id = %s::uuid
                    """,
                    (problem_row["statement_object_id"],),
                )
                statement_object_row = cursor.fetchone()

            cursor.execute(
                """
                select tags.slug, tags.name, tags.description, tags.color
                from problem.problem_tags as problem_tags
                join problem.tags as tags on tags.id = problem_tags.tag_id
                where problem_tags.problem_id = %s::uuid
                order by tags.name asc
                """,
                (problem_row["id"],),
            )
            tags = list(cursor.fetchall())

            cursor.execute(
                """
                select
                  assets.id::text as id,
                  assets.asset_role_code,
                  assets.logical_name,
                  assets.sort_order,
                  objects.id::text as object_id,
                  objects.bucket,
                  objects.object_key,
                  objects.content_type,
                  objects.original_filename,
                  objects.size_bytes,
                  objects.sha256,
                  objects.etag
                from problem.problem_assets as assets
                join storage.objects as objects on objects.id = assets.storage_object_id
                where assets.problem_id = %s::uuid
                order by assets.sort_order asc, assets.created_at asc
                """,
                (problem_row["id"],),
            )
            statement_assets = [
                {
                    "id": row["id"],
                    "asset_role_code": row["asset_role_code"],
                    "logical_name": row["logical_name"],
                    "sort_order": row["sort_order"],
                    "object": shape_storage_object_row(
                        {
                            "id": row["object_id"],
                            "bucket": row["bucket"],
                            "object_key": row["object_key"],
                            "content_type": row["content_type"],
                            "original_filename": row["original_filename"],
                            "size_bytes": row["size_bytes"],
                            "sha256": row["sha256"],
                            "etag": row["etag"],
                        }
                    ),
                }
                for row in cursor.fetchall()
            ]

            cursor.execute(
                """
                select
                  testsets.id::text as id,
                  testsets.testset_type_code,
                  testsets.title,
                  testsets.note,
                  testsets.extracted_case_count,
                  archives.id::text as archive_object_id,
                  archives.bucket as archive_bucket,
                  archives.object_key as archive_object_key,
                  archives.content_type as archive_content_type,
                  archives.original_filename as archive_original_filename,
                  archives.size_bytes as archive_size_bytes,
                  archives.sha256 as archive_sha256,
                  archives.etag as archive_etag
                from problem.testsets as testsets
                left join storage.objects as archives on archives.id = testsets.archive_object_id
                where testsets.problem_id = %s::uuid and testsets.is_active
                order by testsets.created_at asc
                """,
                (problem_row["id"],),
            )
            testsets = [
                {
                    "id": row["id"],
                    "testset_type_code": row["testset_type_code"],
                    "title": row["title"],
                    "note": row["note"],
                    "extracted_case_count": row["extracted_case_count"],
                    "archive_object": shape_storage_object_row(
                        None
                        if row["archive_object_id"] is None
                        else {
                            "id": row["archive_object_id"],
                            "bucket": row["archive_bucket"],
                            "object_key": row["archive_object_key"],
                            "content_type": row["archive_content_type"],
                            "original_filename": row["archive_original_filename"],
                            "size_bytes": row["archive_size_bytes"],
                            "sha256": row["archive_sha256"],
                            "etag": row["archive_etag"],
                        }
                    ),
                }
                for row in cursor.fetchall()
            ]

            cursor.execute(
                """
                select
                  checkers.id::text as id,
                  checkers.checker_type_code,
                  checkers.runtime_profile_key,
                  checkers.entrypoint,
                  checkers.note,
                  sources.id::text as source_object_id,
                  sources.bucket as source_bucket,
                  sources.object_key as source_object_key,
                  sources.content_type as source_content_type,
                  sources.original_filename as source_original_filename,
                  sources.size_bytes as source_size_bytes,
                  sources.sha256 as source_sha256,
                  sources.etag as source_etag,
                  compiled.id::text as compiled_object_id,
                  compiled.bucket as compiled_bucket,
                  compiled.object_key as compiled_object_key,
                  compiled.content_type as compiled_content_type,
                  compiled.original_filename as compiled_original_filename,
                  compiled.size_bytes as compiled_size_bytes,
                  compiled.sha256 as compiled_sha256,
                  compiled.etag as compiled_etag
                from problem.checkers as checkers
                left join storage.objects as sources on sources.id = checkers.source_object_id
                left join storage.objects as compiled on compiled.id = checkers.compiled_object_id
                where checkers.problem_id = %s::uuid and checkers.is_active
                order by checkers.created_at desc
                limit 1
                """,
                (problem_row["id"],),
            )
            checker_row = cursor.fetchone()

    statement_md = problem_row["statement_md"]
    if statement_md is None and problem_row["statement_source"] == "object_md":
        statement_md = read_object_markdown(statement_object_row)

    return {
        "id": problem_row["id"],
        "slug": problem_row["slug"],
        "title": problem_row["title"],
        "summary_md": problem_row["summary_md"],
        "statement_source": problem_row["statement_source"],
        "statement_md": statement_md,
        "statement_object": shape_storage_object_row(statement_object_row),
        "difficulty": problem_row["difficulty"],
        "type_code": problem_row["type_code"],
        "visibility": problem_row["visibility"],
        "scoring_code": problem_row["scoring_code"],
        "status": problem_row["status"],
        "time_limit_ms": problem_row["time_limit_ms"],
        "memory_limit_kb": problem_row["memory_limit_kb"],
        "output_limit_kb": problem_row["output_limit_kb"],
        "tags": tags,
        "statement_assets": statement_assets,
        "testsets": testsets,
        "active_checker": None
        if checker_row is None
        else {
            "id": checker_row["id"],
            "checker_type_code": checker_row["checker_type_code"],
            "runtime_profile_key": checker_row["runtime_profile_key"],
            "entrypoint": checker_row["entrypoint"],
            "note": checker_row["note"],
            "source_object": shape_prefixed_storage_object_row(checker_row, prefix="source"),
            "compiled_object": shape_prefixed_storage_object_row(checker_row, prefix="compiled"),
        },
    }


def resolve_testcase_text(
    inline_text: str | None,
    object_row: dict[str, Any] | None,
) -> str | None:
    if inline_text is not None:
        return inline_text
    return read_object_text(object_row)


def get_problem_solve_samples(problem_id: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  testsets.id::text as id,
                  testsets.testset_type_code,
                  testsets.title,
                  testsets.note,
                  testsets.extracted_case_count
                from problem.testsets as testsets
                where
                  testsets.problem_id = %s::uuid
                  and testsets.is_active
                  and exists (
                    select 1
                    from problem.testcases as testcases
                    where testcases.testset_id = testsets.id and testcases.is_sample
                  )
                order by
                  case testsets.testset_type_code
                    when 'samples' then 0
                    when 'primary' then 1
                    when 'hidden' then 2
                    else 3
                  end,
                  testsets.created_at asc
                limit 1
                """,
                (problem_id,),
            )
            run_testset = cursor.fetchone()
            if run_testset is None:
                return None, []

            cursor.execute(
                """
                select
                  testcases.id::text as id,
                  testcases.ordinal,
                  testcases.note,
                  testcases.input_text,
                  testcases.expected_output_text,
                  inputs.id::text as input_object_id,
                  inputs.bucket as input_bucket,
                  inputs.object_key as input_object_key,
                  inputs.content_type as input_content_type,
                  inputs.original_filename as input_original_filename,
                  inputs.size_bytes as input_size_bytes,
                  inputs.sha256 as input_sha256,
                  inputs.etag as input_etag,
                  outputs.id::text as output_object_id,
                  outputs.bucket as output_bucket,
                  outputs.object_key as output_object_key,
                  outputs.content_type as output_content_type,
                  outputs.original_filename as output_original_filename,
                  outputs.size_bytes as output_size_bytes,
                  outputs.sha256 as output_sha256,
                  outputs.etag as output_etag
                from problem.testcases as testcases
                left join storage.objects as inputs on inputs.id = testcases.input_object_id
                left join storage.objects as outputs on outputs.id = testcases.expected_output_object_id
                where testcases.testset_id = %s::uuid and testcases.is_sample
                order by testcases.ordinal asc
                """,
                (run_testset["id"],),
            )
            testcase_rows = list(cursor.fetchall())

    sample_testcases = []
    for row in testcase_rows:
        input_object = shape_storage_object_row(
            None
            if row["input_object_id"] is None
            else {
                "id": row["input_object_id"],
                "bucket": row["input_bucket"],
                "object_key": row["input_object_key"],
                "content_type": row["input_content_type"],
                "original_filename": row["input_original_filename"],
                "size_bytes": row["input_size_bytes"],
                "sha256": row["input_sha256"],
                "etag": row["input_etag"],
            }
        )
        output_object = shape_storage_object_row(
            None
            if row["output_object_id"] is None
            else {
                "id": row["output_object_id"],
                "bucket": row["output_bucket"],
                "object_key": row["output_object_key"],
                "content_type": row["output_content_type"],
                "original_filename": row["output_original_filename"],
                "size_bytes": row["output_size_bytes"],
                "sha256": row["output_sha256"],
                "etag": row["output_etag"],
            }
        )
        sample_testcases.append(
            {
                "id": row["id"],
                "ordinal": row["ordinal"],
                "note": row["note"],
                "input_text": resolve_testcase_text(row["input_text"], input_object),
                "expected_output_text": resolve_testcase_text(
                    row["expected_output_text"],
                    output_object,
                ),
            }
        )

    return (
        {
            "id": run_testset["id"],
            "testset_type_code": run_testset["testset_type_code"],
            "title": run_testset["title"],
            "note": run_testset["note"],
            "extracted_case_count": run_testset["extracted_case_count"],
        },
        sample_testcases,
    )


def get_problem_solve_row(problem_slug: str) -> dict[str, Any] | None:
    problem = get_problem_row(problem_slug, public_only=True)
    if problem is None:
        return None

    run_testset, sample_testcases = get_problem_solve_samples(problem["id"])
    return {
        **problem,
        "run_testset": run_testset,
        "sample_testcases": sample_testcases,
    }


def get_dashboard_problem_row(problem_id: str, owner_user_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  id::text as id,
                  slug,
                  created_at,
                  updated_at
                from problem.problems
                where id = %s::uuid and created_by_user_id = %s::uuid
                """,
                (problem_id, owner_user_id),
            )
            owned_problem = cursor.fetchone()
            if owned_problem is None:
                return None

            cursor.execute(
                """
                select
                  testsets.id::text as testset_id,
                  testcases.id::text as id,
                  testcases.ordinal,
                  testcases.weight,
                  testcases.is_sample,
                  testcases.note,
                  testcases.input_text,
                  testcases.expected_output_text,
                  inputs.id::text as input_object_id,
                  inputs.bucket as input_bucket,
                  inputs.object_key as input_object_key,
                  inputs.content_type as input_content_type,
                  inputs.original_filename as input_original_filename,
                  inputs.size_bytes as input_size_bytes,
                  inputs.sha256 as input_sha256,
                  inputs.etag as input_etag,
                  outputs.id::text as output_object_id,
                  outputs.bucket as output_bucket,
                  outputs.object_key as output_object_key,
                  outputs.content_type as output_content_type,
                  outputs.original_filename as output_original_filename,
                  outputs.size_bytes as output_size_bytes,
                  outputs.sha256 as output_sha256,
                  outputs.etag as output_etag
                from problem.testsets as testsets
                join problem.testcases as testcases on testcases.testset_id = testsets.id
                left join storage.objects as inputs on inputs.id = testcases.input_object_id
                left join storage.objects as outputs on outputs.id = testcases.expected_output_object_id
                where testsets.problem_id = %s::uuid and testsets.is_active
                order by testsets.created_at asc, testcases.ordinal asc
                """,
                (problem_id,),
            )
            testcase_rows = list(cursor.fetchall())

    problem = get_problem_row(owned_problem["slug"])
    if problem is None:
        return None

    testcase_map: dict[str, list[dict[str, Any]]] = {}
    for row in testcase_rows:
        testcase_map.setdefault(row["testset_id"], []).append(
            {
                "id": row["id"],
                "ordinal": row["ordinal"],
                "weight": row["weight"],
                "is_sample": row["is_sample"],
                "note": row["note"],
                "input_text": row["input_text"],
                "expected_output_text": row["expected_output_text"],
                "input_object": shape_storage_object_row(
                    None
                    if row["input_object_id"] is None
                    else {
                        "id": row["input_object_id"],
                        "bucket": row["input_bucket"],
                        "object_key": row["input_object_key"],
                        "content_type": row["input_content_type"],
                        "original_filename": row["input_original_filename"],
                        "size_bytes": row["input_size_bytes"],
                        "sha256": row["input_sha256"],
                        "etag": row["input_etag"],
                    }
                ),
                "expected_output_object": shape_storage_object_row(
                    None
                    if row["output_object_id"] is None
                    else {
                        "id": row["output_object_id"],
                        "bucket": row["output_bucket"],
                        "object_key": row["output_object_key"],
                        "content_type": row["output_content_type"],
                        "original_filename": row["output_original_filename"],
                        "size_bytes": row["output_size_bytes"],
                        "sha256": row["output_sha256"],
                        "etag": row["output_etag"],
                    }
                ),
            }
        )

    return {
        **problem,
        "created_at": owned_problem["created_at"],
        "updated_at": owned_problem["updated_at"],
        "authored_by_me": True,
        "testsets": [
            {
                **testset,
                "testcases": testcase_map.get(testset["id"], []),
            }
            for testset in problem["testsets"]
        ],
    }


def transition_problem_lifecycle(problem_id: str, action: str, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    normalized_action = str(action).strip().lower()
    if normalized_action not in {"request-review", "approve", "reject", "publish", "unpublish", "archive"}:
        raise HTTPException(status_code=400, detail="Unsupported lifecycle action.")

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  id::text as id,
                  slug,
                  title,
                  visibility_code,
                  status_code,
                  created_by_user_id::text as created_by_user_id
                from problem.problems
                where id = %s::uuid
                """,
                (problem_id,),
            )
            problem_row = cursor.fetchone()
            if problem_row is None:
                raise HTTPException(status_code=404, detail=f"Problem '{problem_id}' was not found.")

            is_owner = problem_row["created_by_user_id"] == local_user["id"]
            can_review = local_user_has_permission(local_user, PERM_PROBLEM_REVIEW)
            can_publish = local_user_has_permission(local_user, PERM_PROBLEM_PUBLISH)
            can_unpublish = local_user_has_permission(local_user, PERM_PROBLEM_UNPUBLISH)
            can_archive_any = local_user_has_permission(local_user, PERM_PROBLEM_ARCHIVE_ANY)
            if not is_owner and not can_review and not can_publish and not can_unpublish and not can_archive_any:
                raise HTTPException(status_code=403, detail="You do not have access to modify this problem lifecycle.")

            current_status = str(problem_row["status_code"])
            updated_row: dict[str, Any] | None = None

            if normalized_action == "request-review":
                if not is_owner:
                    raise HTTPException(status_code=403, detail="Only the author can request review.")
                require_local_permission(
                    local_user,
                    PERM_PROBLEM_REQUEST_REVIEW_OWN,
                    detail="Author permissions are required to request review.",
                )
                if current_status not in {"draft", "rejected"}:
                    raise HTTPException(status_code=409, detail="Only draft or rejected problems can be submitted for review.")
                cursor.execute(
                    """
                    update problem.problems
                    set
                      visibility_code = 'private',
                      status_code = 'pending_review',
                      updated_by_user_id = %s::uuid,
                      updated_at = now(),
                      reviewed_by_user_id = null,
                      reviewed_at = null
                    where id = %s::uuid
                    returning id::text as id, slug, title, visibility_code as visibility, status_code as status
                    """,
                    (local_user["id"], problem_id),
                )
                updated_row = cursor.fetchone()
            elif normalized_action == "approve":
                if not can_review:
                    raise HTTPException(status_code=403, detail="Reviewer permissions are required to approve problems.")
                if current_status != "pending_review":
                    raise HTTPException(status_code=409, detail="Only pending-review problems can be approved.")
                cursor.execute(
                    """
                    update problem.problems
                    set
                      visibility_code = 'private',
                      status_code = 'approved',
                      updated_by_user_id = %s::uuid,
                      updated_at = now(),
                      reviewed_by_user_id = %s::uuid,
                      reviewed_at = now()
                    where id = %s::uuid
                    returning id::text as id, slug, title, visibility_code as visibility, status_code as status
                    """,
                    (local_user["id"], local_user["id"], problem_id),
                )
                updated_row = cursor.fetchone()
            elif normalized_action == "reject":
                if not can_review:
                    raise HTTPException(status_code=403, detail="Reviewer permissions are required to reject problems.")
                if current_status != "pending_review":
                    raise HTTPException(status_code=409, detail="Only pending-review problems can be rejected.")
                cursor.execute(
                    """
                    update problem.problems
                    set
                      visibility_code = 'private',
                      status_code = 'rejected',
                      updated_by_user_id = %s::uuid,
                      updated_at = now(),
                      reviewed_by_user_id = %s::uuid,
                      reviewed_at = now()
                    where id = %s::uuid
                    returning id::text as id, slug, title, visibility_code as visibility, status_code as status
                    """,
                    (local_user["id"], local_user["id"], problem_id),
                )
                updated_row = cursor.fetchone()
            elif normalized_action == "publish":
                if not can_publish:
                    raise HTTPException(status_code=403, detail="Reviewer permissions are required to publish problems.")
                if current_status != "approved":
                    raise HTTPException(status_code=409, detail="Only approved problems can be published.")
                cursor.execute(
                    """
                    update problem.problems
                    set
                      visibility_code = 'public',
                      status_code = 'published',
                      updated_by_user_id = %s::uuid,
                      updated_at = now(),
                      reviewed_by_user_id = coalesce(reviewed_by_user_id, %s::uuid),
                      reviewed_at = coalesce(reviewed_at, now()),
                      published_by_user_id = coalesce(published_by_user_id, %s::uuid),
                      published_at = coalesce(published_at, now())
                    where id = %s::uuid
                    returning id::text as id, slug, title, visibility_code as visibility, status_code as status
                    """,
                    (local_user["id"], local_user["id"], local_user["id"], problem_id),
                )
                updated_row = cursor.fetchone()
            elif normalized_action == "unpublish":
                if not can_unpublish:
                    raise HTTPException(status_code=403, detail="Reviewer permissions are required to unpublish problems.")
                if current_status != "published":
                    raise HTTPException(status_code=409, detail="Only published problems can be unpublished.")
                cursor.execute(
                    """
                    update problem.problems
                    set
                      visibility_code = 'private',
                      status_code = 'approved',
                      updated_by_user_id = %s::uuid,
                      updated_at = now()
                    where id = %s::uuid
                    returning id::text as id, slug, title, visibility_code as visibility, status_code as status
                    """,
                    (local_user["id"], problem_id),
                )
                updated_row = cursor.fetchone()
            elif normalized_action == "archive":
                if current_status == "archived":
                    raise HTTPException(status_code=409, detail="This problem is already archived.")
                if is_owner:
                    require_local_permission(
                        local_user,
                        PERM_PROBLEM_ARCHIVE_OWN,
                        detail="Author permissions are required to archive owned problems.",
                    )
                elif not can_archive_any:
                    raise HTTPException(status_code=403, detail="Reviewer permissions are required to archive problems.")
                cursor.execute(
                    """
                    update problem.problems
                    set
                      visibility_code = 'private',
                      status_code = 'archived',
                      updated_by_user_id = %s::uuid,
                      updated_at = now()
                    where id = %s::uuid
                    returning id::text as id, slug, title, visibility_code as visibility, status_code as status
                    """,
                    (local_user["id"], problem_id),
                )
                updated_row = cursor.fetchone()

        connection.commit()

    if updated_row is None:
        raise RuntimeError("Problem lifecycle transition did not return an updated row.")

    invalidate_public_problem_cache(
        reason=f"lifecycle:{normalized_action}",
        problem_id=problem_id,
        problem_slug=updated_row["slug"],
    )
    return dict(updated_row)


def get_problem_judge_context(
    problem_id: str,
    *,
    requested_testset_id: str | None = None,
    samples_only: bool = False,
) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  id::text as id,
                  slug,
                  title,
                  time_limit_ms,
                  memory_limit_kb,
                  output_limit_kb
                from problem.problems
                where id = %s::uuid
                """,
                (problem_id,),
            )
            problem_row = cursor.fetchone()
            if problem_row is None:
                return None

            if requested_testset_id is not None:
                cursor.execute(
                    """
                    select
                      testsets.id::text as id,
                      testsets.testset_type_code,
                      testsets.title,
                      testsets.note,
                      testsets.extracted_case_count
                    from problem.testsets as testsets
                    where
                      testsets.problem_id = %s::uuid
                      and testsets.id = %s::uuid
                      and testsets.is_active
                    limit 1
                    """,
                    (problem_id, requested_testset_id),
                )
            else:
                cursor.execute(
                    """
                    select
                      testsets.id::text as id,
                      testsets.testset_type_code,
                      testsets.title,
                      testsets.note,
                      testsets.extracted_case_count
                    from problem.testsets as testsets
                    where testsets.problem_id = %s::uuid and testsets.is_active
                    order by
                      case testsets.testset_type_code
                        when 'primary' then 0
                        when 'hidden' then 1
                        when 'samples' then 2
                        else 3
                      end,
                      testsets.created_at asc
                    limit 1
                    """,
                    (problem_id,),
                )
            testset_row = cursor.fetchone()
            if requested_testset_id is not None and testset_row is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Testset '{requested_testset_id}' was not found for problem '{problem_id}'.",
                )

            checker_row: dict[str, Any] | None = None
            if testset_row is not None:
                cursor.execute(
                    """
                    select
                      checkers.id::text as id,
                      checkers.testset_id::text as testset_id,
                      checkers.checker_type_code,
                      checkers.runtime_profile_key,
                      checkers.entrypoint,
                      checkers.note,
                      sources.id::text as source_object_id,
                      sources.bucket as source_bucket,
                      sources.object_key as source_object_key,
                      sources.content_type as source_content_type,
                      sources.original_filename as source_original_filename,
                      sources.size_bytes as source_size_bytes,
                      sources.sha256 as source_sha256,
                      sources.etag as source_etag,
                      compiled.id::text as compiled_object_id,
                      compiled.bucket as compiled_bucket,
                      compiled.object_key as compiled_object_key,
                      compiled.content_type as compiled_content_type,
                      compiled.original_filename as compiled_original_filename,
                      compiled.size_bytes as compiled_size_bytes,
                      compiled.sha256 as compiled_sha256,
                      compiled.etag as compiled_etag
                    from problem.checkers as checkers
                    left join storage.objects as sources on sources.id = checkers.source_object_id
                    left join storage.objects as compiled on compiled.id = checkers.compiled_object_id
                    where
                      checkers.problem_id = %s::uuid
                      and checkers.is_active
                      and (checkers.testset_id is null or checkers.testset_id = %s::uuid)
                    order by
                      case when checkers.testset_id = %s::uuid then 0 else 1 end,
                      checkers.created_at desc
                    limit 1
                    """,
                    (problem_id, testset_row["id"], testset_row["id"]),
                )
                checker_row = cursor.fetchone()

                testcase_query = """
                    select
                      testcases.id::text as id,
                      testcases.ordinal,
                      testcases.weight,
                      testcases.is_sample,
                      testcases.input_text,
                      testcases.expected_output_text,
                      testcases.note,
                      inputs.id::text as input_object_id,
                      inputs.bucket as input_bucket,
                      inputs.object_key as input_object_key,
                      inputs.content_type as input_content_type,
                      inputs.original_filename as input_original_filename,
                      inputs.size_bytes as input_size_bytes,
                      inputs.sha256 as input_sha256,
                      inputs.etag as input_etag,
                      outputs.id::text as output_object_id,
                      outputs.bucket as output_bucket,
                      outputs.object_key as output_object_key,
                      outputs.content_type as output_content_type,
                      outputs.original_filename as output_original_filename,
                      outputs.size_bytes as output_size_bytes,
                      outputs.sha256 as output_sha256,
                      outputs.etag as output_etag
                    from problem.testcases as testcases
                    left join storage.objects as inputs on inputs.id = testcases.input_object_id
                    left join storage.objects as outputs on outputs.id = testcases.expected_output_object_id
                    where testcases.testset_id = %s::uuid
                """
                testcase_params: tuple[Any, ...] = (testset_row["id"],)
                if samples_only:
                    testcase_query += " and testcases.is_sample"
                testcase_query += " order by testcases.ordinal asc"
                cursor.execute(
                    testcase_query,
                    testcase_params,
                )
                testcase_rows = list(cursor.fetchall())
            else:
                testcase_rows = []

    return {
        "problem": {
            "id": problem_row["id"],
            "slug": problem_row["slug"],
            "title": problem_row["title"],
            "time_limit_ms": problem_row["time_limit_ms"],
            "memory_limit_kb": problem_row["memory_limit_kb"],
            "output_limit_kb": problem_row["output_limit_kb"],
        },
        "selected_testset": None
        if testset_row is None
        else {
            "id": testset_row["id"],
            "testset_type_code": testset_row["testset_type_code"],
            "title": testset_row["title"],
            "note": testset_row["note"],
            "extracted_case_count": testset_row["extracted_case_count"],
        },
        "active_checker": None
        if checker_row is None
        else {
            "id": checker_row["id"],
            "testset_id": checker_row["testset_id"],
            "checker_type_code": checker_row["checker_type_code"],
            "runtime_profile_key": checker_row["runtime_profile_key"],
            "entrypoint": checker_row["entrypoint"],
            "note": checker_row["note"],
            "source_object": shape_prefixed_storage_object_row(checker_row, prefix="source"),
            "compiled_object": shape_prefixed_storage_object_row(checker_row, prefix="compiled"),
        },
        "testcases": [
            {
                "id": row["id"],
                "ordinal": row["ordinal"],
                "weight": row["weight"],
                "is_sample": row["is_sample"],
                "note": row["note"],
                "input_text": row["input_text"],
                "expected_output_text": row["expected_output_text"],
                "input_object": shape_storage_object_row(
                    None
                    if row["input_object_id"] is None
                    else {
                        "id": row["input_object_id"],
                        "bucket": row["input_bucket"],
                        "object_key": row["input_object_key"],
                        "content_type": row["input_content_type"],
                        "original_filename": row["input_original_filename"],
                        "size_bytes": row["input_size_bytes"],
                        "sha256": row["input_sha256"],
                        "etag": row["input_etag"],
                    }
                ),
                "expected_output_object": shape_storage_object_row(
                    None
                    if row["output_object_id"] is None
                    else {
                        "id": row["output_object_id"],
                        "bucket": row["output_bucket"],
                        "object_key": row["output_object_key"],
                        "content_type": row["output_content_type"],
                        "original_filename": row["output_original_filename"],
                        "size_bytes": row["output_size_bytes"],
                        "sha256": row["output_sha256"],
                        "etag": row["output_etag"],
                    }
                ),
            }
            for row in testcase_rows
        ],
    }


def list_tag_rows() -> list[dict[str, Any]]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select slug, name, description, color, icon
                from problem.tags
                where is_active
                order by name asc
                """
            )
            return list(cursor.fetchall())


def list_dashboard_tag_rows() -> list[dict[str, Any]]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  tags.id::text as id,
                  tags.slug,
                  tags.name,
                  tags.description,
                  tags.color,
                  tags.icon,
                  tags.is_active,
                  tags.created_at,
                  tags.updated_at,
                  coalesce(problem_counts.problem_count, 0) as problem_count
                from problem.tags as tags
                left join lateral (
                  select count(*)::int as problem_count
                  from problem.problem_tags
                  where tag_id = tags.id
                ) as problem_counts on true
                order by tags.is_active desc, lower(tags.name) asc
                """
            )
            return list(cursor.fetchall())


def get_dashboard_tag_row(tag_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  tags.id::text as id,
                  tags.slug,
                  tags.name,
                  tags.description,
                  tags.color,
                  tags.icon,
                  tags.is_active,
                  tags.created_at,
                  tags.updated_at,
                  coalesce(problem_counts.problem_count, 0) as problem_count
                from problem.tags as tags
                left join lateral (
                  select count(*)::int as problem_count
                  from problem.problem_tags
                  where tag_id = tags.id
                ) as problem_counts on true
                where tags.id = %s::uuid
                """,
                (tag_id,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def create_tag_row(payload: dict[str, Any], actor: AuthContext) -> dict[str, Any]:
    normalized_payload = parse_tag_write_payload(payload)
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TAG_CREATE,
        detail="Reviewer permissions are required to create tags.",
    )

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select 1
                from problem.tags
                where lower(slug) = lower(%s)
                """,
                (normalized_payload["slug"],),
            )
            if cursor.fetchone() is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Tag slug '{normalized_payload['slug']}' already exists.",
                )

            cursor.execute(
                """
                select 1
                from problem.tags
                where lower(name) = lower(%s)
                """,
                (normalized_payload["name"],),
            )
            if cursor.fetchone() is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Tag name '{normalized_payload['name']}' already exists.",
                )

            cursor.execute(
                """
                insert into problem.tags (
                  slug,
                  name,
                  description,
                  color,
                  icon,
                  is_active,
                  created_by_user_id,
                  updated_by_user_id
                )
                values (%s, %s, %s, %s, %s, %s, %s::uuid, %s::uuid)
                returning id::text as id
                """,
                (
                    normalized_payload["slug"],
                    normalized_payload["name"],
                    normalized_payload["description"],
                    normalized_payload["color"],
                    normalized_payload["icon"],
                    normalized_payload["is_active"],
                    local_user["id"],
                    local_user["id"],
                ),
            )
            created_row = cursor.fetchone()
        connection.commit()

    if created_row is None:
        raise RuntimeError("Tag create did not return a row.")

    tag = get_dashboard_tag_row(created_row["id"])
    if tag is None:
        raise RuntimeError("Created tag could not be loaded.")
    invalidate_public_problem_cache(reason="tag-create")
    return tag


def update_tag_row(tag_id: str, payload: dict[str, Any], actor: AuthContext) -> dict[str, Any]:
    normalized_payload = parse_tag_write_payload(payload)
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TAG_UPDATE,
        detail="Reviewer permissions are required to update tags.",
    )

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select id::text as id
                from problem.tags
                where id = %s::uuid
                """,
                (tag_id,),
            )
            existing_row = cursor.fetchone()
            if existing_row is None:
                raise HTTPException(status_code=404, detail=f"Tag '{tag_id}' was not found.")

            cursor.execute(
                """
                select 1
                from problem.tags
                where lower(slug) = lower(%s) and id <> %s::uuid
                """,
                (normalized_payload["slug"], tag_id),
            )
            if cursor.fetchone() is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Tag slug '{normalized_payload['slug']}' already exists.",
                )

            cursor.execute(
                """
                select 1
                from problem.tags
                where lower(name) = lower(%s) and id <> %s::uuid
                """,
                (normalized_payload["name"], tag_id),
            )
            if cursor.fetchone() is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Tag name '{normalized_payload['name']}' already exists.",
                )

            cursor.execute(
                """
                update problem.tags
                set
                  slug = %s,
                  name = %s,
                  description = %s,
                  color = %s,
                  icon = %s,
                  is_active = %s,
                  updated_by_user_id = %s::uuid,
                  updated_at = now()
                where id = %s::uuid
                """,
                (
                    normalized_payload["slug"],
                    normalized_payload["name"],
                    normalized_payload["description"],
                    normalized_payload["color"],
                    normalized_payload["icon"],
                    normalized_payload["is_active"],
                    local_user["id"],
                    tag_id,
                ),
            )
        connection.commit()

    tag = get_dashboard_tag_row(tag_id)
    if tag is None:
        raise RuntimeError("Updated tag could not be loaded.")
    invalidate_public_problem_cache(reason="tag-update")
    return tag


def transition_tag_row(tag_id: str, action: str, actor: AuthContext) -> dict[str, Any]:
    normalized_action = str(action or "").strip().lower()
    if normalized_action not in {"activate", "deactivate"}:
        raise HTTPException(status_code=400, detail="Unsupported tag action.")

    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TAG_LIFECYCLE,
        detail="Reviewer permissions are required for tag actions.",
    )
    is_active = normalized_action == "activate"
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update problem.tags
                set
                  is_active = %s,
                  updated_by_user_id = %s::uuid,
                  updated_at = now()
                where id = %s::uuid
                """,
                (is_active, local_user["id"], tag_id),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail=f"Tag '{tag_id}' was not found.")
        connection.commit()

    tag = get_dashboard_tag_row(tag_id)
    if tag is None:
        raise RuntimeError("Updated tag could not be loaded after lifecycle action.")
    invalidate_public_problem_cache(reason=f"tag:{normalized_action}")
    return tag


def delete_tag_row(tag_id: str, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TAG_DELETE,
        detail="Reviewer permissions are required to delete tags.",
    )
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  tags.id::text as id,
                  tags.slug,
                  coalesce(problem_counts.problem_count, 0) as problem_count
                from problem.tags as tags
                left join lateral (
                  select count(*)::int as problem_count
                  from problem.problem_tags
                  where tag_id = tags.id
                ) as problem_counts on true
                where tags.id = %s::uuid
                """,
                (tag_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail=f"Tag '{tag_id}' was not found.")
            if row["problem_count"] > 0:
                raise HTTPException(
                    status_code=409,
                    detail="Tags linked to problems cannot be deleted. Deactivate them instead.",
                )

            cursor.execute("delete from problem.tags where id = %s::uuid", (tag_id,))
        connection.commit()

    invalidate_public_problem_cache(reason="tag-delete")
    return {
        "id": row["id"],
        "slug": row["slug"],
        "deleted": True,
        "actor_user_id": local_user["id"],
    }


def update_testcase_row(
    problem_id: str,
    testset_id: str,
    testcase_id: str,
    payload: dict[str, Any],
    actor: AuthContext,
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TESTSET_MANAGE_OWN,
        detail="Author permissions are required to manage problem testcases.",
    )
    note = normalize_optional_text(payload.get("note"))
    try:
        weight = int(payload.get("weight", 1) or 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="weight must be a positive integer.") from exc
    if weight <= 0:
        raise HTTPException(status_code=400, detail="weight must be a positive integer.")
    is_sample = parse_bool_flag(payload.get("is_sample"))

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                update problem.testcases as testcases
                set
                  weight = %s,
                  is_sample = %s,
                  note = %s
                from problem.testsets as testsets, problem.problems as problems
                where
                  testcases.id = %s::uuid
                  and testcases.testset_id = testsets.id
                  and testsets.id = %s::uuid
                  and testsets.problem_id = problems.id
                  and problems.id = %s::uuid
                  and problems.created_by_user_id = %s::uuid
                returning
                  testcases.id::text as id,
                  testcases.ordinal,
                  testcases.weight,
                  testcases.is_sample,
                  testcases.note
                """,
                (weight, is_sample, note, testcase_id, testset_id, problem_id, local_user["id"]),
            )
            row = cursor.fetchone()
        connection.commit()

    if row is None:
        raise HTTPException(status_code=404, detail="The requested testcase was not found.")
    invalidate_public_problem_cache(reason="testcase-update", problem_id=problem_id)
    return dict(row)


def delete_testcase_row(problem_id: str, testset_id: str, testcase_id: str, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TESTSET_MANAGE_OWN,
        detail="Author permissions are required to manage problem testcases.",
    )
    deleted_object_rows: list[dict[str, Any]] = []
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  testcases.input_object_id::text as input_object_id,
                  testcases.expected_output_object_id::text as expected_output_object_id
                from problem.testcases as testcases
                join problem.testsets as testsets on testcases.testset_id = testsets.id
                join problem.problems as problems on testsets.problem_id = problems.id
                where
                  testcases.id = %s::uuid
                  and testsets.id = %s::uuid
                  and problems.id = %s::uuid
                  and problems.created_by_user_id = %s::uuid
                """,
                (testcase_id, testset_id, problem_id, local_user["id"]),
            )
            testcase_row = cursor.fetchone()
            if testcase_row is None:
                raise HTTPException(status_code=404, detail="The requested testcase was not found.")

            cursor.execute(
                """
                delete from problem.testcases as testcases
                using problem.testsets as testsets, problem.problems as problems
                where
                  testcases.id = %s::uuid
                  and testcases.testset_id = testsets.id
                  and testsets.id = %s::uuid
                  and testsets.problem_id = problems.id
                  and problems.id = %s::uuid
                  and problems.created_by_user_id = %s::uuid
                returning testcases.id::text as id
                """,
                (testcase_id, testset_id, problem_id, local_user["id"]),
            )
            row = cursor.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="The requested testcase was not found.")

            cursor.execute(
                """
                update problem.testsets
                set
                  extracted_case_count = (
                    select count(*)::int
                    from problem.testcases
                    where testset_id = %s::uuid
                  ),
                  updated_by_user_id = %s::uuid,
                  updated_at = now()
                where id = %s::uuid
                """,
                (testset_id, local_user["id"], testset_id),
            )
            deleted_object_rows = prune_storage_object_records(
                cursor,
                [
                    testcase_row["input_object_id"],
                    testcase_row["expected_output_object_id"],
                ],
            )
        connection.commit()

    cleanup_storage_object_rows(deleted_object_rows)
    invalidate_public_problem_cache(reason="testcase-delete", problem_id=problem_id)
    return {"id": row["id"], "deleted": True}


def delete_testset_row(problem_id: str, testset_id: str, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TESTSET_MANAGE_OWN,
        detail="Author permissions are required to manage problem testsets.",
    )
    deleted_object_rows: list[dict[str, Any]] = []
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  testsets.id::text as id,
                  testsets.title,
                  testsets.testset_type_code,
                  testsets.archive_object_id::text as archive_object_id
                from problem.testsets as testsets
                join problem.problems as problems on testsets.problem_id = problems.id
                where
                  testsets.id = %s::uuid
                  and problems.id = %s::uuid
                  and problems.created_by_user_id = %s::uuid
                """,
                (testset_id, problem_id, local_user["id"]),
            )
            row = cursor.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="The requested testset was not found.")

            cursor.execute(
                """
                select
                  testcases.input_object_id::text as input_object_id,
                  testcases.expected_output_object_id::text as expected_output_object_id
                from problem.testcases as testcases
                where testcases.testset_id = %s::uuid
                """,
                (testset_id,),
            )
            testcase_rows = list(cursor.fetchall())

            cursor.execute("delete from problem.testsets where id = %s::uuid", (testset_id,))
            deleted_object_rows = prune_storage_object_records(
                cursor,
                [row["archive_object_id"]]
                + [case_row["input_object_id"] for case_row in testcase_rows]
                + [case_row["expected_output_object_id"] for case_row in testcase_rows],
            )
        connection.commit()

    cleanup_storage_object_rows(deleted_object_rows)
    invalidate_public_problem_cache(reason="testset-delete", problem_id=problem_id)
    return {**dict(row), "deleted": True}


def delete_problem_row(problem_id: str, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    can_delete_any = local_user_has_permission(local_user, PERM_ADMIN_FULL)
    deleted_object_rows: list[dict[str, Any]] = []

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  problems.id::text as id,
                  problems.slug,
                  problems.created_by_user_id::text as created_by_user_id,
                  exists(
                    select 1
                    from submission.submissions
                    where problem_id = problems.id
                  ) as has_submissions
                from problem.problems as problems
                where problems.id = %s::uuid
                """,
                (problem_id,),
            )
            problem_row = cursor.fetchone()
            if problem_row is None:
                raise HTTPException(status_code=404, detail=f"Problem '{problem_id}' was not found.")
            is_owner = problem_row["created_by_user_id"] == local_user["id"]
            if not is_owner and not can_delete_any:
                raise HTTPException(status_code=403, detail="You do not have access to delete this problem.")
            if is_owner:
                require_local_permission(
                    local_user,
                    PERM_PROBLEM_DELETE_OWN_DRAFT,
                    detail="Author permissions are required to delete problems.",
                )
            if problem_row["has_submissions"]:
                raise HTTPException(
                    status_code=409,
                    detail="Problems with submissions cannot be deleted. Archive them instead.",
                )

            cursor.execute(
                """
                with candidate_objects as (
                  select statement_object_id as object_id from problem.problems where id = %s::uuid
                  union
                  select storage_object_id from problem.problem_assets where problem_id = %s::uuid
                  union
                  select archive_object_id from problem.testsets where problem_id = %s::uuid
                  union
                  select testcases.input_object_id
                  from problem.testsets
                  join problem.testcases on problem.testcases.testset_id = problem.testsets.id
                  where problem.testsets.problem_id = %s::uuid
                  union
                  select testcases.expected_output_object_id
                  from problem.testsets
                  join problem.testcases on problem.testcases.testset_id = problem.testsets.id
                  where problem.testsets.problem_id = %s::uuid
                  union
                  select source_object_id from problem.checkers where problem_id = %s::uuid
                  union
                  select compiled_object_id from problem.checkers where problem_id = %s::uuid
                )
                select candidate_objects.object_id::text as object_id
                from candidate_objects
                where candidate_objects.object_id is not null
                """,
                (problem_id, problem_id, problem_id, problem_id, problem_id, problem_id, problem_id),
            )
            candidate_rows = list(cursor.fetchall())

            cursor.execute("delete from problem.problems where id = %s::uuid", (problem_id,))
            deleted_object_rows = prune_storage_object_records(
                cursor,
                [row["object_id"] for row in candidate_rows],
            )
        connection.commit()

    cleanup_storage_object_rows(deleted_object_rows)
    invalidate_public_problem_cache(
        reason="problem-delete",
        problem_id=problem_id,
        problem_slug=problem_row["slug"],
    )
    return {"id": problem_id, "slug": problem_row["slug"], "deleted": True}


async def read_uploaded_binary(
    value: Any,
    *,
    field_name: str,
    max_bytes: int,
) -> UploadedBinary | None:
    if not isinstance(value, UploadFile):
        return None
    filename = sanitize_file_component(value.filename, fallback=field_name)
    if not value.filename:
        await value.close()
        return None

    payload = await value.read()
    await value.close()
    if not payload:
        raise HTTPException(status_code=400, detail=f"{field_name} must not be empty.")
    if len(payload) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"{field_name} exceeds the {max_bytes // (1024 * 1024)} MB limit.",
        )
    return UploadedBinary(
        filename=filename,
        content_type=infer_content_type(filename, value.content_type),
        data=payload,
    )


async def parse_problem_form(form: FormData) -> dict[str, Any]:
    statement_file = await read_uploaded_binary(
        form.get("statement_file"),
        field_name="statement_file",
        max_bytes=MAX_STATEMENT_BYTES,
    )
    statement_assets: list[UploadedBinary] = []
    for item in form.getlist("statement_assets"):
        uploaded_asset = await read_uploaded_binary(
            item,
            field_name="statement_assets",
            max_bytes=MAX_STATEMENT_ASSET_BYTES,
        )
        if uploaded_asset is not None:
            statement_assets.append(uploaded_asset)

    testset_archive = await read_uploaded_binary(
        form.get("testset_archive"),
        field_name="testset_archive",
        max_bytes=MAX_TESTSET_ARCHIVE_BYTES,
    )
    checker_source = await read_uploaded_binary(
        form.get("checker_source"),
        field_name="checker_source",
        max_bytes=MAX_CHECKER_SOURCE_BYTES,
    )

    return {
        "slug": form.get("slug"),
        "title": form.get("title"),
        "summary_md": form.get("summary_md"),
        "statement_md": form.get("statement_md"),
        "difficulty_code": form.get("difficulty_code"),
        "type_code": form.get("type_code"),
        "visibility_code": form.get("visibility_code"),
        "scoring_code": form.get("scoring_code"),
        "status_code": form.get("status_code"),
        "time_limit_ms": form.get("time_limit_ms"),
        "memory_limit_kb": form.get("memory_limit_kb"),
        "output_limit_kb": form.get("output_limit_kb"),
        "tag_slugs": parse_tag_slugs(form.getlist("tag_slugs")),
        "statement_file": statement_file,
        "statement_assets": statement_assets,
        "testset_type_code": form.get("testset_type_code"),
        "testset_title": form.get("testset_title"),
        "testset_note": form.get("testset_note"),
        "testset_archive": testset_archive,
        "checker_type_code": form.get("checker_type_code"),
        "checker_runtime_profile_key": form.get("checker_runtime_profile_key"),
        "checker_entrypoint": form.get("checker_entrypoint"),
        "checker_note": form.get("checker_note"),
        "checker_source": checker_source,
        "replace_statement_assets": parse_bool_flag(form.get("replace_statement_assets")),
    }


async def read_problem_request_payload(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "").lower()
    if content_type.startswith("multipart/form-data"):
        return await parse_problem_form(await request.form())

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Request body must be valid JSON or multipart form data.",
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Problem payload must be a JSON object.")
    payload["tag_slugs"] = parse_tag_slugs(payload.get("tag_slugs"))
    payload["replace_statement_assets"] = parse_bool_flag(payload.get("replace_statement_assets"))
    return payload


def create_problem_row(payload: dict[str, Any], actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_PROBLEM_CREATE,
        detail="Author permissions are required to create problems.",
    )
    slug = str(payload.get("slug", "")).strip().lower()
    title = str(payload.get("title", "")).strip()
    summary_md = normalize_optional_text(payload.get("summary_md"))
    statement_md = normalize_optional_text(payload.get("statement_md"))
    statement_file = payload.get("statement_file")
    statement_assets = payload.get("statement_assets", [])
    testset_archive = payload.get("testset_archive")
    checker_source = payload.get("checker_source")
    tag_slugs = parse_tag_slugs(payload.get("tag_slugs"))

    if not slug or not title:
        raise HTTPException(status_code=400, detail="slug and title are required.")
    if not SLUG_PATTERN.fullmatch(slug):
        raise HTTPException(
            status_code=400,
            detail="slug may contain lowercase letters, numbers, and single hyphens only.",
        )

    if statement_md and statement_file is not None:
        raise HTTPException(
            status_code=400,
            detail="Provide either statement_md or statement_file, not both.",
        )
    if statement_md is None and statement_file is None:
        raise HTTPException(
            status_code=400,
            detail="A statement is required. Provide statement_md or statement_file.",
        )

    difficulty_code = normalize_choice(
        payload.get("difficulty_code"),
        field_name="difficulty_code",
        allowed=DIFFICULTY_CODES,
        default="easy",
    )
    type_code = normalize_choice(
        payload.get("type_code"),
        field_name="type_code",
        allowed=TYPE_CODES,
        default="traditional",
    )
    visibility_code = normalize_choice(
        payload.get("visibility_code"),
        field_name="visibility_code",
        allowed=VISIBILITY_CODES,
        default="private",
    )
    scoring_code = normalize_choice(
        payload.get("scoring_code"),
        field_name="scoring_code",
        allowed=SCORING_CODES,
        default="icpc",
    )
    status_code = normalize_choice(
        payload.get("status_code"),
        field_name="status_code",
        allowed=STATUS_CODES,
        default="draft",
    )
    visibility_code, status_code = enforce_problem_create_policy(
        actor,
        visibility_code=visibility_code,
        status_code=status_code,
    )

    time_limit_ms = coerce_positive_int(payload.get("time_limit_ms"), field_name="time_limit_ms")
    memory_limit_kb = coerce_positive_int(
        payload.get("memory_limit_kb"),
        field_name="memory_limit_kb",
    )
    output_limit_kb = coerce_positive_int(
        payload.get("output_limit_kb"),
        field_name="output_limit_kb",
    )

    testset_type_code = normalize_optional_text(payload.get("testset_type_code"))
    if testset_archive is not None:
        testset_type_code = normalize_choice(
            testset_type_code,
            field_name="testset_type_code",
            allowed=TESTSET_TYPE_CODES,
            default="primary",
        )
    testset_title = normalize_optional_text(payload.get("testset_title"))
    testset_note = normalize_optional_text(payload.get("testset_note"))

    checker_type_code = normalize_optional_text(payload.get("checker_type_code"))
    if checker_type_code is not None:
        checker_type_code = normalize_choice(
            checker_type_code,
            field_name="checker_type_code",
            allowed=CHECKER_TYPE_CODES,
            default="diff",
        )
    checker_runtime_profile_key = normalize_optional_text(payload.get("checker_runtime_profile_key"))
    checker_entrypoint = normalize_optional_text(payload.get("checker_entrypoint"))
    checker_note = normalize_optional_text(payload.get("checker_note"))

    if checker_type_code == "custom":
        if checker_source is None:
            raise HTTPException(
                status_code=400,
                detail="checker_source is required when checker_type_code is 'custom'.",
            )
        if checker_runtime_profile_key is None:
            raise HTTPException(
                status_code=400,
                detail="checker_runtime_profile_key is required when checker_type_code is 'custom'.",
            )
        if not runtime_profile_exists(checker_runtime_profile_key):
            raise HTTPException(
                status_code=404,
                detail=f"Runtime '{checker_runtime_profile_key}' was not found for the custom checker.",
            )
    elif checker_type_code == "diff":
        checker_runtime_profile_key = None
        checker_entrypoint = None
        checker_source = None

    if problem_slug_exists(slug):
        raise HTTPException(status_code=409, detail=f"Problem slug '{slug}' already exists.")

    bucket_name = SETTINGS.storage.problems_bucket
    if not bucket_name:
        raise RuntimeError("S3_BUCKET_PROBLEMS must be configured for problem authoring uploads.")

    problem_id = str(uuid.uuid4())
    uploaded_objects: list[StoredObject] = []
    statement_object_id: str | None = None
    statement_source_code = "inline_md"

    if statement_file is not None:
        statement_source_code = infer_statement_source(statement_file)
        statement_object_id = str(uuid.uuid4())
        statement_suffix = PurePosixPath(statement_file.filename).suffix.lower()
        if not statement_suffix:
            statement_suffix = ".md" if statement_source_code == "object_md" else ".pdf"
        uploaded_objects.append(
            build_stored_object(
                object_id=statement_object_id,
                bucket=bucket_name,
                object_key=f"problem/{problem_id}/statement/{statement_object_id}{statement_suffix}",
                upload=statement_file,
                metadata_json={
                    "role": "statement",
                    "problem_id": problem_id,
                    "statement_source_code": statement_source_code,
                },
            )
        )
        statement_md = None

    asset_records: list[dict[str, Any]] = []
    for sort_order, asset_upload in enumerate(statement_assets, start=1):
        asset_object_id = str(uuid.uuid4())
        asset_key = (
            f"problem/{problem_id}/media/{asset_object_id}-{sanitize_file_component(asset_upload.filename)}"
        )
        uploaded_objects.append(
            build_stored_object(
                object_id=asset_object_id,
                bucket=bucket_name,
                object_key=asset_key,
                upload=asset_upload,
                metadata_json={
                    "role": "statement_asset",
                    "problem_id": problem_id,
                    "sort_order": sort_order,
                },
            )
        )
        asset_records.append(
            {
                "storage_object_id": asset_object_id,
                "asset_role_code": (
                    "statement_media"
                    if asset_upload.content_type and asset_upload.content_type.startswith("image/")
                    else "statement_attachment"
                ),
                "logical_name": asset_upload.filename,
                "sort_order": sort_order,
            }
        )

    testset_record: dict[str, Any] | None = None
    testcase_records: list[dict[str, Any]] = []
    if testset_archive is not None:
        extracted_cases = extract_testcases_from_archive(testset_archive)
        testset_id = str(uuid.uuid4())
        archive_object_id = str(uuid.uuid4())
        archive_suffix = PurePosixPath(testset_archive.filename).suffix.lower() or ".zip"

        uploaded_objects.append(
            build_stored_object(
                object_id=archive_object_id,
                bucket=bucket_name,
                object_key=f"testset/{testset_id}/archive/{archive_object_id}{archive_suffix}",
                upload=testset_archive,
                metadata_json={
                    "role": "testset_archive",
                    "problem_id": problem_id,
                    "testset_id": testset_id,
                },
            )
        )

        for ordinal, extracted_case in enumerate(extracted_cases, start=1):
            input_object_id = str(uuid.uuid4())
            output_object_id = str(uuid.uuid4())
            input_upload = UploadedBinary(
                filename=f"{ordinal}-input{extracted_case.input_suffix}",
                content_type="text/plain",
                data=extracted_case.input_bytes,
            )
            output_upload = UploadedBinary(
                filename=f"{ordinal}-output{extracted_case.output_suffix}",
                content_type="text/plain",
                data=extracted_case.output_bytes,
            )
            uploaded_objects.append(
                build_stored_object(
                    object_id=input_object_id,
                    bucket=bucket_name,
                    object_key=f"testset/{testset_id}/cases/{ordinal}/input{extracted_case.input_suffix}",
                    upload=input_upload,
                    metadata_json={
                        "role": "testcase_input",
                        "problem_id": problem_id,
                        "testset_id": testset_id,
                        "ordinal": ordinal,
                        "archive_path": extracted_case.input_archive_path,
                    },
                )
            )
            uploaded_objects.append(
                build_stored_object(
                    object_id=output_object_id,
                    bucket=bucket_name,
                    object_key=f"testset/{testset_id}/cases/{ordinal}/output{extracted_case.output_suffix}",
                    upload=output_upload,
                    metadata_json={
                        "role": "testcase_output",
                        "problem_id": problem_id,
                        "testset_id": testset_id,
                        "ordinal": ordinal,
                        "archive_path": extracted_case.output_archive_path,
                    },
                )
            )
            testcase_records.append(
                {
                    "testset_id": testset_id,
                    "ordinal": ordinal,
                    "weight": 1,
                    "is_sample": testset_type_code == "samples",
                    "input_object_id": input_object_id,
                    "expected_output_object_id": output_object_id,
                    "input_text": maybe_inline_testcase_text(extracted_case.input_bytes),
                    "expected_output_text": maybe_inline_testcase_text(extracted_case.output_bytes),
                    "metadata_json": {
                        "case_key": extracted_case.case_key,
                        "input_archive_path": extracted_case.input_archive_path,
                        "output_archive_path": extracted_case.output_archive_path,
                    },
                }
            )

        testset_record = {
            "id": testset_id,
            "testset_type_code": testset_type_code,
            "title": testset_title or f"{testset_type_code.title()} testset",
            "note": testset_note,
            "archive_object_id": archive_object_id,
            "extracted_case_count": len(testcase_records),
            "metadata_json": {
                "archive_filename": testset_archive.filename,
            },
        }

    checker_record: dict[str, Any] | None = None
    if checker_type_code is not None:
        checker_object_id: str | None = None
        if checker_type_code == "custom" and checker_source is not None:
            checker_object_id = str(uuid.uuid4())
            checker_suffix = PurePosixPath(checker_source.filename).suffix.lower()
            uploaded_objects.append(
                build_stored_object(
                    object_id=checker_object_id,
                    bucket=bucket_name,
                    object_key=(
                        f"problem/{problem_id}/checker/{checker_object_id}"
                        f"{checker_suffix or '.txt'}"
                    ),
                    upload=checker_source,
                    metadata_json={
                        "role": "checker_source",
                        "problem_id": problem_id,
                        "checker_type_code": checker_type_code,
                    },
                )
            )

        checker_record = {
            "checker_type_code": checker_type_code,
            "runtime_profile_key": checker_runtime_profile_key,
            "source_object_id": checker_object_id,
            "entrypoint": checker_entrypoint,
            "note": checker_note,
        }

    try:
        with get_connection(SETTINGS.database_url) as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                if problem_slug_exists(slug):
                    raise HTTPException(status_code=409, detail=f"Problem slug '{slug}' already exists.")

                for stored_object in uploaded_objects:
                    insert_storage_object_record(
                        cursor,
                        stored_object=stored_object,
                        uploaded_by_user_id=local_user["id"],
                    )

                cursor.execute(
                    """
                    insert into problem.problems (
                      id,
                      slug,
                      title,
                      summary_md,
                      statement_source_code,
                      statement_md,
                      statement_object_id,
                      difficulty_code,
                      type_code,
                      visibility_code,
                      scoring_code,
                      status_code,
                      time_limit_ms,
                      memory_limit_kb,
                      output_limit_kb,
                      metadata_json,
                      created_by_user_id,
                      updated_by_user_id,
                      published_by_user_id,
                      published_at
                    )
                    values (
                      %s::uuid,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s::uuid,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      '{}'::jsonb,
                      %s::uuid,
                      %s::uuid,
                      case when %s = 'published' then %s::uuid else null end,
                      case when %s = 'published' then now() else null end
                    )
                    returning id::text as id, slug, title, status_code as status
                    """,
                    (
                        problem_id,
                        slug,
                        title,
                        summary_md,
                        statement_source_code,
                        statement_md,
                        statement_object_id,
                        difficulty_code,
                        type_code,
                        visibility_code,
                        scoring_code,
                        status_code,
                        time_limit_ms,
                        memory_limit_kb,
                        output_limit_kb,
                        local_user["id"],
                        local_user["id"],
                        status_code,
                        local_user["id"],
                        status_code,
                    ),
                )
                created_problem = cursor.fetchone()

                for tag_slug in tag_slugs:
                    cursor.execute(
                        """
                        insert into problem.problem_tags (problem_id, tag_id)
                        select %s::uuid, tags.id
                        from problem.tags as tags
                        where lower(tags.slug) = lower(%s)
                        on conflict do nothing
                        """,
                        (problem_id, tag_slug),
                    )

                for asset_record in asset_records:
                    cursor.execute(
                        """
                        insert into problem.problem_assets (
                          problem_id,
                          storage_object_id,
                          asset_role_code,
                          logical_name,
                          sort_order,
                          created_by_user_id
                        )
                        values (%s::uuid, %s::uuid, %s, %s, %s, %s::uuid)
                        """,
                        (
                            problem_id,
                            asset_record["storage_object_id"],
                            asset_record["asset_role_code"],
                            asset_record["logical_name"],
                            asset_record["sort_order"],
                            local_user["id"],
                        ),
                    )

                if testset_record is not None:
                    cursor.execute(
                        """
                        insert into problem.testsets (
                          id,
                          problem_id,
                          testset_type_code,
                          title,
                          note,
                          archive_object_id,
                          extracted_case_count,
                          metadata_json,
                          created_by_user_id,
                          updated_by_user_id
                        )
                        values (
                          %s::uuid,
                          %s::uuid,
                          %s,
                          %s,
                          %s,
                          %s::uuid,
                          %s,
                          %s,
                          %s::uuid,
                          %s::uuid
                        )
                        """,
                        (
                            testset_record["id"],
                            problem_id,
                            testset_record["testset_type_code"],
                            testset_record["title"],
                            testset_record["note"],
                            testset_record["archive_object_id"],
                            testset_record["extracted_case_count"],
                            Json(testset_record["metadata_json"]),
                            local_user["id"],
                            local_user["id"],
                        ),
                    )

                for testcase_record in testcase_records:
                    cursor.execute(
                        """
                        insert into problem.testcases (
                          testset_id,
                          ordinal,
                          weight,
                          is_sample,
                          input_object_id,
                          expected_output_object_id,
                          input_text,
                          expected_output_text,
                          metadata_json
                        )
                        values (
                          %s::uuid,
                          %s,
                          %s,
                          %s,
                          %s::uuid,
                          %s::uuid,
                          %s,
                          %s,
                          %s
                        )
                        """,
                        (
                            testcase_record["testset_id"],
                            testcase_record["ordinal"],
                            testcase_record["weight"],
                            testcase_record["is_sample"],
                            testcase_record["input_object_id"],
                            testcase_record["expected_output_object_id"],
                            testcase_record["input_text"],
                            testcase_record["expected_output_text"],
                            Json(testcase_record["metadata_json"]),
                        ),
                    )

                if checker_record is not None:
                    cursor.execute(
                        """
                        insert into problem.checkers (
                          problem_id,
                          checker_type_code,
                          runtime_profile_key,
                          source_object_id,
                          entrypoint,
                          note,
                          created_by_user_id,
                          updated_by_user_id
                        )
                        values (
                          %s::uuid,
                          %s,
                          %s,
                          %s::uuid,
                          %s,
                          %s,
                          %s::uuid,
                          %s::uuid
                        )
                        """,
                        (
                            problem_id,
                            checker_record["checker_type_code"],
                            checker_record["runtime_profile_key"],
                            checker_record["source_object_id"],
                            checker_record["entrypoint"],
                            checker_record["note"],
                            local_user["id"],
                            local_user["id"],
                        ),
                    )

            connection.commit()
    except Exception:
        cleanup_uploaded_objects(uploaded_objects)
        raise

    invalidate_public_problem_cache(
        reason="problem-create",
        problem_id=created_problem["id"],
        problem_slug=created_problem["slug"],
    )
    return {
        **created_problem,
        "actor_user_id": local_user["id"],
    }


def update_problem_row(problem_id: str, payload: dict[str, Any], actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_PROBLEM_UPDATE_OWN_DRAFT,
        detail="Author permissions are required to update problems.",
    )
    slug = str(payload.get("slug", "")).strip().lower()
    title = str(payload.get("title", "")).strip()
    summary_md = normalize_optional_text(payload.get("summary_md"))
    incoming_statement_md = normalize_optional_text(payload.get("statement_md"))
    statement_file = payload.get("statement_file")
    statement_assets = payload.get("statement_assets", [])
    replace_statement_assets = parse_bool_flag(payload.get("replace_statement_assets"))
    testset_archive = payload.get("testset_archive")
    checker_source = payload.get("checker_source")
    tag_slugs = parse_tag_slugs(payload.get("tag_slugs"))

    if not slug or not title:
        raise HTTPException(status_code=400, detail="slug and title are required.")
    if not SLUG_PATTERN.fullmatch(slug):
        raise HTTPException(
            status_code=400,
            detail="slug may contain lowercase letters, numbers, and single hyphens only.",
        )
    if incoming_statement_md and statement_file is not None:
        raise HTTPException(
            status_code=400,
            detail="Provide either statement_md or statement_file, not both.",
        )

    difficulty_code = normalize_choice(
        payload.get("difficulty_code"),
        field_name="difficulty_code",
        allowed=DIFFICULTY_CODES,
        default="easy",
    )
    type_code = normalize_choice(
        payload.get("type_code"),
        field_name="type_code",
        allowed=TYPE_CODES,
        default="traditional",
    )
    visibility_code = normalize_choice(
        payload.get("visibility_code"),
        field_name="visibility_code",
        allowed=VISIBILITY_CODES,
        default="private",
    )
    scoring_code = normalize_choice(
        payload.get("scoring_code"),
        field_name="scoring_code",
        allowed=SCORING_CODES,
        default="icpc",
    )
    status_code = normalize_choice(
        payload.get("status_code"),
        field_name="status_code",
        allowed=STATUS_CODES,
        default="draft",
    )
    time_limit_ms = coerce_positive_int(payload.get("time_limit_ms"), field_name="time_limit_ms")
    memory_limit_kb = coerce_positive_int(
        payload.get("memory_limit_kb"),
        field_name="memory_limit_kb",
    )
    output_limit_kb = coerce_positive_int(
        payload.get("output_limit_kb"),
        field_name="output_limit_kb",
    )

    testset_type_code = normalize_optional_text(payload.get("testset_type_code"))
    if testset_archive is not None:
        testset_type_code = normalize_choice(
            testset_type_code,
            field_name="testset_type_code",
            allowed=TESTSET_TYPE_CODES,
            default="primary",
        )
    testset_title = normalize_optional_text(payload.get("testset_title"))
    testset_note = normalize_optional_text(payload.get("testset_note"))

    checker_type_code = normalize_choice(
        payload.get("checker_type_code"),
        field_name="checker_type_code",
        allowed=CHECKER_TYPE_CODES,
        default="diff",
    )
    checker_runtime_profile_key = normalize_optional_text(payload.get("checker_runtime_profile_key"))
    checker_entrypoint = normalize_optional_text(payload.get("checker_entrypoint"))
    checker_note = normalize_optional_text(payload.get("checker_note"))

    bucket_name = SETTINGS.storage.problems_bucket
    if not bucket_name:
        raise RuntimeError("S3_BUCKET_PROBLEMS must be configured for problem authoring uploads.")

    uploaded_objects: list[StoredObject] = []
    updated_problem: dict[str, Any] | None = None
    deleted_object_rows: list[dict[str, Any]] = []

    try:
        with get_connection(SETTINGS.database_url) as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    select
                      id::text as id,
                      slug,
                      visibility_code,
                      status_code,
                      statement_source_code,
                      statement_md,
                      statement_object_id::text as statement_object_id
                    from problem.problems
                    where id = %s::uuid and created_by_user_id = %s::uuid
                    """,
                    (problem_id, local_user["id"]),
                )
                current_problem = cursor.fetchone()
                if current_problem is None:
                    raise HTTPException(status_code=404, detail=f"Problem '{problem_id}' was not found.")

                visibility_code, status_code = enforce_problem_update_policy(
                    current_visibility_code=current_problem["visibility_code"],
                    current_status_code=current_problem["status_code"],
                    requested_visibility_code=visibility_code,
                    requested_status_code=status_code,
                )

                cursor.execute(
                    """
                    select
                      id::text as id,
                      checker_type_code,
                      runtime_profile_key,
                      source_object_id::text as source_object_id,
                      compiled_object_id::text as compiled_object_id,
                      entrypoint,
                      note
                    from problem.checkers
                    where problem_id = %s::uuid and is_active
                    order by created_at desc
                    limit 1
                    """,
                    (problem_id,),
                )
                current_checker = cursor.fetchone()
                cleanup_candidate_object_ids: list[str] = []

                if slug != current_problem["slug"]:
                    cursor.execute(
                        """
                        select 1
                        from problem.problems
                        where lower(slug) = lower(%s) and id <> %s::uuid
                        """,
                        (slug, problem_id),
                    )
                    if cursor.fetchone() is not None:
                        raise HTTPException(status_code=409, detail=f"Problem slug '{slug}' already exists.")

                statement_source_code = current_problem["statement_source_code"]
                statement_md = current_problem["statement_md"]
                statement_object_id = current_problem["statement_object_id"]
                if incoming_statement_md is not None:
                    if current_problem["statement_object_id"] is not None:
                        cleanup_candidate_object_ids.append(current_problem["statement_object_id"])
                    statement_source_code = "inline_md"
                    statement_md = incoming_statement_md
                    statement_object_id = None
                elif statement_file is not None:
                    if current_problem["statement_object_id"] is not None:
                        cleanup_candidate_object_ids.append(current_problem["statement_object_id"])
                    statement_source_code = infer_statement_source(statement_file)
                    statement_object_id = str(uuid.uuid4())
                    statement_suffix = PurePosixPath(statement_file.filename).suffix.lower()
                    if not statement_suffix:
                        statement_suffix = ".md" if statement_source_code == "object_md" else ".pdf"
                    uploaded_objects.append(
                        build_stored_object(
                            object_id=statement_object_id,
                            bucket=bucket_name,
                            object_key=f"problem/{problem_id}/statement/{statement_object_id}{statement_suffix}",
                            upload=statement_file,
                            metadata_json={
                                "role": "statement",
                                "problem_id": problem_id,
                                "statement_source_code": statement_source_code,
                            },
                        )
                    )
                    statement_md = None

                if statement_source_code == "inline_md" and statement_md is None:
                    raise HTTPException(
                        status_code=400,
                        detail="A statement is required. Provide statement_md or statement_file.",
                    )
                if statement_source_code != "inline_md" and statement_object_id is None:
                    raise HTTPException(
                        status_code=400,
                        detail="A statement file is required for the selected statement mode.",
                    )

                for stored_object in uploaded_objects:
                    insert_storage_object_record(
                        cursor,
                        stored_object=stored_object,
                        uploaded_by_user_id=local_user["id"],
                    )

                cursor.execute(
                    """
                    update problem.problems
                    set
                      slug = %s,
                      title = %s,
                      summary_md = %s,
                      statement_source_code = %s,
                      statement_md = %s,
                      statement_object_id = %s::uuid,
                      difficulty_code = %s,
                      type_code = %s,
                      visibility_code = %s,
                      scoring_code = %s,
                      status_code = %s,
                      time_limit_ms = %s,
                      memory_limit_kb = %s,
                      output_limit_kb = %s,
                      updated_by_user_id = %s::uuid,
                      updated_at = now(),
                      published_by_user_id = case
                        when %s = 'published' then coalesce(published_by_user_id, %s::uuid)
                        when %s = 'archived' then published_by_user_id
                        else null
                      end,
                      published_at = case
                        when %s = 'published' then coalesce(published_at, now())
                        when %s = 'archived' then published_at
                        else null
                      end
                    where id = %s::uuid
                    returning id::text as id, slug, title, status_code as status
                    """,
                    (
                        slug,
                        title,
                        summary_md,
                        statement_source_code,
                        statement_md,
                        statement_object_id,
                        difficulty_code,
                        type_code,
                        visibility_code,
                        scoring_code,
                        status_code,
                        time_limit_ms,
                        memory_limit_kb,
                        output_limit_kb,
                        local_user["id"],
                        status_code,
                        local_user["id"],
                        status_code,
                        status_code,
                        status_code,
                        problem_id,
                    ),
                )
                updated_problem = cursor.fetchone()

                cursor.execute(
                    "delete from problem.problem_tags where problem_id = %s::uuid",
                    (problem_id,),
                )
                for tag_slug in tag_slugs:
                    cursor.execute(
                        """
                        insert into problem.problem_tags (problem_id, tag_id)
                        select %s::uuid, tags.id
                        from problem.tags as tags
                        where lower(tags.slug) = lower(%s)
                        on conflict do nothing
                        """,
                        (problem_id, tag_slug),
                    )

                if replace_statement_assets:
                    cursor.execute(
                        """
                        select storage_object_id::text as object_id
                        from problem.problem_assets
                        where problem_id = %s::uuid
                        """,
                        (problem_id,),
                    )
                    cleanup_candidate_object_ids.extend(
                        row["object_id"]
                        for row in cursor.fetchall()
                        if row["object_id"] is not None
                    )
                    cursor.execute(
                        "delete from problem.problem_assets where problem_id = %s::uuid",
                        (problem_id,),
                    )
                if statement_assets:
                    cursor.execute(
                        """
                        select coalesce(max(sort_order), 0) as max_sort_order
                        from problem.problem_assets
                        where problem_id = %s::uuid
                        """,
                        (problem_id,),
                    )
                    max_sort_order = int((cursor.fetchone() or {}).get("max_sort_order") or 0)
                    for offset, asset_upload in enumerate(statement_assets, start=1):
                        asset_object_id = str(uuid.uuid4())
                        asset_key = (
                            f"problem/{problem_id}/media/{asset_object_id}-{sanitize_file_component(asset_upload.filename)}"
                        )
                        stored_asset = build_stored_object(
                            object_id=asset_object_id,
                            bucket=bucket_name,
                            object_key=asset_key,
                            upload=asset_upload,
                            metadata_json={
                                "role": "statement_asset",
                                "problem_id": problem_id,
                                "sort_order": max_sort_order + offset,
                            },
                        )
                        uploaded_objects.append(stored_asset)
                        insert_storage_object_record(
                            cursor,
                            stored_object=stored_asset,
                            uploaded_by_user_id=local_user["id"],
                        )
                        cursor.execute(
                            """
                            insert into problem.problem_assets (
                              problem_id,
                              storage_object_id,
                              asset_role_code,
                              logical_name,
                              sort_order,
                              created_by_user_id
                            )
                            values (%s::uuid, %s::uuid, %s, %s, %s, %s::uuid)
                            """,
                            (
                                problem_id,
                                asset_object_id,
                                (
                                    "statement_media"
                                    if asset_upload.content_type
                                    and asset_upload.content_type.startswith("image/")
                                    else "statement_attachment"
                                ),
                                asset_upload.filename,
                                max_sort_order + offset,
                                local_user["id"],
                            ),
                        )

                if testset_archive is not None:
                    extracted_cases = extract_testcases_from_archive(testset_archive)
                    testset_id = str(uuid.uuid4())
                    archive_object_id = str(uuid.uuid4())
                    archive_suffix = PurePosixPath(testset_archive.filename).suffix.lower() or ".zip"
                    stored_archive = build_stored_object(
                        object_id=archive_object_id,
                        bucket=bucket_name,
                        object_key=f"testset/{testset_id}/archive/{archive_object_id}{archive_suffix}",
                        upload=testset_archive,
                        metadata_json={
                            "role": "testset_archive",
                            "problem_id": problem_id,
                            "testset_id": testset_id,
                        },
                    )
                    uploaded_objects.append(stored_archive)
                    insert_storage_object_record(
                        cursor,
                        stored_object=stored_archive,
                        uploaded_by_user_id=local_user["id"],
                    )

                    cursor.execute(
                        """
                        update problem.testsets
                        set is_active = false, updated_by_user_id = %s::uuid, updated_at = now()
                        where problem_id = %s::uuid and is_active
                        """,
                        (local_user["id"], problem_id),
                    )
                    cursor.execute(
                        """
                        insert into problem.testsets (
                          id,
                          problem_id,
                          testset_type_code,
                          title,
                          note,
                          archive_object_id,
                          extracted_case_count,
                          metadata_json,
                          created_by_user_id,
                          updated_by_user_id
                        )
                        values (
                          %s::uuid,
                          %s::uuid,
                          %s,
                          %s,
                          %s,
                          %s::uuid,
                          %s,
                          %s,
                          %s::uuid,
                          %s::uuid
                        )
                        """,
                        (
                            testset_id,
                            problem_id,
                            testset_type_code,
                            testset_title or f"{testset_type_code.title()} testset",
                            testset_note,
                            archive_object_id,
                            len(extracted_cases),
                            Json({"archive_filename": testset_archive.filename}),
                            local_user["id"],
                            local_user["id"],
                        ),
                    )

                    for ordinal, extracted_case in enumerate(extracted_cases, start=1):
                        input_object_id = str(uuid.uuid4())
                        output_object_id = str(uuid.uuid4())
                        input_upload = UploadedBinary(
                            filename=f"{ordinal}-input{extracted_case.input_suffix}",
                            content_type="text/plain",
                            data=extracted_case.input_bytes,
                        )
                        output_upload = UploadedBinary(
                            filename=f"{ordinal}-output{extracted_case.output_suffix}",
                            content_type="text/plain",
                            data=extracted_case.output_bytes,
                        )
                        stored_input = build_stored_object(
                            object_id=input_object_id,
                            bucket=bucket_name,
                            object_key=f"testset/{testset_id}/cases/{ordinal}/input{extracted_case.input_suffix}",
                            upload=input_upload,
                            metadata_json={
                                "role": "testcase_input",
                                "problem_id": problem_id,
                                "testset_id": testset_id,
                                "ordinal": ordinal,
                                "archive_path": extracted_case.input_archive_path,
                            },
                        )
                        stored_output = build_stored_object(
                            object_id=output_object_id,
                            bucket=bucket_name,
                            object_key=f"testset/{testset_id}/cases/{ordinal}/output{extracted_case.output_suffix}",
                            upload=output_upload,
                            metadata_json={
                                "role": "testcase_output",
                                "problem_id": problem_id,
                                "testset_id": testset_id,
                                "ordinal": ordinal,
                                "archive_path": extracted_case.output_archive_path,
                            },
                        )
                        uploaded_objects.append(stored_input)
                        uploaded_objects.append(stored_output)
                        insert_storage_object_record(
                            cursor,
                            stored_object=stored_input,
                            uploaded_by_user_id=local_user["id"],
                        )
                        insert_storage_object_record(
                            cursor,
                            stored_object=stored_output,
                            uploaded_by_user_id=local_user["id"],
                        )
                        cursor.execute(
                            """
                            insert into problem.testcases (
                              testset_id,
                              ordinal,
                              weight,
                              is_sample,
                              input_object_id,
                              expected_output_object_id,
                              input_text,
                              expected_output_text,
                              metadata_json
                            )
                            values (
                              %s::uuid,
                              %s,
                              %s,
                              %s,
                              %s::uuid,
                              %s::uuid,
                              %s,
                              %s,
                              %s
                            )
                            """,
                            (
                                testset_id,
                                ordinal,
                                1,
                                testset_type_code == "samples",
                                input_object_id,
                                output_object_id,
                                maybe_inline_testcase_text(extracted_case.input_bytes),
                                maybe_inline_testcase_text(extracted_case.output_bytes),
                                Json(
                                    {
                                        "case_key": extracted_case.case_key,
                                        "input_archive_path": extracted_case.input_archive_path,
                                        "output_archive_path": extracted_case.output_archive_path,
                                    }
                                ),
                            ),
                        )

                checker_source_object_id: str | None = None
                if checker_type_code == "custom":
                    if checker_runtime_profile_key is None:
                        raise HTTPException(
                            status_code=400,
                            detail="checker_runtime_profile_key is required when checker_type_code is 'custom'.",
                        )
                    if not runtime_profile_exists(checker_runtime_profile_key):
                        raise HTTPException(
                            status_code=404,
                            detail=f"Runtime '{checker_runtime_profile_key}' was not found for the custom checker.",
                        )
                    if checker_source is not None:
                        checker_source_object_id = str(uuid.uuid4())
                        checker_suffix = PurePosixPath(checker_source.filename).suffix.lower()
                        stored_checker = build_stored_object(
                            object_id=checker_source_object_id,
                            bucket=bucket_name,
                            object_key=(
                                f"problem/{problem_id}/checker/{checker_source_object_id}"
                                f"{checker_suffix or '.txt'}"
                            ),
                            upload=checker_source,
                            metadata_json={
                                "role": "checker_source",
                                "problem_id": problem_id,
                                "checker_type_code": checker_type_code,
                            },
                        )
                        uploaded_objects.append(stored_checker)
                        insert_storage_object_record(
                            cursor,
                            stored_object=stored_checker,
                            uploaded_by_user_id=local_user["id"],
                        )
                    elif current_checker and current_checker["checker_type_code"] == "custom":
                        checker_source_object_id = current_checker["source_object_id"]
                    if checker_source_object_id is None:
                        raise HTTPException(
                            status_code=400,
                            detail="checker_source is required when switching to or creating a custom checker.",
                        )
                else:
                    checker_runtime_profile_key = None
                    checker_entrypoint = None

                if current_checker is not None:
                    cleanup_candidate_object_ids.extend(
                        object_id
                        for object_id in [
                            current_checker["source_object_id"],
                            current_checker["compiled_object_id"],
                        ]
                        if object_id is not None
                    )
                cursor.execute(
                    """
                    update problem.checkers
                    set is_active = false, updated_by_user_id = %s::uuid, updated_at = now()
                    where problem_id = %s::uuid and is_active
                    """,
                    (local_user["id"], problem_id),
                )
                if current_checker is not None:
                    cursor.execute(
                        "delete from problem.checkers where id = %s::uuid",
                        (current_checker["id"],),
                    )
                cursor.execute(
                    """
                    insert into problem.checkers (
                      problem_id,
                      checker_type_code,
                      runtime_profile_key,
                      source_object_id,
                      entrypoint,
                      note,
                      created_by_user_id,
                      updated_by_user_id
                    )
                    values (
                      %s::uuid,
                      %s,
                      %s,
                      %s::uuid,
                      %s,
                      %s,
                      %s::uuid,
                      %s::uuid
                    )
                    """,
                    (
                        problem_id,
                        checker_type_code,
                        checker_runtime_profile_key,
                        checker_source_object_id,
                        checker_entrypoint,
                        checker_note,
                        local_user["id"],
                        local_user["id"],
                    ),
                )

                deleted_object_rows = prune_storage_object_records(
                    cursor,
                    cleanup_candidate_object_ids,
                )

            connection.commit()
    except Exception:
        cleanup_uploaded_objects(uploaded_objects)
        raise

    if updated_problem is None:
        raise RuntimeError("Problem update did not return a result row.")

    cleanup_storage_object_rows(deleted_object_rows)
    invalidate_public_problem_cache(
        reason="problem-update",
        problem_id=updated_problem["id"],
        problem_slug=updated_problem["slug"],
    )
    return {
        **updated_problem,
        "actor_user_id": local_user["id"],
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    global BOOTSTRAP_SUMMARY
    BOOTSTRAP_SUMMARY = bootstrap_service(
        SETTINGS,
        apply_schema=True,
        ensure_storage_buckets=True,
        ensure_judge_queue=False,
    )
    yield


app = FastAPI(
    title="Hexacode Problem Service",
    version="0.3.0",
    description="Problem domain service with storage-backed authoring for statements and testsets.",
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
        "storage_driver": SETTINGS.storage.driver,
        "schema_files": BOOTSTRAP_SUMMARY.get("schema_files", []),
        "bucket_names": BOOTSTRAP_SUMMARY.get("buckets", []),
    }


@app.get("/api/problems")
async def list_problems(
    q: str | None = None,
    difficulty: str | None = None,
    visibility: str | None = None,
    status: str | None = None,
    tag: list[str] = Query(default=[]),
    sort: str = "newest",
) -> dict[str, Any]:
    normalized_difficulty = normalize_optional_text(difficulty)
    if normalized_difficulty == "all":
        normalized_difficulty = None
    elif normalized_difficulty is not None:
        normalized_difficulty = normalize_choice(
            normalized_difficulty,
            field_name="difficulty",
            allowed=DIFFICULTY_CODES,
            default="easy",
        )

    normalized_visibility = normalize_optional_text(visibility)
    if normalized_visibility == "all":
        normalized_visibility = None
    elif normalized_visibility is not None:
        normalized_visibility = normalize_choice(
            normalized_visibility,
            field_name="visibility",
            allowed=VISIBILITY_CODES,
            default="public",
        )

    normalized_status = normalize_optional_text(status)
    if normalized_status == "all":
        normalized_status = None
    elif normalized_status is not None:
        normalized_status = normalize_choice(
            normalized_status,
            field_name="status",
            allowed=STATUS_CODES,
            default="draft",
        )

    normalized_sort = str(sort or "newest").strip().lower() or "newest"
    if normalized_sort not in PROBLEM_LIST_SORT_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"sort must be one of: {', '.join(sorted(PROBLEM_LIST_SORT_CODES))}.",
        )

    normalized_query = normalize_optional_text(q)
    normalized_tags = sorted({tag_slug.strip().lower() for tag_slug in tag if tag_slug.strip()})
    cache_key = build_public_problem_list_cache_key(
        {
            "q": normalized_query,
            "difficulty": normalized_difficulty,
            "visibility": normalized_visibility,
            "status": normalized_status,
            "tags": normalized_tags,
            "sort": normalized_sort,
        }
    )
    cached_response = read_json_cache(SETTINGS.redis.url, cache_key)
    if isinstance(cached_response, dict):
        return cached_response

    problems = list_problem_rows(
        search_query=normalized_query,
        difficulty=normalized_difficulty,
        visibility=normalized_visibility,
        status=normalized_status,
        tag_slugs=normalized_tags,
        sort=normalized_sort,
        public_only=True,
    )
    response = {
        "data": problems,
        "meta": {
            "source": SETTINGS.service_name,
            "count": len(problems),
            "filters": {
                "q": normalized_query,
                "difficulty": normalized_difficulty,
                "visibility": normalized_visibility,
                "status": normalized_status,
                "tag": normalized_tags,
                "sort": normalized_sort,
            },
        },
    }
    write_json_cache(SETTINGS.redis.url, cache_key, response, PROBLEM_LIST_CACHE_TTL_SECONDS)
    return response


@app.get("/api/dashboard/problems")
async def list_dashboard_problems(
    scope: str = "mine",
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    problems = list_dashboard_problem_rows(local_user, local_user["id"], scope=scope)
    return {
        "data": problems,
        "meta": {"source": SETTINGS.service_name, "count": len(problems), "scope": scope},
    }


@app.get("/api/dashboard/problems/{problem_id}")
async def get_dashboard_problem(
    problem_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    problem = get_dashboard_problem_row(problem_id, local_user["id"])
    if problem is None:
        raise HTTPException(status_code=404, detail=f"Problem '{problem_id}' was not found.")
    return {"data": problem}


@app.get("/api/dashboard/problems/{problem_id}/testsets")
async def get_dashboard_problem_testsets(
    problem_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    problem = get_dashboard_problem_row(problem_id, local_user["id"])
    if problem is None:
        raise HTTPException(status_code=404, detail=f"Problem '{problem_id}' was not found.")
    return {
        "data": {
            "problem_id": problem["id"],
            "slug": problem["slug"],
            "title": problem["title"],
            "testsets": problem["testsets"],
        }
    }


@app.get("/api/dashboard/problems/{problem_id}/files/{object_id}")
async def download_dashboard_problem_file(
    problem_id: str,
    object_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> Response:
    object_row = get_dashboard_problem_file_row(problem_id, object_id, actor)
    if object_row is None:
        raise HTTPException(status_code=404, detail="The requested problem file was not found.")
    return download_storage_object_response(object_row)


@app.put("/api/dashboard/problems/{problem_id}/testsets/{testset_id}/testcases/{testcase_id}")
async def update_dashboard_testcase(
    problem_id: str,
    testset_id: str,
    testcase_id: str,
    payload: dict[str, Any],
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": update_testcase_row(problem_id, testset_id, testcase_id, payload, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.delete("/api/dashboard/problems/{problem_id}/testsets/{testset_id}/testcases/{testcase_id}")
async def delete_dashboard_testcase(
    problem_id: str,
    testset_id: str,
    testcase_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": delete_testcase_row(problem_id, testset_id, testcase_id, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.delete("/api/dashboard/problems/{problem_id}/testsets/{testset_id}")
async def delete_dashboard_testset(
    problem_id: str,
    testset_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": delete_testset_row(problem_id, testset_id, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.get("/api/problems/{problem_slug}")
async def get_problem(problem_slug: str) -> dict[str, Any]:
    cache_key = build_public_problem_detail_cache_key(problem_slug)
    cached_response = read_json_cache(SETTINGS.redis.url, cache_key)
    if isinstance(cached_response, dict):
        return cached_response

    problem = get_problem_row(problem_slug, public_only=True)
    if problem is None:
        raise HTTPException(status_code=404, detail=f"Problem '{problem_slug}' was not found.")
    response = {"data": problem}
    write_json_cache(SETTINGS.redis.url, cache_key, response, PROBLEM_DETAIL_CACHE_TTL_SECONDS)
    return response


@app.get("/api/problems/{problem_slug}/solve")
async def get_problem_solve(problem_slug: str) -> dict[str, Any]:
    cache_key = build_public_problem_solve_cache_key(problem_slug)
    cached_response = read_json_cache(SETTINGS.redis.url, cache_key)
    if isinstance(cached_response, dict):
        return cached_response

    problem = get_problem_solve_row(problem_slug)
    if problem is None:
        raise HTTPException(status_code=404, detail=f"Problem '{problem_slug}' was not found.")
    response = {"data": problem}
    write_json_cache(SETTINGS.redis.url, cache_key, response, PROBLEM_SOLVE_CACHE_TTL_SECONDS)
    return response


@app.get("/api/problems/{problem_slug}/files/{object_id}")
async def download_public_problem_file(problem_slug: str, object_id: str) -> Response:
    object_row = get_public_problem_file_row(problem_slug, object_id)
    if object_row is None:
        raise HTTPException(status_code=404, detail="The requested problem file was not found.")
    return download_storage_object_response(object_row)


@app.post("/internal/cache/public-problems/invalidate")
async def invalidate_internal_public_problem_cache(payload: dict[str, Any]) -> dict[str, Any]:
    version = invalidate_public_problem_cache(
        reason=normalize_optional_text(payload.get("reason")) or "internal",
        problem_id=normalize_optional_text(payload.get("problem_id")),
        problem_slug=normalize_optional_text(payload.get("problem_slug")),
    )
    return {
        "data": {
            "version": version,
            "reason": normalize_optional_text(payload.get("reason")) or "internal",
            "problem_id": normalize_optional_text(payload.get("problem_id")),
            "problem_slug": normalize_optional_text(payload.get("problem_slug")),
        }
    }


@app.get("/internal/problems/{problem_id}/judge-context")
async def get_internal_problem_judge_context(
    problem_id: str,
    testset_id: str | None = None,
    samples_only: bool = False,
) -> dict[str, Any]:
    problem_context = get_problem_judge_context(
        problem_id,
        requested_testset_id=normalize_optional_text(testset_id),
        samples_only=samples_only,
    )
    if problem_context is None:
        raise HTTPException(status_code=404, detail=f"Problem '{problem_id}' was not found.")
    return {"data": problem_context}


@app.post("/internal/checkers/{checker_id}/compiled-artifact")
async def register_internal_compiled_checker_artifact(
    checker_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {"data": register_compiled_checker_artifact(checker_id, payload)}


@app.post("/api/problems", status_code=201)
async def create_problem(
    request: Request,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    created_problem = create_problem_row(await read_problem_request_payload(request), actor)
    return {
        "data": created_problem,
        "meta": {"source": SETTINGS.service_name},
    }


@app.put("/api/dashboard/problems/{problem_id}")
async def update_problem(
    problem_id: str,
    request: Request,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    updated_problem = update_problem_row(problem_id, await read_problem_request_payload(request), actor)
    return {
        "data": updated_problem,
        "meta": {"source": SETTINGS.service_name},
    }


@app.delete("/api/dashboard/problems/{problem_id}")
async def delete_dashboard_problem(
    problem_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": delete_problem_row(problem_id, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.post("/api/dashboard/problems/{problem_id}/actions/{action}")
async def transition_dashboard_problem(
    problem_id: str,
    action: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    updated_problem = transition_problem_lifecycle(problem_id, action, actor)
    return {
        "data": updated_problem,
        "meta": {"source": SETTINGS.service_name},
    }


@app.get("/api/dashboard/tags")
async def list_dashboard_tags(
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_TAG_READ_DASHBOARD,
        detail="Author permissions are required for the dashboard tag catalog.",
    )
    tags = list_dashboard_tag_rows()
    return {
        "data": tags,
        "meta": {"source": SETTINGS.service_name, "count": len(tags)},
    }


@app.post("/api/dashboard/tags", status_code=201)
async def create_dashboard_tag(
    payload: dict[str, Any],
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    tag = create_tag_row(payload, actor)
    return {
        "data": tag,
        "meta": {"source": SETTINGS.service_name},
    }


@app.put("/api/dashboard/tags/{tag_id}")
async def update_dashboard_tag(
    tag_id: str,
    payload: dict[str, Any],
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    tag = update_tag_row(tag_id, payload, actor)
    return {
        "data": tag,
        "meta": {"source": SETTINGS.service_name},
    }


@app.post("/api/dashboard/tags/{tag_id}/actions/{action}")
async def transition_dashboard_tag(
    tag_id: str,
    action: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": transition_tag_row(tag_id, action, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.delete("/api/dashboard/tags/{tag_id}")
async def delete_dashboard_tag(
    tag_id: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": delete_tag_row(tag_id, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.get("/api/dashboard/storage/orphans")
async def inspect_dashboard_storage_lifecycle(
    limit: int = 100,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": inspect_storage_lifecycle(limit, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.post("/api/dashboard/storage/orphans/cleanup")
async def cleanup_dashboard_storage_lifecycle(
    payload: dict[str, Any],
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    limit = payload.get("limit", 100)
    try:
        normalized_limit = int(limit or 100)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="limit must be a positive integer.") from exc
    if normalized_limit <= 0:
        raise HTTPException(status_code=400, detail="limit must be a positive integer.")

    return {
        "data": cleanup_storage_lifecycle(normalized_limit, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.get("/api/tags")
async def list_tags() -> dict[str, Any]:
    return {"data": list_tag_rows()}
