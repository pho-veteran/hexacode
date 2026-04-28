from __future__ import annotations

import argparse
import importlib
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_TARGET_STATUSES = {"draft", "pending_review", "approved", "published"}


def detect_runtime_layout() -> tuple[Path, Path | None, Path]:
    if (ROOT / "services" / "problem-service").exists() and (ROOT / "backend_common").exists():
        backend_root = ROOT
        service_root = backend_root / "services" / "problem-service"
        return backend_root.parent, backend_root, service_root
    if (ROOT / "hexacode-backend").exists():
        backend_root = ROOT / "hexacode-backend"
        service_root = backend_root / "services" / "problem-service"
        return ROOT, backend_root, service_root
    if (ROOT / "app").exists() and (ROOT / "backend_common").exists():
        return ROOT, None, ROOT
    raise RuntimeError("Unable to determine repository layout for problem catalog import.")


REPO_ROOT, BACKEND_ROOT, PROBLEM_SERVICE_ROOT = detect_runtime_layout()
DEFAULT_CATALOG_DIR = REPO_ROOT / "data" / "problems"
DEFAULT_ENV_FILE = (BACKEND_ROOT / ".env") if BACKEND_ROOT is not None else (REPO_ROOT / ".env")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import the curated problem catalog into Postgres and MinIO.",
    )
    parser.add_argument(
        "--catalog-dir",
        default=str(DEFAULT_CATALOG_DIR),
        help="Path to the root data/problems directory.",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Path to the backend env file used by problem-service.",
    )
    parser.add_argument(
        "--skip-env-file",
        action="store_true",
        help="Use the current process environment as-is and do not read an env file.",
    )
    parser.add_argument(
        "--skip-bootstrap",
        action="store_true",
        help="Skip schema and bucket bootstrap before import.",
    )
    parser.add_argument(
        "--reset-existing",
        action="store_true",
        help="Delete existing problem/submission catalog data and storage objects before importing.",
    )
    parser.add_argument(
        "--fail-on-existing",
        action="store_true",
        help="Fail if a problem slug from the catalog already exists.",
    )
    parser.add_argument(
        "--json-out",
        help="Optional path to write the import summary JSON.",
    )
    return parser.parse_args()


def load_env_file(env_file: Path) -> None:
    if not env_file.exists():
        raise FileNotFoundError(f"Env file not found: {env_file}")

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value.startswith(("\"", "'")) and value.endswith(("\"", "'")) and len(value) >= 2:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def ensure_backend_import_paths() -> None:
    candidate_paths = [str(PROBLEM_SERVICE_ROOT)]
    if BACKEND_ROOT is not None:
        candidate_paths.append(str(BACKEND_ROOT))
    for path in candidate_paths:
        if path not in sys.path:
            sys.path.insert(0, path)


def load_catalog(catalog_dir: Path) -> dict[str, Any]:
    catalog_path = catalog_dir / "catalog.json"
    if not catalog_path.exists():
        raise FileNotFoundError(f"Catalog file not found: {catalog_path}")
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Catalog payload must be a JSON object.")
    if not isinstance(payload.get("tags"), list):
        raise ValueError("Catalog payload must contain a 'tags' array.")
    if not isinstance(payload.get("problems"), list):
        raise ValueError("Catalog payload must contain a 'problems' array.")
    return payload


def require_file(path: Path, *, label: str) -> Path:
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"{label} not found: {path}")
    return path


def require_directory(path: Path, *, label: str) -> Path:
    if not path.exists() or not path.is_dir():
        raise FileNotFoundError(f"{label} not found: {path}")
    return path


def zip_testcase_directory(testcases_dir: Path) -> bytes:
    files = sorted(path for path in testcases_dir.rglob("*") if path.is_file())
    if not files:
        raise ValueError(f"No testcase files found in {testcases_dir}")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.writestr(path.relative_to(testcases_dir).as_posix(), path.read_bytes())
    return buffer.getvalue()


def normalize_sample_cases(problem_entry: dict[str, Any]) -> list[dict[str, Any]]:
    raw_cases = problem_entry.get("sample_cases") or []
    if not isinstance(raw_cases, list):
        raise ValueError("sample_cases must be an array when provided.")

    sample_cases: list[dict[str, Any]] = []
    for raw_case in raw_cases:
        if isinstance(raw_case, int):
            ordinal = raw_case
            note = None
        elif isinstance(raw_case, dict):
            if "ordinal" not in raw_case:
                raise ValueError("Each sample_cases entry must include an ordinal.")
            ordinal = int(raw_case["ordinal"])
            note = raw_case.get("note")
        else:
            raise ValueError("sample_cases entries must be integers or objects.")

        if ordinal <= 0:
            raise ValueError("sample case ordinals must be positive integers.")
        sample_cases.append(
            {
                "ordinal": ordinal,
                "note": str(note).strip() if note is not None else None,
            }
        )

    return sample_cases


def build_seed_actor(auth_module: Any) -> Any:
    return auth_module.AuthContext(
        cognito_sub="catalog-importer-admin",
        username="catalog-importer-admin",
        email=None,
        groups=("admin",),
        token_use="access",
        claims={
            "sub": "catalog-importer-admin",
            "cognito:username": "catalog-importer-admin",
            "cognito:groups": ["admin"],
        },
    )


def sync_tags(catalog: dict[str, Any], *, problem_main: Any, database_module: Any, actor: Any) -> int:
    local_user = problem_main.ensure_local_actor(actor)
    count = 0
    with database_module.get_connection(problem_main.SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            for raw_tag in catalog["tags"]:
                cursor.execute(
                    """
                    insert into problem.tags (
                      slug,
                      name,
                      description,
                      color,
                      icon,
                      is_active,
                      created_by_user_id,
                      updated_by_user_id
                    )
                    values (%s, %s, %s, %s, %s, true, %s::uuid, %s::uuid)
                    on conflict ((lower(slug)))
                    do update set
                      name = excluded.name,
                      description = excluded.description,
                      color = excluded.color,
                      icon = excluded.icon,
                      is_active = true,
                      updated_by_user_id = excluded.updated_by_user_id,
                      updated_at = now()
                    """,
                    (
                        str(raw_tag["slug"]).strip().lower(),
                        str(raw_tag["name"]).strip(),
                        raw_tag.get("description"),
                        raw_tag.get("color"),
                        raw_tag.get("icon"),
                        local_user["id"],
                        local_user["id"],
                    ),
                )
                count += 1
        connection.commit()
    return count


def clear_storage_buckets(*, problem_main: Any, storage_module: Any) -> dict[str, int]:
    deleted_counts: dict[str, int] = {}
    if problem_main.SETTINGS.storage.driver != "s3":
        return deleted_counts

    client = storage_module.build_s3_client(problem_main.SETTINGS.storage)
    for bucket_name in [
        problem_main.SETTINGS.storage.problems_bucket,
        problem_main.SETTINGS.storage.submissions_bucket,
    ]:
        if not bucket_name:
            continue
        deleted = 0
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket_name):
            contents = page.get("Contents") or []
            if not contents:
                continue
            client.delete_objects(
                Bucket=bucket_name,
                Delete={"Objects": [{"Key": item["Key"]} for item in contents], "Quiet": True},
            )
            deleted += len(contents)
        deleted_counts[bucket_name] = deleted
    return deleted_counts


def reset_existing_catalog(*, problem_main: Any, database_module: Any, storage_module: Any) -> dict[str, Any]:
    deleted_storage = clear_storage_buckets(problem_main=problem_main, storage_module=storage_module)

    with database_module.get_connection(problem_main.SETTINGS.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                truncate table
                  submission.results,
                  submission.run_metrics,
                  submission.judge_runs,
                  submission.judge_jobs,
                  submission.outbox_events,
                  submission.submissions,
                  submission.judge_workers,
                  problem.problem_stats,
                  problem.checkers,
                  problem.testcases,
                  problem.testsets,
                  problem.problem_assets,
                  problem.problem_tags,
                  problem.problems,
                  problem.tags,
                  storage.objects
                restart identity cascade
                """
            )
            cursor.execute(
                """
                delete from app_identity.user_role_assignments
                where user_id in (
                  select id
                  from app_identity.users
                  where cognito_sub = 'catalog-importer-admin'
                )
                """
            )
            cursor.execute(
                """
                delete from app_identity.users
                where cognito_sub = 'catalog-importer-admin'
                """
            )
        connection.commit()

    problem_main.invalidate_public_problem_cache(reason="catalog-reset")
    return {
        "deleted_storage_objects": deleted_storage,
    }


def build_problem_payload(problem_entry: dict[str, Any], *, catalog_dir: Path, problem_main: Any) -> tuple[dict[str, Any], str]:
    slug = str(problem_entry["slug"]).strip().lower()
    statement_path = require_file(
        catalog_dir / str(problem_entry["statement_path"]),
        label=f"statement for {slug}",
    )
    testcases_dir = require_directory(
        catalog_dir / str(problem_entry["testcases_dir"]),
        label=f"testcases for {slug}",
    )

    target_status = str(problem_entry.get("status_code") or "published").strip().lower()
    if target_status not in ALLOWED_TARGET_STATUSES:
        raise ValueError(
            f"Unsupported target status {target_status!r} for {slug}. "
            f"Allowed: {sorted(ALLOWED_TARGET_STATUSES)}"
        )

    payload: dict[str, Any] = {
        "slug": slug,
        "title": str(problem_entry["title"]).strip(),
        "summary_md": problem_entry.get("summary_md"),
        "difficulty_code": str(problem_entry.get("difficulty_code") or "easy").strip().lower(),
        "type_code": str(problem_entry.get("type_code") or "traditional").strip().lower(),
        "visibility_code": "private",
        "status_code": "draft",
        "scoring_code": str(problem_entry.get("scoring_code") or "icpc").strip().lower(),
        "time_limit_ms": int(problem_entry.get("time_limit_ms") or 1000),
        "memory_limit_kb": int(problem_entry.get("memory_limit_kb") or 262144),
        "output_limit_kb": int(problem_entry.get("output_limit_kb") or 65536),
        "tag_slugs": [str(tag_slug).strip().lower() for tag_slug in problem_entry.get("tag_slugs", [])],
        "statement_file": problem_main.UploadedBinary(
            filename=statement_path.name,
            content_type="text/markdown",
            data=statement_path.read_bytes(),
        ),
        "testset_type_code": str(problem_entry.get("testset_type_code") or "primary").strip().lower(),
        "testset_title": problem_entry.get("testset_title"),
        "testset_note": problem_entry.get("testset_note"),
        "testset_archive": problem_main.UploadedBinary(
            filename=f"{slug}-testcases.zip",
            content_type="application/zip",
            data=zip_testcase_directory(testcases_dir),
        ),
        "checker_type_code": str(problem_entry.get("checker_type_code") or "diff").strip().lower(),
    }

    statement_asset_paths = problem_entry.get("statement_assets") or []
    if statement_asset_paths:
        payload["statement_assets"] = [
            problem_main.UploadedBinary(
                filename=require_file(catalog_dir / str(relative_path), label=f"statement asset for {slug}").name,
                content_type=problem_main.infer_content_type(
                    require_file(catalog_dir / str(relative_path), label=f"statement asset for {slug}").name,
                    None,
                ),
                data=require_file(catalog_dir / str(relative_path), label=f"statement asset for {slug}").read_bytes(),
            )
            for relative_path in statement_asset_paths
        ]

    checker_type = payload["checker_type_code"]
    if checker_type == "custom":
        checker_source_path = require_file(
            catalog_dir / str(problem_entry["checker_source_path"]),
            label=f"custom checker source for {slug}",
        )
        payload["checker_runtime_profile_key"] = str(problem_entry["checker_runtime_profile_key"]).strip()
        payload["checker_entrypoint"] = problem_entry.get("checker_entrypoint") or checker_source_path.name
        payload["checker_note"] = problem_entry.get("checker_note")
        payload["checker_source"] = problem_main.UploadedBinary(
            filename=checker_source_path.name,
            content_type=problem_main.infer_content_type(checker_source_path.name, None),
            data=checker_source_path.read_bytes(),
        )

    return payload, target_status


def advance_problem_to_target_status(*, problem_id: str, target_status: str, problem_main: Any, actor: Any) -> None:
    if target_status in {"pending_review", "approved", "published"}:
        problem_main.transition_problem_lifecycle(problem_id, "request-review", actor)
    if target_status in {"approved", "published"}:
        problem_main.transition_problem_lifecycle(problem_id, "approve", actor)
    if target_status == "published":
        problem_main.transition_problem_lifecycle(problem_id, "publish", actor)


def apply_sample_case_metadata(
    *,
    problem_id: str,
    problem_entry: dict[str, Any],
    default_testset_type_code: str,
    database_url: str,
    database_module: Any,
) -> int:
    sample_cases = normalize_sample_cases(problem_entry)
    if not sample_cases:
        return 0

    target_testset_type_code = str(
        problem_entry.get("sample_testset_type_code") or default_testset_type_code
    ).strip().lower()

    with database_module.get_connection(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select id::text
                from problem.testsets
                where problem_id = %s::uuid
                  and is_active
                  and testset_type_code = %s
                order by created_at desc
                limit 1
                """,
                (problem_id, target_testset_type_code),
            )
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError(
                    f"Unable to find active testset '{target_testset_type_code}' for problem {problem_id}."
                )

            if isinstance(row, dict):
                testset_id = str(row["id"])
            elif hasattr(row, "keys") and "id" in row.keys():
                testset_id = str(row["id"])
            else:
                testset_id = str(row[0])
            for sample_case in sample_cases:
                cursor.execute(
                    """
                    update problem.testcases
                    set is_sample = true,
                        note = %s
                    where testset_id = %s::uuid
                      and ordinal = %s
                    returning id::text
                    """,
                    (sample_case["note"], testset_id, sample_case["ordinal"]),
                )
                updated_row = cursor.fetchone()
                if updated_row is None:
                    raise RuntimeError(
                        "Sample case ordinal "
                        f"{sample_case['ordinal']} does not exist in testset '{target_testset_type_code}' "
                        f"for problem {problem_id}."
                    )
        connection.commit()

    return len(sample_cases)


def main() -> int:
    args = parse_args()
    catalog_dir = Path(args.catalog_dir).resolve()
    env_file = Path(args.env_file).resolve()

    if not args.skip_env_file:
        load_env_file(env_file)
    ensure_backend_import_paths()

    try:
        problem_main = importlib.import_module("app.main")
        auth_module = importlib.import_module("backend_common.auth")
        bootstrap_module = importlib.import_module("backend_common.bootstrap")
        database_module = importlib.import_module("backend_common.database")
        storage_module = importlib.import_module("backend_common.storage")
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Backend import failed because the current Python environment is missing service dependencies. "
            "Run this script from a Python environment with the problem-service requirements installed."
        ) from exc

    if not args.skip_bootstrap:
        bootstrap_module.bootstrap_service(
            problem_main.SETTINGS,
            apply_schema=True,
            ensure_storage_buckets=True,
            ensure_judge_queue=False,
        )

    catalog = load_catalog(catalog_dir)
    actor = build_seed_actor(auth_module)
    reset_summary: dict[str, Any] | None = None

    if args.reset_existing:
        reset_summary = reset_existing_catalog(
            problem_main=problem_main,
            database_module=database_module,
            storage_module=storage_module,
        )

    tag_count = sync_tags(catalog, problem_main=problem_main, database_module=database_module, actor=actor)

    created: list[str] = []
    skipped: list[str] = []
    marked_sample_cases = 0

    for problem_entry in catalog["problems"]:
        slug = str(problem_entry["slug"]).strip().lower()
        if problem_main.problem_slug_exists(slug):
            if args.fail_on_existing:
                raise RuntimeError(f"Problem slug already exists: {slug}")
            skipped.append(slug)
            continue

        payload, target_status = build_problem_payload(problem_entry, catalog_dir=catalog_dir, problem_main=problem_main)
        created_problem = problem_main.create_problem_row(payload, actor)
        marked_sample_cases += apply_sample_case_metadata(
            problem_id=created_problem["id"],
            problem_entry=problem_entry,
            default_testset_type_code=payload["testset_type_code"],
            database_url=problem_main.SETTINGS.database_url,
            database_module=database_module,
        )
        advance_problem_to_target_status(
            problem_id=created_problem["id"],
            target_status=target_status,
            problem_main=problem_main,
            actor=actor,
        )
        created.append(slug)

    summary = {
        "catalog_dir": str(catalog_dir),
        "env_file": str(env_file),
        "skip_env_file": args.skip_env_file,
        "reset_existing": args.reset_existing,
        "reset_summary": reset_summary,
        "tags_synced": tag_count,
        "created_problem_count": len(created),
        "skipped_problem_count": len(skipped),
        "marked_sample_case_count": marked_sample_cases,
        "created_problem_slugs": created,
        "skipped_problem_slugs": skipped,
    }

    if args.json_out:
        json_out_path = Path(args.json_out).resolve()
        json_out_path.parent.mkdir(parents=True, exist_ok=True)
        json_out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
