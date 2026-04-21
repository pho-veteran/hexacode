from __future__ import annotations

import json
import logging
import os
import re
import resource
import shlex
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
import hashlib

import httpx

from backend_common.bootstrap import bootstrap_service
from backend_common.queue import JudgeJobMessage, SQSJudgeQueue
from backend_common.settings import load_service_settings
from backend_common.storage import download_object_bytes, upload_object_bytes

logger = logging.getLogger("hexacode.worker")
SETTINGS = load_service_settings("worker")

OUTPUT_PREVIEW_BYTES = 2048
COMPILE_TIMEOUT_FLOOR_SECONDS = 10.0
COMPILE_TIMEOUT_MULTIPLIER = 5.0


def configure_logging() -> None:
    logging.basicConfig(
        level=SETTINGS.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def request_service(
    base_url: str,
    path: str,
    *,
    method: str,
    trace_id: str,
    payload: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
) -> dict[str, Any]:
    target_url = f"{base_url.rstrip('/')}{path}"
    with httpx.Client(timeout=30.0) as client:
        response = client.request(
            method,
            target_url,
            json=payload,
            params=query,
            headers={"x-correlation-id": trace_id},
        )
        response.raise_for_status()
        return response.json()


def notify_submission_service(
    submission_service_url: str,
    path: str,
    payload: dict[str, Any],
    *,
    trace_id: str,
) -> None:
    request_service(
        submission_service_url,
        path,
        method="POST",
        payload=payload,
        trace_id=trace_id,
    )


def fetch_submission_context(
    submission_service_url: str,
    judge_job_id: str,
    *,
    trace_id: str,
) -> dict[str, Any]:
    payload = request_service(
        submission_service_url,
        f"/internal/judge-jobs/{judge_job_id}/context",
        method="GET",
        trace_id=trace_id,
    )
    return payload["data"]


def fetch_problem_context(
    problem_service_url: str,
    problem_id: str,
    *,
    trace_id: str,
    requested_testset_id: str | None = None,
    samples_only: bool = False,
) -> dict[str, Any]:
    payload = request_service(
        problem_service_url,
        f"/internal/problems/{problem_id}/judge-context",
        method="GET",
        trace_id=trace_id,
        query={
            key: value
            for key, value in {
                "testset_id": requested_testset_id,
                "samples_only": "true" if samples_only else None,
            }.items()
            if value is not None
        },
    )
    return payload["data"]


def fetch_runtime_context(
    submission_service_url: str,
    profile_key: str,
    *,
    trace_id: str,
) -> dict[str, Any]:
    payload = request_service(
        submission_service_url,
        f"/internal/runtimes/{profile_key}",
        method="GET",
        trace_id=trace_id,
    )
    return payload["data"]


def preview_bytes(data: bytes | None, *, limit: int = OUTPUT_PREVIEW_BYTES) -> str | None:
    if not data:
        return None

    truncated = data[:limit]
    text = truncated.decode("utf-8", errors="replace")
    if len(data) > limit:
        return f"{text}\n...[truncated]"
    return text


def normalize_diff_bytes(data: bytes) -> bytes:
    normalized = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    lines = [line.rstrip(b" \t") for line in normalized.split(b"\n")]
    while lines and lines[-1] == b"":
        lines.pop()
    return b"\n".join(lines)


def build_process_limits(memory_limit_kb: int | None):
    if os.name != "posix" or not memory_limit_kb:
        return None

    memory_limit_bytes = int(memory_limit_kb) * 1024

    def apply_limits() -> None:
        resource.setrlimit(resource.RLIMIT_AS, (memory_limit_bytes, memory_limit_bytes))

    return apply_limits


def run_process(
    command: str,
    *,
    cwd: Path,
    stdin_bytes: bytes | None,
    timeout_seconds: float,
    memory_limit_kb: int | None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    try:
        completed = subprocess.run(
            shlex.split(command),
            cwd=str(cwd),
            input=stdin_bytes,
            capture_output=True,
            timeout=timeout_seconds,
            preexec_fn=build_process_limits(memory_limit_kb),
        )
    except subprocess.TimeoutExpired as exc:
        runtime_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "timed_out": True,
            "launch_error": None,
            "exit_code": None,
            "signal": None,
            "runtime_ms": runtime_ms,
            "memory_kb": 0,
            "stdout": exc.stdout or b"",
            "stderr": exc.stderr or b"",
        }
    except FileNotFoundError as exc:
        runtime_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "timed_out": False,
            "launch_error": str(exc),
            "exit_code": None,
            "signal": None,
            "runtime_ms": runtime_ms,
            "memory_kb": 0,
            "stdout": b"",
            "stderr": str(exc).encode("utf-8", errors="replace"),
        }

    runtime_ms = int((time.perf_counter() - started_at) * 1000)
    return {
        "timed_out": False,
        "launch_error": None,
        "exit_code": completed.returncode,
        "signal": abs(completed.returncode) if completed.returncode < 0 else None,
        "runtime_ms": runtime_ms,
        "memory_kb": 0,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def choose_positive_int(preferred: Any, fallback: Any) -> int | None:
    for value in (preferred, fallback):
        if value is None:
            continue
        parsed = int(value)
        if parsed > 0:
            return parsed
    return None


def resolve_limits(
    submission_context: dict[str, Any],
    problem_context: dict[str, Any],
) -> dict[str, int | None]:
    runtime = submission_context["runtime"]
    problem = problem_context["problem"]
    return {
        "time_limit_ms": choose_positive_int(
            problem.get("time_limit_ms"),
            runtime.get("default_time_limit_ms"),
        ),
        "memory_limit_kb": choose_positive_int(
            problem.get("memory_limit_kb"),
            runtime.get("default_memory_limit_kb"),
        ),
        "output_limit_kb": choose_positive_int(
            problem.get("output_limit_kb"),
            runtime.get("default_output_limit_kb"),
        ),
    }


def sanitize_relative_path(path_value: str | None, *, fallback: str) -> Path:
    normalized = str(path_value or "").strip().replace("\\", "/")
    if not normalized:
        normalized = fallback

    candidate = Path(normalized)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise RuntimeError(f"Unsupported relative path '{normalized}'.")
    return candidate


def rewrite_source_file_command(
    command: str | None,
    *,
    default_source_file_name: str,
    source_file_name: str,
) -> str:
    normalized = str(command or "").strip()
    if not normalized or default_source_file_name == source_file_name:
        return normalized
    return normalized.replace(default_source_file_name, source_file_name)


def build_runtime_plan(runtime: dict[str, Any], *, entrypoint: str | None = None) -> dict[str, str]:
    default_source_path = sanitize_relative_path(
        runtime.get("source_file_name"),
        fallback="main.txt",
    )
    source_path = sanitize_relative_path(
        entrypoint,
        fallback=default_source_path.as_posix(),
    )
    default_source_file_name = default_source_path.as_posix()
    source_file_name = source_path.as_posix()
    return {
        "source_file_name": source_file_name,
        "compile_command": rewrite_source_file_command(
            runtime.get("compile_command"),
            default_source_file_name=default_source_file_name,
            source_file_name=source_file_name,
        ),
        "run_command": rewrite_source_file_command(
            runtime.get("run_command"),
            default_source_file_name=default_source_file_name,
            source_file_name=source_file_name,
        ),
    }


def sanitize_file_component(value: str | None, *, fallback: str) -> str:
    normalized = str(value or "").strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", normalized).strip(".-_")
    return cleaned or fallback


def resolve_compiled_artifact_relative_path(runtime_plan: dict[str, str]) -> Path | None:
    compile_command = str(runtime_plan.get("compile_command", "")).strip()
    if not compile_command:
        return None

    tokens = shlex.split(compile_command)
    for index, token in enumerate(tokens):
        if token == "-o" and index + 1 < len(tokens):
            return sanitize_relative_path(tokens[index + 1], fallback="main")
        if token.startswith("-o") and len(token) > 2:
            return sanitize_relative_path(token[2:], fallback="main")

    run_tokens = shlex.split(str(runtime_plan.get("run_command", "")).strip())
    if not run_tokens:
        return None

    candidate = run_tokens[0]
    if candidate.startswith("./") or candidate.startswith(".\\"):
        return sanitize_relative_path(candidate[2:], fallback="main")
    if "/" in candidate or "\\" in candidate:
        return sanitize_relative_path(candidate, fallback="main")
    return None


def restore_compiled_artifact(
    workspace: Path,
    runtime_plan: dict[str, str],
    compiled_object: dict[str, Any],
) -> bool:
    artifact_relative_path = resolve_compiled_artifact_relative_path(runtime_plan)
    if artifact_relative_path is None:
        return False

    artifact_path = workspace / artifact_relative_path
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_bytes(
        download_object_bytes(
            SETTINGS.storage,
            bucket=compiled_object["bucket"],
            object_key=compiled_object["object_key"],
        )
    )
    if os.name == "posix":
        artifact_path.chmod(0o755)
    return True


def register_compiled_checker_artifact(
    problem_service_url: str,
    checker_id: str,
    payload: dict[str, Any],
    *,
    trace_id: str,
) -> dict[str, Any]:
    response = request_service(
        problem_service_url,
        f"/internal/checkers/{checker_id}/compiled-artifact",
        method="POST",
        payload=payload,
        trace_id=trace_id,
    )
    return response["data"]


def cache_compiled_checker_artifact(
    *,
    problem_service_url: str,
    problem_id: str,
    checker: dict[str, Any],
    runtime_plan: dict[str, str],
    workspace: Path,
    trace_id: str,
) -> dict[str, Any] | None:
    artifact_relative_path = resolve_compiled_artifact_relative_path(runtime_plan)
    if artifact_relative_path is None:
        return None

    artifact_path = workspace / artifact_relative_path
    if not artifact_path.exists() or not artifact_path.is_file():
        return None

    bucket_name = SETTINGS.storage.problems_bucket
    if not bucket_name:
        raise RuntimeError("S3_BUCKET_PROBLEMS must be configured for checker artifact caching.")

    artifact_bytes = artifact_path.read_bytes()
    artifact_sha256 = hashlib.sha256(artifact_bytes).hexdigest()
    artifact_name = sanitize_file_component(artifact_path.name, fallback="checker-artifact")
    object_key = (
        f"problem/{problem_id}/checker/{checker['id']}/compiled/"
        f"{artifact_sha256}-{artifact_name}"
    )
    metadata_json = {
        "role": "checker_compiled",
        "problem_id": problem_id,
        "checker_id": checker["id"],
        "runtime_profile_key": checker.get("runtime_profile_key"),
    }
    upload_result = upload_object_bytes(
        SETTINGS.storage,
        bucket=bucket_name,
        object_key=object_key,
        data=artifact_bytes,
        content_type="application/octet-stream",
        metadata=metadata_json,
    )
    registered = register_compiled_checker_artifact(
        problem_service_url,
        str(checker["id"]),
        {
            "bucket": bucket_name,
            "object_key": object_key,
            "content_type": "application/octet-stream",
            "original_filename": artifact_name,
            "size_bytes": len(artifact_bytes),
            "sha256": artifact_sha256,
            "etag": upload_result.get("etag"),
            "metadata_json": metadata_json,
        },
        trace_id=trace_id,
    )
    return registered.get("compiled_object")


def load_submission_source_bytes(submission_context: dict[str, Any]) -> bytes:
    submission = submission_context["submission"]
    if submission.get("source_code") is not None:
        return str(submission["source_code"]).encode("utf-8")

    source_object = submission.get("source_object")
    if source_object is None:
        raise RuntimeError("Submission context did not include source_code or source_object.")

    return download_object_bytes(
        SETTINGS.storage,
        bucket=source_object["bucket"],
        object_key=source_object["object_key"],
    )


def load_checker_source_bytes(checker: dict[str, Any]) -> bytes:
    source_object = checker.get("source_object")
    if source_object is None:
        raise RuntimeError("Custom checker is missing its source_object.")
    return download_object_bytes(
        SETTINGS.storage,
        bucket=source_object["bucket"],
        object_key=source_object["object_key"],
    )


def load_case_bytes(text_value: str | None, object_payload: dict[str, Any] | None) -> bytes:
    if text_value is not None:
        return text_value.encode("utf-8")
    if object_payload is None:
        raise RuntimeError("Testcase context is missing both inline text and a storage object.")
    return download_object_bytes(
        SETTINGS.storage,
        bucket=object_payload["bucket"],
        object_key=object_payload["object_key"],
    )


def write_runtime_source(workspace: Path, runtime_plan: dict[str, str], source_bytes: bytes) -> None:
    source_path = workspace / runtime_plan["source_file_name"]
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(source_bytes)


def write_submission_source(workspace: Path, submission_context: dict[str, Any]) -> dict[str, str]:
    runtime_plan = build_runtime_plan(submission_context["runtime"])
    write_runtime_source(
        workspace,
        runtime_plan,
        load_submission_source_bytes(submission_context),
    )
    return runtime_plan


def build_compile_result(execution: dict[str, Any], *, command_present: bool) -> dict[str, Any]:
    if not command_present:
        return {
            "result_type_code": "compile",
            "status_code": "ac",
            "runtime_ms": 0,
            "memory_kb": 0,
            "message": "Compilation skipped for this runtime.",
            "checker_message": None,
            "exit_code": 0,
            "signal": None,
        }

    stderr_preview = preview_bytes(execution["stderr"])
    stdout_preview = preview_bytes(execution["stdout"])
    preview_message = stderr_preview or stdout_preview

    if execution["launch_error"]:
        return {
            "result_type_code": "compile",
            "status_code": "ie",
            "runtime_ms": execution["runtime_ms"],
            "memory_kb": execution["memory_kb"],
            "message": f"Failed to launch the compiler: {execution['launch_error']}",
            "checker_message": None,
            "exit_code": None,
            "signal": None,
        }

    if execution["timed_out"]:
        return {
            "result_type_code": "compile",
            "status_code": "ce",
            "runtime_ms": execution["runtime_ms"],
            "memory_kb": execution["memory_kb"],
            "message": "Compilation timed out.",
            "checker_message": preview_message,
            "exit_code": None,
            "signal": None,
        }

    if execution["exit_code"] == 0:
        return {
            "result_type_code": "compile",
            "status_code": "ac",
            "runtime_ms": execution["runtime_ms"],
            "memory_kb": execution["memory_kb"],
            "message": "Compilation completed successfully.",
            "checker_message": preview_message,
            "exit_code": execution["exit_code"],
            "signal": execution["signal"],
        }

    return {
        "result_type_code": "compile",
        "status_code": "ce",
        "runtime_ms": execution["runtime_ms"],
        "memory_kb": execution["memory_kb"],
        "message": "Compilation failed.",
        "checker_message": preview_message,
        "exit_code": execution["exit_code"],
        "signal": execution["signal"],
    }


def compile_runtime_source(
    runtime_plan: dict[str, str],
    *,
    workspace: Path,
    limits: dict[str, int | None],
) -> dict[str, Any]:
    compile_command = str(runtime_plan.get("compile_command", "")).strip()
    if not compile_command:
        return build_compile_result({}, command_present=False)

    time_limit_ms = limits.get("time_limit_ms") or 1000
    compile_timeout_seconds = max(
        COMPILE_TIMEOUT_FLOOR_SECONDS,
        (time_limit_ms / 1000.0) * COMPILE_TIMEOUT_MULTIPLIER,
    )
    execution = run_process(
        compile_command,
        cwd=workspace,
        stdin_bytes=None,
        timeout_seconds=compile_timeout_seconds,
        memory_limit_kb=limits.get("memory_limit_kb"),
    )
    return build_compile_result(execution, command_present=True)


def compare_with_diff(actual_output: bytes, expected_output: bytes) -> tuple[bool, str | None]:
    normalized_actual = normalize_diff_bytes(actual_output)
    normalized_expected = normalize_diff_bytes(expected_output)
    if normalized_actual == normalized_expected:
        return True, "Output matched expected output."
    return False, "Output differed from expected output."


def build_testcase_result(
    testcase: dict[str, Any],
    *,
    status_code: str,
    runtime_ms: int,
    memory_kb: int,
    input_bytes: bytes,
    expected_output: bytes,
    actual_output: bytes | None,
    message: str,
    checker_message: str | None,
    exit_code: int | None,
    signal: int | None,
) -> dict[str, Any]:
    actual_output_preview = preview_bytes(actual_output)
    expected_output_preview = preview_bytes(expected_output)
    input_preview = preview_bytes(input_bytes)
    return {
        "result_type_code": "testcase",
        "testcase_id": testcase["id"],
        "status_code": status_code,
        "runtime_ms": runtime_ms,
        "memory_kb": memory_kb,
        "input_preview": input_preview,
        "expected_output_preview": expected_output_preview,
        "actual_output_preview": actual_output_preview,
        "message": message,
        "checker_message": checker_message,
        "exit_code": exit_code,
        "signal": signal,
    }


def build_custom_case_result(
    *,
    status_code: str,
    runtime_ms: int,
    memory_kb: int,
    custom_case_id: str | None,
    custom_input: str,
    expected_output: str | None,
    actual_output: bytes | None,
    message: str,
    checker_message: str | None,
    exit_code: int | None,
    signal: int | None,
) -> dict[str, Any]:
    return {
        "result_type_code": "custom_case",
        "status_code": status_code,
        "runtime_ms": runtime_ms,
        "memory_kb": memory_kb,
        "input_preview": preview_bytes(custom_input.encode("utf-8")),
        "expected_output_preview": expected_output,
        "actual_output_preview": preview_bytes(actual_output),
        "message": message,
        "checker_message": checker_message,
        "exit_code": exit_code,
        "signal": signal,
        "note": custom_case_id,
    }


def build_execution_error_result(
    testcase: dict[str, Any],
    execution: dict[str, Any],
    *,
    input_bytes: bytes,
    expected_output: bytes,
) -> dict[str, Any] | None:
    actual_output = execution["stdout"]

    if execution["launch_error"]:
        return build_testcase_result(
            testcase,
            status_code="ie",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            input_bytes=input_bytes,
            expected_output=expected_output,
            actual_output=actual_output,
            message=f"Failed to launch the runtime: {execution['launch_error']}",
            checker_message=None,
            exit_code=None,
            signal=None,
        )

    if execution["timed_out"]:
        return build_testcase_result(
            testcase,
            status_code="tle",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            input_bytes=input_bytes,
            expected_output=expected_output,
            actual_output=actual_output,
            message="Time limit exceeded.",
            checker_message=None,
            exit_code=None,
            signal=None,
        )

    if execution["exit_code"] not in (0, None):
        return build_testcase_result(
            testcase,
            status_code="re",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            input_bytes=input_bytes,
            expected_output=expected_output,
            actual_output=actual_output,
            message="Program exited with a runtime error.",
            checker_message=preview_bytes(execution["stderr"]),
            exit_code=execution["exit_code"],
            signal=execution["signal"],
        )
    return None


def evaluate_testcase_result(
    testcase: dict[str, Any],
    execution: dict[str, Any],
    *,
    input_bytes: bytes,
    expected_output: bytes,
) -> dict[str, Any]:
    runtime_error_result = build_execution_error_result(
        testcase,
        execution,
        input_bytes=input_bytes,
        expected_output=expected_output,
    )
    if runtime_error_result is not None:
        return runtime_error_result

    passed, checker_message = compare_with_diff(execution["stdout"], expected_output)
    return build_testcase_result(
        testcase,
        status_code="ac" if passed else "wa",
        runtime_ms=execution["runtime_ms"],
        memory_kb=execution["memory_kb"],
        input_bytes=input_bytes,
        expected_output=expected_output,
        actual_output=execution["stdout"],
        message="Accepted." if passed else "Wrong answer.",
        checker_message=checker_message,
        exit_code=execution["exit_code"],
        signal=execution["signal"],
    )


def build_command_with_args(command: str, args: list[str]) -> str:
    normalized = command.strip()
    if not normalized:
        raise RuntimeError("A non-empty command is required.")
    return f"{normalized} {shlex.join(args)}"


def evaluate_custom_checker_result(
    testcase: dict[str, Any],
    execution: dict[str, Any],
    *,
    input_bytes: bytes,
    expected_output: bytes,
    checker_runtime_plan: dict[str, str],
    checker_workspace: Path,
    timeout_seconds: float,
    memory_limit_kb: int | None,
) -> dict[str, Any]:
    runtime_error_result = build_execution_error_result(
        testcase,
        execution,
        input_bytes=input_bytes,
        expected_output=expected_output,
    )
    if runtime_error_result is not None:
        return runtime_error_result

    case_dir = checker_workspace / f"case-{testcase['ordinal']}"
    case_dir.mkdir(parents=True, exist_ok=True)
    input_path = case_dir / "input.txt"
    expected_path = case_dir / "expected.txt"
    actual_path = case_dir / "actual.txt"
    input_path.write_bytes(input_bytes)
    expected_path.write_bytes(expected_output)
    actual_path.write_bytes(execution["stdout"])

    checker_execution = run_process(
        build_command_with_args(
            checker_runtime_plan["run_command"],
            [str(input_path), str(expected_path), str(actual_path)],
        ),
        cwd=checker_workspace,
        stdin_bytes=None,
        timeout_seconds=max(timeout_seconds, 1.0),
        memory_limit_kb=memory_limit_kb,
    )
    checker_message = preview_bytes(checker_execution["stdout"]) or preview_bytes(
        checker_execution["stderr"]
    )

    if checker_execution["launch_error"]:
        return build_testcase_result(
            testcase,
            status_code="ie",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            input_bytes=input_bytes,
            expected_output=expected_output,
            actual_output=execution["stdout"],
            message="Custom checker failed to launch.",
            checker_message=checker_message or checker_execution["launch_error"],
            exit_code=checker_execution["exit_code"],
            signal=checker_execution["signal"],
        )

    if checker_execution["timed_out"]:
        return build_testcase_result(
            testcase,
            status_code="ie",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            input_bytes=input_bytes,
            expected_output=expected_output,
            actual_output=execution["stdout"],
            message="Custom checker timed out.",
            checker_message=checker_message,
            exit_code=checker_execution["exit_code"],
            signal=checker_execution["signal"],
        )

    if checker_execution["exit_code"] in (0, None):
        return build_testcase_result(
            testcase,
            status_code="ac",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            input_bytes=input_bytes,
            expected_output=expected_output,
            actual_output=execution["stdout"],
            message="Accepted.",
            checker_message=checker_message or "Custom checker accepted the output.",
            exit_code=checker_execution["exit_code"],
            signal=checker_execution["signal"],
        )

    if checker_execution["exit_code"] in {1, 2}:
        return build_testcase_result(
            testcase,
            status_code="wa",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            input_bytes=input_bytes,
            expected_output=expected_output,
            actual_output=execution["stdout"],
            message="Wrong answer.",
            checker_message=checker_message or "Custom checker rejected the output.",
            exit_code=checker_execution["exit_code"],
            signal=checker_execution["signal"],
        )

    return build_testcase_result(
        testcase,
        status_code="ie",
        runtime_ms=execution["runtime_ms"],
        memory_kb=execution["memory_kb"],
        input_bytes=input_bytes,
        expected_output=expected_output,
        actual_output=execution["stdout"],
        message="Custom checker failed.",
        checker_message=checker_message or "Custom checker exited unexpectedly.",
        exit_code=checker_execution["exit_code"],
        signal=checker_execution["signal"],
    )


def build_skipped_result(testcase: dict[str, Any]) -> dict[str, Any]:
    return {
        "result_type_code": "testcase",
        "testcase_id": testcase["id"],
        "status_code": "skipped",
        "runtime_ms": 0,
        "memory_kb": 0,
        "input_preview": None,
        "expected_output_preview": None,
        "actual_output_preview": None,
        "message": "Skipped after an earlier testcase failed.",
        "checker_message": None,
        "exit_code": None,
        "signal": None,
    }


def evaluate_custom_input_result(
    custom_case: dict[str, Any],
    execution: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    custom_case_id = str(custom_case.get("id") or "").strip() or None
    custom_input = str(custom_case.get("input") or "")
    expected_output = (
        None if custom_case.get("expected_output") is None else str(custom_case.get("expected_output"))
    )
    actual_output = execution["stdout"]
    stderr_preview = preview_bytes(execution["stderr"])
    if execution["launch_error"]:
        return (
            build_custom_case_result(
                status_code="ie",
                runtime_ms=execution["runtime_ms"],
                memory_kb=execution["memory_kb"],
                custom_case_id=custom_case_id,
                custom_input=custom_input,
                expected_output=expected_output,
                actual_output=actual_output,
                message=f"Failed to launch the runtime: {execution['launch_error']}",
                checker_message=None,
                exit_code=None,
                signal=None,
            ),
            "ie",
        )
    if execution["timed_out"]:
        return (
            build_custom_case_result(
                status_code="tle",
                runtime_ms=execution["runtime_ms"],
                memory_kb=execution["memory_kb"],
                custom_case_id=custom_case_id,
                custom_input=custom_input,
                expected_output=expected_output,
                actual_output=actual_output,
                message="Time limit exceeded.",
                checker_message=None,
                exit_code=None,
                signal=None,
            ),
            "tle",
        )
    if execution["exit_code"] not in (0, None):
        return (
            build_custom_case_result(
                status_code="re",
                runtime_ms=execution["runtime_ms"],
                memory_kb=execution["memory_kb"],
                custom_case_id=custom_case_id,
                custom_input=custom_input,
                expected_output=expected_output,
                actual_output=actual_output,
                message="Program exited with a runtime error.",
                checker_message=stderr_preview,
                exit_code=execution["exit_code"],
                signal=execution["signal"],
            ),
            "re",
        )

    if expected_output is not None and expected_output.strip() != "":
        passed, checker_message = compare_with_diff(
            execution["stdout"],
            expected_output.encode("utf-8"),
        )
        status_code = "ac" if passed else "wa"
        return (
            build_custom_case_result(
                status_code=status_code,
                runtime_ms=execution["runtime_ms"],
                memory_kb=execution["memory_kb"],
                custom_case_id=custom_case_id,
                custom_input=custom_input,
                expected_output=expected_output,
                actual_output=actual_output,
                message="Accepted." if passed else "Wrong answer.",
                checker_message=checker_message,
                exit_code=execution["exit_code"],
                signal=execution["signal"],
            ),
            status_code,
        )

    return (
        build_custom_case_result(
            status_code="ac",
            runtime_ms=execution["runtime_ms"],
            memory_kb=execution["memory_kb"],
            custom_case_id=custom_case_id,
            custom_input=custom_input,
            expected_output=expected_output,
            actual_output=actual_output,
            message="Execution completed successfully.",
            checker_message=stderr_preview,
            exit_code=execution["exit_code"],
            signal=execution["signal"],
        ),
        "ac",
    )


def build_completion_payload(
    *,
    worker_name: str,
    compile_result: dict[str, Any],
    testcase_results: list[dict[str, Any]],
    final_verdict: str,
    final_status: str,
) -> dict[str, Any]:
    testcase_runtime_ms = [
        int(result.get("runtime_ms") or 0)
        for result in testcase_results
        if result.get("status_code") not in {"skipped"}
    ]
    testcase_memory_kb = [
        int(result.get("memory_kb") or 0)
        for result in testcase_results
        if result.get("status_code") not in {"skipped"}
    ]
    return {
        "worker_name": worker_name,
        "status_code": final_status,
        "verdict_code": final_verdict,
        "runtime_ms": max(testcase_runtime_ms, default=0),
        "memory_kb": max(testcase_memory_kb, default=0),
        "compile_exit_code": compile_result.get("exit_code"),
        "compile_time_ms": compile_result.get("runtime_ms"),
        "results": [compile_result, *testcase_results],
    }


def execute_submission(
    submission_context: dict[str, Any],
    problem_context: dict[str, Any],
    *,
    problem_service_url: str,
    trace_id: str,
    worker_name: str,
) -> dict[str, Any]:
    limits = resolve_limits(submission_context, problem_context)
    checker = problem_context.get("active_checker") or {"checker_type_code": "diff"}
    submission = submission_context["submission"]
    runtime = submission_context["runtime"]
    checker_type_code = str(checker.get("checker_type_code", "diff")).strip().lower()

    with tempfile.TemporaryDirectory(prefix="hexacode-judge-") as workspace_dir:
        workspace = Path(workspace_dir)
        submission_runtime_plan = write_submission_source(workspace, submission_context)

        compile_result = compile_runtime_source(
            submission_runtime_plan,
            workspace=workspace,
            limits=limits,
        )
        if compile_result["status_code"] != "ac":
            final_verdict = compile_result["status_code"]
            final_status = "failed" if final_verdict == "ie" else "done"
            return build_completion_payload(
                worker_name=worker_name,
                compile_result=compile_result,
                testcase_results=[],
                final_verdict=final_verdict,
                final_status=final_status,
            )

        run_command = submission_runtime_plan["run_command"]
        timeout_seconds = max((limits.get("time_limit_ms") or 1000) / 1000.0, 0.1)
        memory_limit_kb = limits.get("memory_limit_kb")
        submission_kind_code = str(submission.get("submission_kind_code") or "").strip().lower()
        custom_input = str(submission.get("custom_input") or "")
        custom_cases = list(submission.get("custom_cases") or [])
        if not custom_cases and custom_input != "":
            custom_cases = [{"id": "custom-input", "input": custom_input, "expected_output": None}]
        requested_testset_id = str(submission.get("requested_testset_id") or "").strip()

        testcases = list(problem_context.get("testcases") or [])
        should_run_testcases = submission_kind_code == "practice" or (
            submission_kind_code == "run" and bool(requested_testset_id) and bool(testcases)
        )
        should_run_custom = submission_kind_code == "run" and bool(custom_cases)
        if submission_kind_code == "practice" and not should_run_testcases:
            return build_completion_payload(
                worker_name=worker_name,
                compile_result={
                    **compile_result,
                    "status_code": "ie",
                    "message": "The selected problem does not have an active testset with testcases.",
                },
                testcase_results=[],
                final_verdict="ie",
                final_status="failed",
            )
        if submission_kind_code == "run" and not should_run_testcases and not should_run_custom:
            return build_completion_payload(
                worker_name=worker_name,
                compile_result={
                    **compile_result,
                    "status_code": "ie",
                    "message": "Interactive run requires visible sample testcases, custom input, or both.",
                },
                testcase_results=[],
                final_verdict="ie",
                final_status="failed",
            )

        checker_runtime_plan: dict[str, str] | None = None
        checker_workspace: Path | None = None
        if checker_type_code == "custom" and should_run_testcases:
            checker_runtime = problem_context.get("checker_runtime")
            if checker_runtime is None:
                return build_completion_payload(
                    worker_name=worker_name,
                    compile_result={
                        **compile_result,
                        "status_code": "ie",
                        "message": "Custom checker runtime context was not provided.",
                    },
                    testcase_results=[],
                    final_verdict="ie",
                    final_status="failed",
                )

            checker_workspace = workspace / "__checker__"
            checker_workspace.mkdir(parents=True, exist_ok=True)
            checker_runtime_plan = build_runtime_plan(
                checker_runtime,
                entrypoint=checker.get("entrypoint"),
            )
            checker_compiled = False
            compiled_object = checker.get("compiled_object")
            if compiled_object is not None:
                try:
                    checker_compiled = restore_compiled_artifact(
                        checker_workspace,
                        checker_runtime_plan,
                        compiled_object,
                    )
                except Exception:
                    logger.exception(
                        "failed to restore compiled checker artifact; recompiling",
                        extra={
                            "checker_id": checker.get("id"),
                            "problem_id": problem_context["problem"]["id"],
                        },
                    )

            if not checker_compiled:
                write_runtime_source(
                    checker_workspace,
                    checker_runtime_plan,
                    load_checker_source_bytes(checker),
                )
                checker_compile_result = compile_runtime_source(
                    checker_runtime_plan,
                    workspace=checker_workspace,
                    limits=limits,
                )
                if checker_compile_result["status_code"] != "ac":
                    return build_completion_payload(
                        worker_name=worker_name,
                        compile_result={
                            **compile_result,
                            "status_code": "ie",
                            "message": "Custom checker compilation failed.",
                            "checker_message": checker_compile_result.get("checker_message"),
                        },
                        testcase_results=[],
                        final_verdict="ie",
                        final_status="failed",
                    )
                try:
                    cached_object = cache_compiled_checker_artifact(
                        problem_service_url=problem_service_url,
                        problem_id=str(problem_context["problem"]["id"]),
                        checker=checker,
                        runtime_plan=checker_runtime_plan,
                        workspace=checker_workspace,
                        trace_id=trace_id,
                    )
                    if cached_object is not None:
                        checker = {**checker, "compiled_object": cached_object}
                except Exception:
                    logger.exception(
                        "failed to persist compiled checker artifact",
                        extra={
                            "checker_id": checker.get("id"),
                            "problem_id": problem_context["problem"]["id"],
                        },
                    )

        testcase_results: list[dict[str, Any]] = []
        final_verdict = "ac"
        if should_run_testcases:
            for index, testcase in enumerate(testcases):
                input_bytes = load_case_bytes(testcase.get("input_text"), testcase.get("input_object"))
                expected_output = load_case_bytes(
                    testcase.get("expected_output_text"),
                    testcase.get("expected_output_object"),
                )
                execution = run_process(
                    run_command,
                    cwd=workspace,
                    stdin_bytes=input_bytes,
                    timeout_seconds=timeout_seconds,
                    memory_limit_kb=memory_limit_kb,
                )
                if checker_type_code == "custom":
                    if checker_runtime_plan is None or checker_workspace is None:
                        raise RuntimeError("Custom checker workspace was not prepared.")
                    testcase_result = evaluate_custom_checker_result(
                        testcase,
                        execution,
                        input_bytes=input_bytes,
                        expected_output=expected_output,
                        checker_runtime_plan=checker_runtime_plan,
                        checker_workspace=checker_workspace,
                        timeout_seconds=timeout_seconds,
                        memory_limit_kb=memory_limit_kb,
                    )
                else:
                    testcase_result = evaluate_testcase_result(
                        testcase,
                        execution,
                        input_bytes=input_bytes,
                        expected_output=expected_output,
                    )
                testcase_results.append(testcase_result)
                if testcase_result["status_code"] != "ac" and final_verdict == "ac":
                    final_verdict = testcase_result["status_code"]
                if submission_kind_code != "run" and testcase_result["status_code"] != "ac":
                    for remaining in testcases[index + 1 :]:
                        testcase_results.append(build_skipped_result(remaining))
                    break

        if should_run_custom:
            for custom_case in custom_cases:
                custom_execution = run_process(
                    run_command,
                    cwd=workspace,
                    stdin_bytes=str(custom_case.get("input") or "").encode("utf-8"),
                    timeout_seconds=timeout_seconds,
                    memory_limit_kb=memory_limit_kb,
                )
                custom_result, custom_verdict = evaluate_custom_input_result(
                    custom_case,
                    custom_execution,
                )
                testcase_results.append(custom_result)
                if custom_verdict != "ac" and final_verdict == "ac":
                    final_verdict = custom_verdict

        final_status = "failed" if final_verdict == "ie" else "done"
        return build_completion_payload(
            worker_name=worker_name,
            compile_result=compile_result,
            testcase_results=testcase_results,
            final_verdict=final_verdict,
            final_status=final_status,
        )


def build_internal_error_completion(worker_name: str, error: Exception) -> dict[str, Any]:
    message = str(error) or error.__class__.__name__
    return {
        "worker_name": worker_name,
        "status_code": "failed",
        "verdict_code": "ie",
        "runtime_ms": 0,
        "memory_kb": 0,
        "compile_exit_code": None,
        "compile_time_ms": 0,
        "results": [
            {
                "result_type_code": "compile",
                "status_code": "ie",
                "runtime_ms": 0,
                "memory_kb": 0,
                "message": f"Worker execution failed: {message}",
                "checker_message": None,
                "exit_code": None,
                "signal": None,
            }
        ],
    }


def process_message(
    queue: SQSJudgeQueue,
    submission_service_url: str,
    problem_service_url: str,
    worker_name: str,
    worker_version: str,
    raw_message: dict[str, Any],
) -> None:
    body = json.loads(raw_message["Body"])
    judge_message = JudgeJobMessage.from_dict(body)

    submission_context = fetch_submission_context(
        submission_service_url,
        judge_message.judge_job_id,
        trace_id=judge_message.trace_id,
    )
    submission = submission_context["submission"]
    submission_kind_code = str(submission.get("submission_kind_code") or "").strip().lower()
    requested_testset_id = str(submission.get("requested_testset_id") or "").strip() or None
    problem_context = fetch_problem_context(
        problem_service_url,
        judge_message.problem_id,
        trace_id=judge_message.trace_id,
        requested_testset_id=requested_testset_id if submission_kind_code == "run" else None,
        samples_only=submission_kind_code == "run" and requested_testset_id is not None,
    )
    checker = problem_context.get("active_checker")
    if (
        (submission_kind_code == "practice" or requested_testset_id is not None)
        and
        problem_context.get("testcases")
        and
        checker is not None
        and str(checker.get("checker_type_code", "")).strip().lower() == "custom"
        and checker.get("runtime_profile_key")
    ):
        problem_context = {
            **problem_context,
            "checker_runtime": fetch_runtime_context(
                submission_service_url,
                str(checker["runtime_profile_key"]),
                trace_id=judge_message.trace_id,
            ),
        }
    limits = resolve_limits(submission_context, problem_context)

    notify_submission_service(
        submission_service_url,
        f"/internal/judge-jobs/{judge_message.judge_job_id}/started",
        {
            "worker_name": worker_name,
            "worker_version": worker_version,
            "limits_json": limits,
        },
        trace_id=judge_message.trace_id,
    )

    try:
        completion_payload = execute_submission(
            submission_context,
            problem_context,
            problem_service_url=problem_service_url,
            trace_id=judge_message.trace_id,
            worker_name=worker_name,
        )
    except Exception as exc:
        logger.exception(
            "worker execution failed after job start",
            extra={
                "judge_job_id": judge_message.judge_job_id,
                "submission_id": judge_message.submission_id,
                "worker_name": worker_name,
            },
        )
        completion_payload = build_internal_error_completion(worker_name, exc)

    notify_submission_service(
        submission_service_url,
        f"/internal/judge-jobs/{judge_message.judge_job_id}/completed",
        completion_payload,
        trace_id=judge_message.trace_id,
    )

    queue.delete_message(raw_message["ReceiptHandle"])
    logger.info(
        "judge job processed",
        extra={
            "judge_job_id": judge_message.judge_job_id,
            "submission_id": judge_message.submission_id,
            "worker_name": worker_name,
            "verdict": completion_payload["verdict_code"],
            "status": completion_payload["status_code"],
        },
    )


def main() -> None:
    configure_logging()

    worker_name = os.getenv("WORKER_NAME", "worker-local-1")
    worker_version = os.getenv("WORKER_VERSION", "0.1.0")
    submission_service_url = os.getenv("SUBMISSION_SERVICE_URL", "")
    problem_service_url = os.getenv("PROBLEM_SERVICE_URL", "")
    interval_seconds = int(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "15"))

    bootstrap_summary = bootstrap_service(
        SETTINGS,
        apply_schema=False,
        ensure_storage_buckets=False,
        ensure_judge_queue=True,
    )
    queue = SQSJudgeQueue(SETTINGS.queue)

    logger.info(
        "worker booted",
        extra={
            "worker_name": worker_name,
            "submission_service_url": submission_service_url,
            "problem_service_url": problem_service_url,
            "bootstrap_summary": bootstrap_summary,
        },
    )

    try:
        while True:
            messages = queue.receive_messages(
                max_messages=1,
                wait_seconds=min(interval_seconds, 10),
                visibility_timeout=max(interval_seconds * 2, 30),
            )
            if not messages:
                logger.info("worker heartbeat", extra={"worker_name": worker_name})
                time.sleep(interval_seconds)
                continue

            for raw_message in messages:
                try:
                    process_message(
                        queue,
                        submission_service_url,
                        problem_service_url,
                        worker_name,
                        worker_version,
                        raw_message,
                    )
                except Exception:
                    logger.exception(
                        "worker failed to process judge message",
                        extra={"worker_name": worker_name},
                    )
    except KeyboardInterrupt:
        logger.info("worker shutdown requested", extra={"worker_name": worker_name})


if __name__ == "__main__":
    main()
