from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from psycopg.rows import dict_row

from backend_common.auth import AuthContext, require_authenticated_user
from backend_common.authz import (
    PERM_ADMIN_FULL,
    PERM_ROLE_GRANT,
    PERM_ROLE_REVOKE,
    PERM_USER_DISABLE,
    PERM_USER_ENABLE,
    PERM_USER_READ_DIRECTORY,
    ROLE_ADMIN,
    local_user_has_permission,
    normalize_manageable_role_code,
    require_local_permission,
)
from backend_common.bootstrap import bootstrap_service
from backend_common.database import get_connection
from backend_common.errors import install_exception_handlers
from backend_common.identity import ensure_local_user
from backend_common.settings import load_service_settings

SETTINGS = load_service_settings("identity-service")
BOOTSTRAP_SUMMARY: dict[str, Any] = {}
USER_STATUS_CODES = {"active", "disabled"}


def ensure_local_actor(actor: AuthContext) -> dict[str, Any]:
    return ensure_local_user(
        SETTINGS.database_url,
        actor.cognito_sub,
        username=actor.username,
        bootstrap_groups=actor.groups,
    )


def build_current_actor_payload(actor: AuthContext, local_user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": local_user["id"],
        "cognito_sub": actor.cognito_sub,
        "username": actor.username,
        "email": actor.email,
        "groups": list(actor.groups),
        "token_use": actor.token_use,
        "roles": local_user["roles"],
        "permissions": local_user["permissions"],
        "status_code": local_user["status_code"],
        "is_admin": local_user["is_admin"],
        "is_disabled": local_user["is_disabled"],
    }


def list_local_user_rows() -> list[dict[str, Any]]:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  users.id::text as id,
                  users.cognito_sub,
                  coalesce(users.username, users.cognito_sub) as username,
                  users.status_code,
                  users.created_at,
                  users.updated_at,
                  coalesce(role_assignments.roles, '{}'::text[]) as roles,
                  coalesce(problem_counts.problem_count, 0) as problem_count,
                  coalesce(submission_counts.submission_count, 0) as submission_count
                from app_identity.users as users
                left join lateral (
                  select array_agg(assignments.role_code order by assignments.role_code) as roles
                  from app_identity.user_role_assignments as assignments
                  where assignments.user_id = users.id
                ) as role_assignments on true
                left join lateral (
                  select count(*)::int as problem_count
                  from problem.problems
                  where created_by_user_id = users.id
                ) as problem_counts on true
                left join lateral (
                  select count(*)::int as submission_count
                  from submission.submissions
                  where user_id = users.id
                ) as submission_counts on true
                order by users.updated_at desc, users.created_at desc
                """
            )
            return [dict(row) for row in cursor.fetchall()]


def get_local_user_row(user_id: str) -> dict[str, Any] | None:
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                select
                  users.id::text as id,
                  users.cognito_sub,
                  coalesce(users.username, users.cognito_sub) as username,
                  users.status_code,
                  users.created_at,
                  users.updated_at,
                  coalesce(role_assignments.roles, '{}'::text[]) as roles,
                  coalesce(problem_counts.problem_count, 0) as problem_count,
                  coalesce(submission_counts.submission_count, 0) as submission_count
                from app_identity.users as users
                left join lateral (
                  select array_agg(assignments.role_code order by assignments.role_code) as roles
                  from app_identity.user_role_assignments as assignments
                  where assignments.user_id = users.id
                ) as role_assignments on true
                left join lateral (
                  select count(*)::int as problem_count
                  from problem.problems
                  where created_by_user_id = users.id
                ) as problem_counts on true
                left join lateral (
                  select count(*)::int as submission_count
                  from submission.submissions
                  where user_id = users.id
                ) as submission_counts on true
                where users.id = %s::uuid
                """,
                (user_id,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None


def update_local_user_status(user_id: str, status_code: str, actor: AuthContext) -> dict[str, Any]:
    normalized_status = str(status_code or "").strip().lower()
    if normalized_status not in USER_STATUS_CODES:
        raise HTTPException(status_code=400, detail="status_code must be 'active' or 'disabled'.")

    local_user = ensure_local_actor(actor)
    required_permission = PERM_USER_ENABLE if normalized_status == "active" else PERM_USER_DISABLE
    require_local_permission(
        local_user,
        required_permission,
        detail="Moderator permissions are required for user moderation.",
    )
    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                update app_identity.users
                set
                  status_code = %s,
                  updated_at = now()
                where id = %s::uuid
                """,
                (normalized_status, user_id),
            )
        connection.commit()

    user_row = get_local_user_row(user_id)
    if user_row is None:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' was not found.")
    return user_row


def assign_local_user_role(user_id: str, role_code: str, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_ROLE_GRANT,
        detail="Moderator permissions are required to grant roles.",
    )
    normalized_role = normalize_manageable_role_code(role_code)
    if normalized_role == ROLE_ADMIN and not local_user_has_permission(local_user, PERM_ADMIN_FULL):
        raise HTTPException(status_code=403, detail="Admin permissions are required to grant the admin role.")

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "select 1 from app_identity.users where id = %s::uuid",
                (user_id,),
            )
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail=f"User '{user_id}' was not found.")
            cursor.execute(
                """
                insert into app_identity.user_role_assignments (user_id, role_code, granted_by_user_id)
                values (%s::uuid, %s, %s::uuid)
                on conflict (user_id, role_code)
                do update set
                  granted_by_user_id = excluded.granted_by_user_id,
                  updated_at = now()
                """,
                (user_id, normalized_role, local_user["id"]),
            )
        connection.commit()

    user_row = get_local_user_row(user_id)
    if user_row is None:
        raise RuntimeError("Updated user could not be loaded after role assignment.")
    return user_row


def revoke_local_user_role(user_id: str, role_code: str, actor: AuthContext) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_ROLE_REVOKE,
        detail="Moderator permissions are required to revoke roles.",
    )
    normalized_role = normalize_manageable_role_code(role_code)
    if normalized_role == ROLE_ADMIN and not local_user_has_permission(local_user, PERM_ADMIN_FULL):
        raise HTTPException(status_code=403, detail="Admin permissions are required to revoke the admin role.")

    with get_connection(SETTINGS.database_url) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "select 1 from app_identity.users where id = %s::uuid",
                (user_id,),
            )
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail=f"User '{user_id}' was not found.")
            cursor.execute(
                """
                delete from app_identity.user_role_assignments
                where user_id = %s::uuid and role_code = %s
                """,
                (user_id, normalized_role),
            )
        connection.commit()

    user_row = get_local_user_row(user_id)
    if user_row is None:
        raise RuntimeError("Updated user could not be loaded after role revocation.")
    return user_row


@asynccontextmanager
async def lifespan(_: FastAPI):
    global BOOTSTRAP_SUMMARY
    BOOTSTRAP_SUMMARY = bootstrap_service(
        SETTINGS,
        apply_schema=True,
        ensure_storage_buckets=False,
        ensure_judge_queue=False,
    )
    yield


app = FastAPI(
    title="Hexacode Identity Service",
    version="0.1.0",
    description="Platform identity, auth context, and RBAC management for Hexacode.",
    lifespan=lifespan,
)
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
        "schema_files": BOOTSTRAP_SUMMARY.get("schema_files", []),
    }


@app.get("/api/auth/me")
async def get_current_actor(
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    return {"data": build_current_actor_payload(actor, local_user), "meta": {"source": SETTINGS.service_name}}


@app.get("/api/dashboard/users")
async def list_dashboard_users(
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    local_user = ensure_local_actor(actor)
    require_local_permission(
        local_user,
        PERM_USER_READ_DIRECTORY,
        detail="Moderator permissions are required for user moderation.",
    )
    users = list_local_user_rows()
    return {"data": users, "meta": {"source": SETTINGS.service_name, "count": len(users)}}


@app.post("/api/dashboard/users/{user_id}/actions/{action}")
async def transition_dashboard_user(
    user_id: str,
    action: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    normalized_action = str(action or "").strip().lower()
    if normalized_action not in {"enable", "disable"}:
        raise HTTPException(status_code=400, detail="Unsupported user action.")
    status_code = "active" if normalized_action == "enable" else "disabled"
    return {
        "data": update_local_user_status(user_id, status_code, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.post("/api/dashboard/users/{user_id}/roles/{role_code}")
async def grant_dashboard_user_role(
    user_id: str,
    role_code: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": assign_local_user_role(user_id, role_code, actor),
        "meta": {"source": SETTINGS.service_name},
    }


@app.delete("/api/dashboard/users/{user_id}/roles/{role_code}")
async def revoke_dashboard_user_role(
    user_id: str,
    role_code: str,
    actor: AuthContext = require_authenticated_user(SETTINGS),
) -> dict[str, Any]:
    return {
        "data": revoke_local_user_role(user_id, role_code, actor),
        "meta": {"source": SETTINGS.service_name},
    }
