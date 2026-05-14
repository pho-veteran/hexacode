from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "promote_admin.py"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

spec = importlib.util.spec_from_file_location("promote_admin", SCRIPT_PATH)
promote_admin = importlib.util.module_from_spec(spec)
assert spec is not None and spec.loader is not None
sys.modules["promote_admin"] = promote_admin
spec.loader.exec_module(promote_admin)


class FakeCursor:
    def __init__(self, user_row: dict[str, str] | None = None) -> None:
        self.user_row = user_row
        self.executed: list[tuple[str, tuple[object, ...]]] = []
        self.fetchone_calls = 0

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.executed.append((query, params))

    def fetchone(self) -> dict[str, str] | None:
        self.fetchone_calls += 1
        return self.user_row


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self, *args, **kwargs) -> FakeCursor:
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class PromoteAdminTest(unittest.TestCase):
    def test_promotes_user_by_username_idempotently(self) -> None:
        cursor = FakeCursor({"id": "user-1", "username": "ada"})
        connection = FakeConnection(cursor)

        with patch.object(promote_admin.psycopg, "connect", return_value=connection) as connect:
            result = promote_admin.promote_admin(
                "postgresql://example",
                username="ada",
                granted_by_user_id=None,
            )

        connect.assert_called_once_with("postgresql://example", row_factory=promote_admin.dict_row)
        self.assertEqual(
            {
                "promoted": True,
                "role_code": "admin",
                "user": {"id": "user-1", "username": "ada"},
            },
            result,
        )
        self.assertEqual(1, connection.commits)
        self.assertEqual(2, len(cursor.executed))
        self.assertIn("where lower(username) = lower(%s)", cursor.executed[0][0])
        self.assertEqual(("ada",), cursor.executed[0][1])
        self.assertIn("on conflict (user_id, role_code)", cursor.executed[1][0])
        self.assertEqual(("user-1", "admin", None), cursor.executed[1][1])

    def test_promotes_user_by_cognito_sub_with_granter(self) -> None:
        cursor = FakeCursor({"id": "user-2", "username": "grace"})
        connection = FakeConnection(cursor)

        with patch.object(promote_admin.psycopg, "connect", return_value=connection):
            promote_admin.promote_admin(
                "postgresql://example",
                cognito_sub="sub-123",
                granted_by_user_id="admin-user",
            )

        self.assertIn("where cognito_sub = %s", cursor.executed[0][0])
        self.assertEqual(("sub-123",), cursor.executed[0][1])
        self.assertEqual(("user-2", "admin", "admin-user"), cursor.executed[1][1])

    def test_requires_exactly_one_user_selector(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly one"):
            promote_admin.promote_admin("postgresql://example", username="ada", user_id="user-1")

        with self.assertRaisesRegex(ValueError, "exactly one"):
            promote_admin.promote_admin("postgresql://example")

    def test_raises_when_user_is_not_found(self) -> None:
        cursor = FakeCursor(None)
        connection = FakeConnection(cursor)

        with patch.object(promote_admin.psycopg, "connect", return_value=connection):
            with self.assertRaisesRegex(LookupError, "No local user found"):
                promote_admin.promote_admin("postgresql://example", email="ada@example.com")

        self.assertEqual(0, connection.commits)


if __name__ == "__main__":
    unittest.main()
