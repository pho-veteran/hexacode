from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from psycopg.types.json import Json

TEST_PATH = Path(__file__).resolve()
if len(TEST_PATH.parents) > 3:
    sys.path.insert(0, str(TEST_PATH.parents[3]))
if len(TEST_PATH.parents) > 1:
    sys.path.insert(0, str(TEST_PATH.parents[1]))

from backend_common.settings import StorageSettings  # noqa: E402
from backend_common.storage import (  # noqa: E402
    download_object_bytes,
    resolve_efs_object_path,
    upload_object_bytes,
)
from app import main  # noqa: E402


class RecordingCursor:
    def __init__(self) -> None:
        self.sql = ""
        self.params = ()

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        self.sql = sql
        self.params = params

    def fetchone(self) -> dict[str, str]:
        return {"id": "object-1"}


class EfsStorageTest(unittest.TestCase):
    def settings(self, root: str) -> StorageSettings:
        return StorageSettings(
            driver="efs",
            endpoint="",
            region="us-west-2",
            access_key_id="",
            secret_access_key="",
            force_path_style=False,
            problems_bucket="problems",
            submissions_bucket="submissions",
            artifact_storage_root=root,
        )

    def test_resolve_efs_object_path_rejects_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                resolve_efs_object_path(root, "submissions", "../escape.txt")

    def test_efs_upload_download_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            settings = self.settings(root)

            upload = upload_object_bytes(
                settings,
                bucket="submissions",
                object_key="submissions/submission-1/source/source.txt",
                data=b"print(42)\n",
                content_type="text/plain; charset=utf-8",
            )
            downloaded = download_object_bytes(
                settings,
                bucket="submissions",
                object_key="submissions/submission-1/source/source.txt",
            )

            self.assertEqual({"etag": None}, upload)
            self.assertEqual(b"print(42)\n", downloaded)


class ArtifactDescriptorRegistrationTest(unittest.TestCase):
    def test_register_descriptor_records_efs_metadata(self) -> None:
        cursor = RecordingCursor()
        settings = SimpleNamespace(
            storage=StorageSettings(
                driver="efs",
                endpoint="",
                region="us-west-2",
                access_key_id="",
                secret_access_key="",
                force_path_style=False,
                problems_bucket="problems",
                submissions_bucket="submissions",
                artifact_storage_root="/mnt/submission-artifacts",
            )
        )

        with patch.object(main, "SETTINGS", settings):
            object_id = main.register_artifact_descriptor(
                cursor,
                {
                    "bucket": "submissions",
                    "object_key": "submissions/submission-1/runs/run-1/testcases/case-1/stdout.txt",
                    "content_type": "text/plain; charset=utf-8",
                    "original_filename": "stdout.txt",
                    "size_bytes": 6,
                    "sha256": "sha256-value",
                    "etag": None,
                    "metadata_json": {"artifact_kind": "stdout"},
                },
                artifact_kind="stdout",
            )

        self.assertEqual("object-1", object_id)
        self.assertEqual("efs", cursor.params[7])
        self.assertEqual(
            str(Path("/mnt/submission-artifacts/submissions/submissions/submission-1/runs/run-1/testcases/case-1/stdout.txt")),
            cursor.params[8],
        )
        self.assertEqual("stdout", cursor.params[9])
        self.assertIsInstance(cursor.params[10], Json)


if __name__ == "__main__":
    unittest.main()
