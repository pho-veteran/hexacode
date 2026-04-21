from __future__ import annotations

from fastapi import HTTPException
from psycopg.rows import dict_row

import psycopg

from backend_common.authz import (
    PERM_ADMIN_FULL,
    load_local_user_authz,
    sync_default_role_assignments,
)


def ensure_local_user(
    database_url: str,
    cognito_sub: str,
    *,
    username: str | None = None,
    bootstrap_groups: tuple[str, ...] | list[str] | None = None,
) -> dict[str, object]:
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into app_identity.users (cognito_sub, username)
                values (%s, %s)
                on conflict (cognito_sub)
                do update set
                  username = coalesce(excluded.username, app_identity.users.username, app_identity.users.cognito_sub),
                  updated_at = now()
                returning id::text as id, cognito_sub, username, status_code
                """,
                (cognito_sub, username),
            )
            row = cursor.fetchone()
            if row is not None:
                sync_default_role_assignments(cursor, row["id"], bootstrap_groups)
                roles, permissions = load_local_user_authz(cursor, row["id"])
            else:
                roles, permissions = (), ()
        connection.commit()

    if row is None:
        raise RuntimeError("Unable to resolve a local user mapping for the Cognito subject.")
    if row["status_code"] == "disabled":
        raise HTTPException(status_code=403, detail="This account has been disabled.")
    return {
        "id": row["id"],
        "cognito_sub": row["cognito_sub"],
        "username": row["username"],
        "status_code": row["status_code"],
        "roles": list(roles),
        "permissions": list(permissions),
        "is_admin": PERM_ADMIN_FULL in permissions,
        "is_disabled": row["status_code"] == "disabled",
    }
