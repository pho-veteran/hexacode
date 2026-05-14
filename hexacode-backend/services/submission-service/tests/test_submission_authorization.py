from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

TEST_PATH = Path(__file__).resolve()
if len(TEST_PATH.parents) > 3:
    sys.path.insert(0, str(TEST_PATH.parents[3]))
if len(TEST_PATH.parents) > 1:
    sys.path.insert(0, str(TEST_PATH.parents[1]))

from backend_common.auth import AuthContext  # noqa: E402
from backend_common.authz import (  # noqa: E402
    PERM_ADMIN_FULL,
    PERM_OPS_READ_DASHBOARD,
    PERM_SUBMISSION_READ_PUBLIC_DETAIL,
    PERM_SUBMISSION_READ_PUBLIC_SUMMARY,
)
from app import main  # noqa: E402


class SubmissionAuthorizationTest(unittest.IsolatedAsyncioTestCase):
    def actor(self) -> AuthContext:
        return AuthContext(
            cognito_sub="sub-1",
            username="alice",
            email="alice@example.com",
            groups=(),
            token_use="access",
            claims={},
        )

    def local_user(self, user_id: str, permissions: tuple[str, ...]) -> dict[str, object]:
        return {"id": user_id, "roles": ("contestant",), "permissions": permissions}

    def submission(self) -> dict[str, object]:
        return {"id": "submission-1", "user_id": "owner-1", "status": "accepted"}

    def results_payload(self) -> dict[str, object]:
        return {"submission_id": "submission-1", "user_id": "owner-1", "results": [{"status_code": "accepted"}]}

    async def test_non_owner_with_default_contestant_submission_permissions_cannot_read_detail(self) -> None:
        permissions = (PERM_SUBMISSION_READ_PUBLIC_SUMMARY, PERM_SUBMISSION_READ_PUBLIC_DETAIL)

        with (
            patch.object(main, "ensure_local_actor", return_value=self.local_user("other-user", permissions)),
            patch.object(main, "get_submission_row", return_value=self.submission()),
        ):
            with self.assertRaises(HTTPException) as raised:
                await main.get_submission("submission-1", self.actor())

        self.assertEqual(403, raised.exception.status_code)

    async def test_owner_can_read_detail_without_privileged_permission(self) -> None:
        with (
            patch.object(main, "ensure_local_actor", return_value=self.local_user("owner-1", ())),
            patch.object(main, "get_submission_row", return_value=self.submission()),
        ):
            response = await main.get_submission("submission-1", self.actor())

        self.assertEqual({"id": "submission-1", "status": "accepted"}, response["data"])
        self.assertNotIn("user_id", response["data"])

    async def test_ops_user_can_read_non_owner_detail(self) -> None:
        with (
            patch.object(main, "ensure_local_actor", return_value=self.local_user("ops-user", (PERM_OPS_READ_DASHBOARD,))),
            patch.object(main, "get_submission_row", return_value=self.submission()),
        ):
            response = await main.get_submission("submission-1", self.actor())

        self.assertEqual({"id": "submission-1", "status": "accepted"}, response["data"])
        self.assertNotIn("user_id", response["data"])

    async def test_non_owner_with_default_contestant_submission_permissions_cannot_read_results(self) -> None:
        permissions = (PERM_SUBMISSION_READ_PUBLIC_SUMMARY, PERM_SUBMISSION_READ_PUBLIC_DETAIL)

        with (
            patch.object(main, "ensure_local_actor", return_value=self.local_user("other-user", permissions)),
            patch.object(main, "get_submission_results_payload", return_value=self.results_payload()),
        ):
            with self.assertRaises(HTTPException) as raised:
                await main.get_submission_results("submission-1", self.actor())

        self.assertEqual(403, raised.exception.status_code)

    async def test_owner_can_read_results_without_privileged_permission(self) -> None:
        payload = self.results_payload()

        with (
            patch.object(main, "ensure_local_actor", return_value=self.local_user("owner-1", ())),
            patch.object(main, "get_submission_results_payload", return_value=payload),
        ):
            response = await main.get_submission_results("submission-1", self.actor())

        self.assertEqual({"submission_id": "submission-1", "results": payload["results"]}, response["data"])

    async def test_admin_user_can_read_non_owner_results(self) -> None:
        payload = self.results_payload()

        with (
            patch.object(main, "ensure_local_actor", return_value=self.local_user("admin-user", (PERM_ADMIN_FULL,))),
            patch.object(main, "get_submission_results_payload", return_value=payload),
        ):
            response = await main.get_submission_results("submission-1", self.actor())

        self.assertEqual({"submission_id": "submission-1", "results": payload["results"]}, response["data"])


class SubmissionRouteAuthorizationTest(unittest.TestCase):
    def test_submission_detail_route_rejects_missing_bearer_token(self) -> None:
        client = TestClient(main.app)

        response = client.get("/api/submissions/submission-1")

        self.assertEqual(401, response.status_code)

    def test_submission_results_route_rejects_missing_bearer_token(self) -> None:
        client = TestClient(main.app)

        response = client.get("/api/submissions/submission-1/results")

        self.assertEqual(401, response.status_code)


if __name__ == "__main__":
    unittest.main()
