from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

TEST_PATH = Path(__file__).resolve()
if len(TEST_PATH.parents) > 3:
    sys.path.insert(0, str(TEST_PATH.parents[3]))
if len(TEST_PATH.parents) > 1:
    sys.path.insert(0, str(TEST_PATH.parents[1]))

from backend_common.settings import StorageSettings  # noqa: E402
from backend_common.storage import download_object_bytes  # noqa: E402
from app import main  # noqa: E402


class WorkerEfsArtifactTest(unittest.TestCase):
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

    def test_persist_worker_artifact_writes_efs_bytes_and_returns_descriptor(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            settings = SimpleNamespace(storage=self.settings(root))

            with patch.object(main, "SETTINGS", settings):
                descriptor = main.persist_worker_artifact(
                    submission_id="submission-1",
                    relative_path="runs/run-1/testcases/case-1/stdout.txt",
                    artifact_kind="stdout",
                    data=b"accepted\n",
                )
                stored_bytes = download_object_bytes(
                    settings.storage,
                    bucket="submissions",
                    object_key="submissions/submission-1/runs/run-1/testcases/case-1/stdout.txt",
                )

            self.assertIsNotNone(descriptor)
            assert descriptor is not None
            self.assertEqual("submissions", descriptor["bucket"])
            self.assertEqual(
                "submissions/submission-1/runs/run-1/testcases/case-1/stdout.txt",
                descriptor["object_key"],
            )
            self.assertEqual("stdout.txt", descriptor["original_filename"])
            self.assertEqual(9, descriptor["size_bytes"])
            self.assertEqual("stdout", descriptor["metadata_json"]["artifact_kind"])
            self.assertEqual(b"accepted\n", stored_bytes)

    def test_attach_result_artifacts_adds_stdout_and_stderr_descriptors(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            settings = SimpleNamespace(storage=self.settings(root))

            with patch.object(main, "SETTINGS", settings):
                result = main.attach_result_artifacts(
                    submission_id="submission-1",
                    result={"status_code": "wa"},
                    output_prefix="runs/run-1/testcases/case-1",
                    stdout_bytes=b"actual\n",
                    stderr_bytes=b"trace\n",
                )

            self.assertEqual("wa", result["status_code"])
            self.assertEqual("stdout", result["stdout_artifact"]["metadata_json"]["artifact_kind"])
            self.assertEqual("stderr", result["stderr_artifact"]["metadata_json"]["artifact_kind"])


if __name__ == "__main__":
    unittest.main()
