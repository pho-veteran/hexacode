from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

EXPOSED_HEADERS = [
    "content-disposition",
    "x-correlation-id",
]


def load_cors_allowed_origins() -> list[str]:
    raw_value = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
    if not raw_value:
        return ["*"]

    origins = [value.strip() for value in raw_value.split(",") if value.strip()]
    if not origins or "*" in origins:
        return ["*"]
    return origins


def install_cors(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=load_cors_allowed_origins(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=EXPOSED_HEADERS,
        max_age=300,
    )
