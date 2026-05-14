# Hexacode Todo Tracker

Use this document to track app fixes, production gaps, and follow-up work.

## Priority Legend

- **P0**: Blocks production or causes data loss/security risk
- **P1**: Important production-readiness or correctness issue
- **P2**: Improvement, cleanup, or quality-of-life fix

## Open Todos

### P1 — Persist submission artifacts to EFS-backed storage

**Status:** Open

**Problem:** The approved production direction is for EFS to be the source of truth for submission source, stdout, stderr, and compile-log artifacts, but the current submission flow mostly stores data directly in Postgres.

**Current behavior:**

- Submitted source code is stored inline in `submission.submissions.source_code`.
- Compile/testcase output is stored as short previews in `submission.results` fields such as `actual_output_preview`, `checker_message`, and `message`.
- `source_object_id`, `stdout_object_id`, and `stderr_object_id` are usually `null`.
- The frontend already supports download buttons when `stdout_object_id` or `stderr_object_id` exists, but the worker usually does not create those objects today.

**Desired behavior:**

- Write durable submission artifacts to EFS-backed storage.
- Register each artifact in `storage.objects` with enough metadata to resolve the filesystem path safely.
- Store the resulting object IDs in:
  - `submission.submissions.source_object_id`
  - `submission.results.stdout_object_id`
  - `submission.results.stderr_object_id`
  - `submission.judge_runs.compile_log_object_id`
- Keep short previews in Postgres for fast UI rendering.

**Likely files to inspect/change:**

- `hexacode-backend/services/submission-service/app/main.py`
- `hexacode-backend/services/worker/app/main.py`
- `hexacode-backend/backend_common/storage.py`
- `hexacode-backend/db/new-app-schema.sql`
- `hexacode-frontend/src/routes/submission-detail.tsx`
- Terraform/IAM config for EFS mount and access permissions

**Notes:**

- Current code imports `upload_object_bytes` in the worker, but it is mainly used for compiled checker artifact caching, not normal submission stdout/stderr/source artifacts.
- The schema is already prepared for object-backed source/stdout/stderr via `storage.objects` references.
- Keep the todo aligned with the approved EFS source-of-truth direction rather than the earlier S3 bucket plan.

---

## Backlog

Add new items below using this format:

```markdown
### P1 — Short title

**Status:** Open

**Problem:** What is broken or missing?

**Desired behavior:** What should happen instead?

**Likely files to inspect/change:**

- `path/to/file`

**Notes:** Extra context, risks, or decisions needed.
```
