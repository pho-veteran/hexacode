from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

ROLE_ADMIN = "admin"
SELECTORS = ("user_id", "username", "email", "cognito_sub")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Promote an existing local Hexacode user to admin.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", ""), help="PostgreSQL connection URL.")
    parser.add_argument("--user-id", help="Local app_identity.users.id value.")
    parser.add_argument("--username", help="Local app_identity.users.username value.")
    parser.add_argument("--email", help="Local app_identity.users.email value.")
    parser.add_argument("--cognito-sub", help="Local app_identity.users.cognito_sub value.")
    parser.add_argument("--granted-by-user-id", help="Optional local admin user ID recorded as the grantor.")
    parser.add_argument("--json-out", help="Optional path to write result JSON.")
    return parser.parse_args()


def selected_user_filter(
    *,
    user_id: str | None = None,
    username: str | None = None,
    email: str | None = None,
    cognito_sub: str | None = None,
) -> tuple[str, str]:
    selectors = {
        "id": user_id,
        "username": username,
        "email": email,
        "cognito_sub": cognito_sub,
    }
    selected = [(column, value.strip()) for column, value in selectors.items() if value and value.strip()]
    if len(selected) != 1:
        raise ValueError("Provide exactly one user selector: --user-id, --username, --email, or --cognito-sub.")
    return selected[0]


def promote_admin(
    database_url: str,
    *,
    user_id: str | None = None,
    username: str | None = None,
    email: str | None = None,
    cognito_sub: str | None = None,
    granted_by_user_id: str | None = None,
) -> dict[str, Any]:
    if not database_url:
        raise ValueError("DATABASE_URL is required.")

    column, value = selected_user_filter(
        user_id=user_id,
        username=username,
        email=email,
        cognito_sub=cognito_sub,
    )

    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select column_name
                from information_schema.columns
                where table_schema = 'app_identity'
                  and table_name = 'users'
                """
            )
            available_columns = {row["column_name"] for row in cursor.fetchall()}
            if column not in available_columns:
                raise LookupError(f"No local user column found for {column} lookup.")

            selected_columns = ["id::text as id", "username", "cognito_sub"]
            if "email" in available_columns:
                selected_columns.insert(2, "email")

            comparator = f"lower({column}) = lower(%s)" if column in {"username", "email"} else f"{column} = %s"
            cursor.execute(
                f"""
                select {', '.join(selected_columns)}
                from app_identity.users
                where {comparator}
                """,
                (value,),
            )
            user_row = cursor.fetchone()
            if user_row is None:
                raise LookupError(f"No local user found for {column}={value!r}.")

            cursor.execute(
                """
                insert into app_identity.user_role_assignments (user_id, role_code, granted_by_user_id)
                values (%s::uuid, %s, %s::uuid)
                on conflict (user_id, role_code)
                do update set
                  granted_by_user_id = excluded.granted_by_user_id,
                  updated_at = now()
                """,
                (user_row["id"], ROLE_ADMIN, granted_by_user_id),
            )
        connection.commit()

    return {
        "promoted": True,
        "role_code": ROLE_ADMIN,
        "user": dict(user_row),
    }


def main() -> int:
    args = parse_args()
    result = promote_admin(
        args.database_url,
        user_id=args.user_id,
        username=args.username,
        email=args.email,
        cognito_sub=args.cognito_sub,
        granted_by_user_id=args.granted_by_user_id,
    )
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
