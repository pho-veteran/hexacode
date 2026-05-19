from __future__ import annotations
from typing import Any
import json

def record_audit_event(
    cursor: Any,
    *,
    actor_user_id: str,
    action: str,
    target_type: str,
    target_id: str,
    details: dict | None = None,
) -> None:
    cursor.execute(
        """
        INSERT INTO app_identity.audit_log (actor_user_id, action, target_type, target_id, details)
        VALUES (%s::uuid, %s, %s, %s, %s::jsonb)
        """,
        (actor_user_id, action, target_type, target_id, json.dumps(details) if details else None),
    )
