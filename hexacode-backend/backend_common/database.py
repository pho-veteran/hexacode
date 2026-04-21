from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

SCHEMA_LOCK_ID = 842351792


@contextmanager
def get_connection(database_url: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        yield connection


def apply_sql_schema(database_url: str, schema_path: Path) -> list[str]:
    if not database_url or not schema_path.exists():
        return []

    sql_text = schema_path.read_text(encoding="utf-8").strip()
    if not sql_text:
        return []

    with psycopg.connect(database_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select pg_advisory_lock(%s)", (SCHEMA_LOCK_ID,))
            try:
                cursor.execute(sql_text)
            finally:
                cursor.execute("select pg_advisory_unlock(%s)", (SCHEMA_LOCK_ID,))

    return [schema_path.name]
