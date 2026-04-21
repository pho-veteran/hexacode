from __future__ import annotations

import logging
from typing import Any

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError

from backend_common.settings import StorageSettings

logger = logging.getLogger("hexacode.storage")


def build_s3_client(settings: StorageSettings) -> BaseClient:
    config = Config(
        signature_version="s3v4",
        s3={"addressing_style": "path" if settings.force_path_style else "virtual"},
    )
    return boto3.client(
        "s3",
        endpoint_url=settings.endpoint or None,
        region_name=settings.region or None,
        aws_access_key_id=settings.access_key_id or None,
        aws_secret_access_key=settings.secret_access_key or None,
        config=config,
    )


def ensure_buckets(settings: StorageSettings) -> list[str]:
    if settings.driver != "s3":
        return []

    client = build_s3_client(settings)
    bucket_names = [
        bucket_name
        for bucket_name in [settings.problems_bucket, settings.submissions_bucket]
        if bucket_name
    ]

    ensured: list[str] = []
    for bucket_name in bucket_names:
        try:
            client.head_bucket(Bucket=bucket_name)
        except ClientError:
            create_kwargs = {"Bucket": bucket_name}
            if not settings.endpoint and settings.region and settings.region != "us-east-1":
                create_kwargs["CreateBucketConfiguration"] = {
                    "LocationConstraint": settings.region
                }
            client.create_bucket(**create_kwargs)
            logger.info("created storage bucket", extra={"bucket_name": bucket_name})
        ensured.append(bucket_name)
    return ensured


def upload_object_bytes(
    settings: StorageSettings,
    *,
    bucket: str,
    object_key: str,
    data: bytes,
    content_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, str | None]:
    if settings.driver != "s3":
        raise RuntimeError("Only the s3 storage driver is currently supported.")

    client = build_s3_client(settings)
    put_kwargs: dict[str, Any] = {
        "Bucket": bucket,
        "Key": object_key,
        "Body": data,
    }
    if content_type:
        put_kwargs["ContentType"] = content_type
    if metadata:
        put_kwargs["Metadata"] = {str(key): str(value) for key, value in metadata.items()}

    response = client.put_object(**put_kwargs)
    etag = response.get("ETag")
    return {"etag": etag.strip('"') if isinstance(etag, str) else None}


def download_object_bytes(
    settings: StorageSettings,
    *,
    bucket: str,
    object_key: str,
) -> bytes:
    if settings.driver != "s3":
        raise RuntimeError("Only the s3 storage driver is currently supported.")

    client = build_s3_client(settings)
    response = client.get_object(Bucket=bucket, Key=object_key)
    body = response["Body"]
    return body.read()


def delete_object(
    settings: StorageSettings,
    *,
    bucket: str,
    object_key: str,
) -> None:
    if settings.driver != "s3":
        return

    client = build_s3_client(settings)
    client.delete_object(Bucket=bucket, Key=object_key)
