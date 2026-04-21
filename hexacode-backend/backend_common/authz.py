from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException

ROLE_CONTESTANT = "contestant"
ROLE_AUTHOR = "author"
ROLE_REVIEWER = "reviewer"
ROLE_MODERATOR = "moderator"
ROLE_ADMIN = "admin"

ROLE_CODES = {
    ROLE_CONTESTANT,
    ROLE_AUTHOR,
    ROLE_REVIEWER,
    ROLE_MODERATOR,
    ROLE_ADMIN,
}
MANAGEABLE_ROLE_CODES = {
    ROLE_AUTHOR,
    ROLE_REVIEWER,
    ROLE_MODERATOR,
    ROLE_ADMIN,
}

PERM_PROBLEM_READ_PUBLIC = "problem.read_public"
PERM_SUBMISSION_CREATE = "submission.create"
PERM_SUBMISSION_READ_OWN = "submission.read_own"
PERM_SUBMISSION_READ_PUBLIC_SUMMARY = "submission.read_public_summary"
PERM_SUBMISSION_READ_PUBLIC_DETAIL = "submission.read_public_detail"

PERM_PROBLEM_CREATE = "problem.create"
PERM_PROBLEM_READ_OWN_DASHBOARD = "problem.read_own_dashboard"
PERM_PROBLEM_UPDATE_OWN_DRAFT = "problem.update_own_draft"
PERM_PROBLEM_DELETE_OWN_DRAFT = "problem.delete_own_draft"
PERM_PROBLEM_REQUEST_REVIEW_OWN = "problem.request_review_own"
PERM_PROBLEM_ARCHIVE_OWN = "problem.archive_own"
PERM_TESTSET_MANAGE_OWN = "testset.manage_own"
PERM_TAG_READ_DASHBOARD = "tag.read_dashboard"

PERM_PROBLEM_READ_REVIEW_QUEUE = "problem.read_review_queue"
PERM_PROBLEM_REVIEW = "problem.review"
PERM_PROBLEM_PUBLISH = "problem.publish"
PERM_PROBLEM_UNPUBLISH = "problem.unpublish"
PERM_PROBLEM_ARCHIVE_ANY = "problem.archive_any"
PERM_TAG_CREATE = "tag.create"
PERM_TAG_UPDATE = "tag.update"
PERM_TAG_LIFECYCLE = "tag.lifecycle"
PERM_TAG_DELETE = "tag.delete"

PERM_USER_READ_DIRECTORY = "user.read_directory"
PERM_USER_DISABLE = "user.disable"
PERM_USER_ENABLE = "user.enable"
PERM_ROLE_GRANT = "role.grant"
PERM_ROLE_REVOKE = "role.revoke"
PERM_OPS_READ_DASHBOARD = "ops.read_dashboard"
PERM_OPS_MANAGE_STORAGE_ORPHANS = "ops.manage_storage_orphans"
PERM_OPS_READ_WORKER_STATE = "ops.read_worker_state"
PERM_OPS_READ_QUEUE_STATE = "ops.read_queue_state"

PERM_ADMIN_FULL = "admin.full"

LEGACY_GROUP_ROLE_MAP = {
    "author": ROLE_AUTHOR,
    "authors": ROLE_AUTHOR,
    "reviewer": ROLE_REVIEWER,
    "moderator": ROLE_MODERATOR,
    "admin": ROLE_ADMIN,
}


def normalized_codes(values: Iterable[str] | None) -> tuple[str, ...]:
    if values is None:
        return ()
    normalized = {str(value).strip().lower() for value in values if str(value).strip()}
    return tuple(sorted(normalized))


def bootstrap_role_codes(groups: Iterable[str] | None) -> tuple[str, ...]:
    seeded = {ROLE_CONTESTANT}
    for group in normalized_codes(groups):
        role_code = LEGACY_GROUP_ROLE_MAP.get(group)
        if role_code:
            seeded.add(role_code)
    return tuple(sorted(seeded))


def sync_default_role_assignments(cursor: Any, user_id: str, groups: Iterable[str] | None) -> None:
    for role_code in bootstrap_role_codes(groups):
        cursor.execute(
            """
            insert into app_identity.user_role_assignments (user_id, role_code)
            values (%s::uuid, %s)
            on conflict (user_id, role_code) do nothing
            """,
            (user_id, role_code),
        )


def load_local_user_authz(cursor: Any, user_id: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    cursor.execute(
        """
        select
          coalesce(
            array_agg(distinct assignments.role_code order by assignments.role_code)
              filter (where assignments.role_code is not null),
            '{}'::text[]
          ) as role_codes,
          coalesce(
            array_agg(distinct role_permissions.permission_code order by role_permissions.permission_code)
              filter (where role_permissions.permission_code is not null),
            '{}'::text[]
          ) as permission_codes
        from app_identity.user_role_assignments as assignments
        left join app_identity.role_permissions
          on role_permissions.role_code = assignments.role_code
        where assignments.user_id = %s::uuid
        """,
        (user_id,),
    )
    row = cursor.fetchone()
    if row is None:
        return (), ()
    return normalized_codes(row["role_codes"]), normalized_codes(row["permission_codes"])


def local_user_has_role(local_user: dict[str, Any], role_code: str) -> bool:
    return role_code in set(local_user.get("roles", ()))


def local_user_has_permission(local_user: dict[str, Any], permission_code: str) -> bool:
    permissions = set(local_user.get("permissions", ()))
    return PERM_ADMIN_FULL in permissions or permission_code in permissions


def local_user_has_any_permission(local_user: dict[str, Any], permission_codes: Iterable[str]) -> bool:
    return any(local_user_has_permission(local_user, permission_code) for permission_code in permission_codes)


def require_local_permission(local_user: dict[str, Any], permission_code: str, *, detail: str) -> None:
    if not local_user_has_permission(local_user, permission_code):
        raise HTTPException(status_code=403, detail=detail)


def require_local_any_permission(
    local_user: dict[str, Any],
    permission_codes: Iterable[str],
    *,
    detail: str,
) -> None:
    if not local_user_has_any_permission(local_user, permission_codes):
        raise HTTPException(status_code=403, detail=detail)


def normalize_manageable_role_code(role_code: str) -> str:
    normalized = str(role_code or "").strip().lower()
    if normalized not in MANAGEABLE_ROLE_CODES:
        raise HTTPException(status_code=400, detail="Unsupported role code.")
    return normalized
