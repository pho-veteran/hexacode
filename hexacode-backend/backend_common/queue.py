from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from backend_common.settings import QueueSettings


@dataclass(frozen=True)
class JudgeJobMessage:
    judge_job_id: str
    submission_id: str
    problem_id: str
    runtime_profile_key: str
    user_id: str
    trace_id: str
    submitted_at: str

    @classmethod
    def new(
        cls,
        *,
        judge_job_id: str,
        submission_id: str,
        problem_id: str,
        runtime_profile_key: str,
        user_id: str,
        trace_id: str,
    ) -> "JudgeJobMessage":
        return cls(
            judge_job_id=judge_job_id,
            submission_id=submission_id,
            problem_id=problem_id,
            runtime_profile_key=runtime_profile_key,
            user_id=user_id,
            trace_id=trace_id,
            submitted_at=datetime.now(UTC).isoformat(),
        )

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "JudgeJobMessage":
        return cls(
            judge_job_id=str(payload["judge_job_id"]),
            submission_id=str(payload["submission_id"]),
            problem_id=str(payload["problem_id"]),
            runtime_profile_key=str(payload["runtime_profile_key"]),
            user_id=str(payload["user_id"]),
            trace_id=str(payload["trace_id"]),
            submitted_at=str(payload["submitted_at"]),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())


class SQSJudgeQueue:
    def __init__(self, settings: QueueSettings) -> None:
        self.settings = settings
        self._client = boto3.client(
            "sqs",
            endpoint_url=settings.endpoint or None,
            region_name=_resolve_sqs_region(settings),
            aws_access_key_id="x" if settings.endpoint else None,
            aws_secret_access_key="x" if settings.endpoint else None,
            config=Config(retries={"max_attempts": 3, "mode": "standard"}),
        )

    def ensure_queue(self) -> str:
        queue_name = self.settings.judge_queue_name
        if not queue_name:
            raise RuntimeError("SQS_JUDGE_QUEUE_URL must be configured before queue bootstrap.")

        queue_url = self.settings.judge_queue_url
        if queue_url:
            try:
                self._client.get_queue_attributes(
                    QueueUrl=queue_url,
                    AttributeNames=["QueueArn"],
                )
                return queue_url
            except ClientError as exc:
                error_code = exc.response.get("Error", {}).get("Code", "")
                if error_code not in {
                    "AWS.SimpleQueueService.NonExistentQueue",
                    "QueueDoesNotExist",
                }:
                    raise

        response = self._client.create_queue(QueueName=queue_name)
        return response["QueueUrl"]

    def publish(self, message: JudgeJobMessage) -> dict[str, Any]:
        queue_url = self.ensure_queue()
        response = self._client.send_message(
            QueueUrl=queue_url,
            MessageBody=message.to_json(),
        )
        return {
            "queue_url": queue_url,
            "message_id": response["MessageId"],
            "md5_of_body": response.get("MD5OfMessageBody"),
        }

    def receive_messages(
        self,
        *,
        max_messages: int = 1,
        wait_seconds: int = 10,
        visibility_timeout: int = 30,
    ) -> list[dict[str, Any]]:
        queue_url = self.ensure_queue()
        response = self._client.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=max_messages,
            WaitTimeSeconds=wait_seconds,
            VisibilityTimeout=visibility_timeout,
        )
        return response.get("Messages", [])

    def delete_message(self, receipt_handle: str) -> None:
        self._client.delete_message(
            QueueUrl=self.ensure_queue(),
            ReceiptHandle=receipt_handle,
        )


def _resolve_sqs_region(settings: QueueSettings) -> str:
    queue_region = _extract_region_from_queue_url(settings.judge_queue_url)
    if queue_region:
        return queue_region
    return (
        os.getenv("AWS_REGION", "").strip()
        or os.getenv("AWS_DEFAULT_REGION", "").strip()
        or "us-east-1"
    )


def _extract_region_from_queue_url(queue_url: str) -> str | None:
    host = urlparse(queue_url).hostname or ""
    if not host:
        return None

    match = re.match(r"^sqs[.-]([a-z0-9-]+)\.(?:amazonaws\.com|api\.aws)$", host)
    if match:
        return match.group(1)
    return None
