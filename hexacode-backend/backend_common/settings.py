from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value.strip())
    except ValueError:
        return default


@dataclass(frozen=True)
class CognitoSettings:
    user_pool_id: str
    app_client_id: str
    issuer: str
    jwks_url: str
    jwt_leeway_seconds: int


@dataclass(frozen=True)
class StorageSettings:
    driver: str
    endpoint: str
    region: str
    access_key_id: str
    secret_access_key: str
    force_path_style: bool
    problems_bucket: str
    submissions_bucket: str


@dataclass(frozen=True)
class QueueSettings:
    driver: str
    endpoint: str
    judge_queue_url: str

    @property
    def judge_queue_name(self) -> str:
        if "/" in self.judge_queue_url:
            return self.judge_queue_url.rsplit("/", 1)[-1]
        return self.judge_queue_url


@dataclass(frozen=True)
class RedisSettings:
    url: str


@dataclass(frozen=True)
class ServiceSettings:
    service_name: str
    log_level: str
    database_url: str
    cognito: CognitoSettings
    redis: RedisSettings
    storage: StorageSettings
    queue: QueueSettings


def load_service_settings(service_name: str) -> ServiceSettings:
    return ServiceSettings(
        service_name=service_name,
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        database_url=os.getenv("DATABASE_URL", ""),
        cognito=CognitoSettings(
            user_pool_id=os.getenv("COGNITO_USER_POOL_ID", ""),
            app_client_id=os.getenv("COGNITO_APP_CLIENT_ID", ""),
            issuer=os.getenv("COGNITO_ISSUER", ""),
            jwks_url=os.getenv("COGNITO_JWKS_URL", ""),
            jwt_leeway_seconds=_env_int("COGNITO_JWT_LEEWAY_SECONDS", 60),
        ),
        redis=RedisSettings(
            url=os.getenv("REDIS_URL", ""),
        ),
        storage=StorageSettings(
            driver=os.getenv("STORAGE_DRIVER", "s3"),
            endpoint=os.getenv("S3_ENDPOINT", ""),
            region=os.getenv("S3_REGION", "us-east-1"),
            access_key_id=os.getenv("S3_ACCESS_KEY_ID", ""),
            secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY", ""),
            force_path_style=_env_bool("S3_FORCE_PATH_STYLE", default=False),
            problems_bucket=os.getenv("S3_BUCKET_PROBLEMS", ""),
            submissions_bucket=os.getenv("S3_BUCKET_SUBMISSIONS", ""),
        ),
        queue=QueueSettings(
            driver=os.getenv("QUEUE_DRIVER", "sqs"),
            endpoint=os.getenv("SQS_ENDPOINT", ""),
            judge_queue_url=os.getenv("SQS_JUDGE_QUEUE_URL", ""),
        ),
    )
