-- Core database schema for the new app.
-- Derived from the legacy schema, but trimmed to the active platform path:
-- - app-owned Cognito user shadow
-- - object storage metadata for MinIO/S3
-- - problem domain
-- - submission + worker domain
--
-- Deferred legacy domains are intentionally excluded here:
-- - provider / role / permission / session / refresh-token auth tables
-- - contests, teams, scoreboards
-- - class / semester / subject
-- - discussions / editorials / reports / notifications
-- - wallet / payment / rating / badge / study-plan

begin;

drop table if exists public.schema_migrations;

create extension if not exists pgcrypto;

create schema if not exists app_identity;
create schema if not exists storage;
create schema if not exists problem;
create schema if not exists submission;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists app_identity.users (
  id uuid primary key default gen_random_uuid(),
  cognito_sub text not null,
  username text,
  status_code text not null default 'active'
    check (status_code in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_app_identity_users_cognito_sub unique (cognito_sub)
);

alter table if exists app_identity.users
  add column if not exists username text;

update app_identity.users
set username = cognito_sub
where username is null;

comment on table app_identity.users is
  'Minimal local identity map for AWS Cognito. Keeps UUID foreign keys local while Cognito remains the source of truth.';

create table if not exists app_identity.roles (
  code text primary key,
  name text not null,
  description text
);

create table if not exists app_identity.permissions (
  code text primary key,
  description text
);

create table if not exists app_identity.role_permissions (
  role_code text not null references app_identity.roles(code) on delete cascade,
  permission_code text not null references app_identity.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table if not exists app_identity.user_role_assignments (
  user_id uuid not null references app_identity.users(id) on delete cascade,
  role_code text not null references app_identity.roles(code) on delete cascade,
  granted_by_user_id uuid references app_identity.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role_code)
);

create index if not exists ix_app_identity_user_role_assignments_role_code
  on app_identity.user_role_assignments (role_code, created_at desc);

comment on table app_identity.user_role_assignments is
  'App-owned role assignments. Cognito remains the identity provider, but authorization is resolved from these rows.';

insert into app_identity.roles (code, name, description)
values
  ('contestant', 'Contestant', 'Default authenticated platform user.'),
  ('author', 'Author', 'Can create and manage owned problem content.'),
  ('reviewer', 'Reviewer', 'Can review and publish problem content.'),
  ('moderator', 'Moderator', 'Can manage users and operational admin surfaces.'),
  ('admin', 'Admin', 'Full platform administrator.')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description;

insert into app_identity.permissions (code, description)
values
  ('problem.read_public', 'Read public problems and files.'),
  ('submission.create', 'Create submissions.'),
  ('submission.read_own', 'Read own submissions and source.'),
  ('submission.read_public_summary', 'Read public submission summaries.'),
  ('submission.read_public_detail', 'Read public submission details.'),
  ('problem.create', 'Create problems.'),
  ('problem.read_own_dashboard', 'Read owned problems in the dashboard.'),
  ('problem.update_own_draft', 'Update owned draft/rejected problems.'),
  ('problem.delete_own_draft', 'Delete owned problems when allowed.'),
  ('problem.request_review_own', 'Request review for owned problems.'),
  ('problem.archive_own', 'Archive owned problems.'),
  ('testset.manage_own', 'Manage owned problem testsets and testcases.'),
  ('tag.read_dashboard', 'Read dashboard tag catalog.'),
  ('problem.read_review_queue', 'Read the pending problem review queue.'),
  ('problem.review', 'Approve or reject reviewed problems.'),
  ('problem.publish', 'Publish approved problems.'),
  ('problem.unpublish', 'Unpublish published problems.'),
  ('problem.archive_any', 'Archive any problem.'),
  ('tag.create', 'Create dashboard tags.'),
  ('tag.update', 'Update dashboard tags.'),
  ('tag.lifecycle', 'Activate or deactivate dashboard tags.'),
  ('tag.delete', 'Delete dashboard tags.'),
  ('user.read_directory', 'Read the dashboard user directory.'),
  ('user.disable', 'Disable local users.'),
  ('user.enable', 'Enable local users.'),
  ('role.grant', 'Grant app roles to users.'),
  ('role.revoke', 'Revoke app roles from users.'),
  ('ops.read_dashboard', 'Read operations dashboard surfaces.'),
  ('ops.manage_storage_orphans', 'Inspect or clean orphaned storage rows.'),
  ('ops.read_worker_state', 'Read worker state.'),
  ('ops.read_queue_state', 'Read queue and job state.'),
  ('admin.full', 'Full administrator bypass.')
on conflict (code) do update
set description = excluded.description;

insert into app_identity.role_permissions (role_code, permission_code)
values
  ('contestant', 'problem.read_public'),
  ('contestant', 'submission.create'),
  ('contestant', 'submission.read_own'),
  ('contestant', 'submission.read_public_summary'),
  ('contestant', 'submission.read_public_detail'),
  ('author', 'problem.create'),
  ('author', 'problem.read_own_dashboard'),
  ('author', 'problem.update_own_draft'),
  ('author', 'problem.delete_own_draft'),
  ('author', 'problem.request_review_own'),
  ('author', 'problem.archive_own'),
  ('author', 'testset.manage_own'),
  ('author', 'tag.read_dashboard'),
  ('reviewer', 'problem.read_own_dashboard'),
  ('reviewer', 'tag.read_dashboard'),
  ('reviewer', 'problem.read_review_queue'),
  ('reviewer', 'problem.review'),
  ('reviewer', 'problem.publish'),
  ('reviewer', 'problem.unpublish'),
  ('reviewer', 'problem.archive_any'),
  ('reviewer', 'tag.create'),
  ('reviewer', 'tag.update'),
  ('reviewer', 'tag.lifecycle'),
  ('reviewer', 'tag.delete'),
  ('moderator', 'user.read_directory'),
  ('moderator', 'user.disable'),
  ('moderator', 'user.enable'),
  ('moderator', 'role.grant'),
  ('moderator', 'role.revoke'),
  ('moderator', 'ops.read_dashboard'),
  ('moderator', 'ops.manage_storage_orphans'),
  ('moderator', 'ops.read_worker_state'),
  ('moderator', 'ops.read_queue_state'),
  ('admin', 'admin.full')
on conflict do nothing;

create or replace view app_identity.user_effective_permissions as
select distinct
  assignments.user_id,
  role_permissions.permission_code
from app_identity.user_role_assignments as assignments
join app_identity.role_permissions
  on role_permissions.role_code = assignments.role_code;

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  object_key text not null,
  content_type text,
  original_filename text,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9A-Fa-f]{64}$'),
  etag text,
  metadata_json jsonb not null default '{}'::jsonb,
  uploaded_by_user_id uuid references app_identity.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_storage_objects_bucket_key unique (bucket, object_key)
);

comment on table storage.objects is
  'Logical object metadata for the shared S3-compatible storage contract used by MinIO locally and S3 in cloud.';

create index if not exists ix_storage_objects_sha256
  on storage.objects (sha256)
  where sha256 is not null;

create table if not exists problem.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  color text,
  icon text,
  is_active boolean not null default true,
  created_by_user_id uuid references app_identity.users(id) on delete set null,
  updated_by_user_id uuid references app_identity.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_problem_tags_slug_ci
  on problem.tags (lower(slug));

create unique index if not exists uq_problem_tags_name_ci
  on problem.tags (lower(name));

create table if not exists problem.problems (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  summary_md text,
  statement_source_code text not null default 'inline_md'
    check (statement_source_code in ('inline_md', 'object_md', 'object_pdf')),
  statement_md text,
  statement_object_id uuid references storage.objects(id),
  difficulty_code text
    check (difficulty_code is null or difficulty_code in ('easy', 'medium', 'hard')),
  type_code text not null default 'traditional',
  visibility_code text not null default 'private'
    check (visibility_code in ('private', 'public')),
  scoring_code text not null default 'icpc'
    check (scoring_code in ('icpc', 'ioi')),
  status_code text not null default 'draft'
    check (status_code in ('draft', 'pending_review', 'approved', 'published', 'rejected', 'archived')),
  display_index int,
  time_limit_ms int check (time_limit_ms is null or time_limit_ms > 0),
  memory_limit_kb int check (memory_limit_kb is null or memory_limit_kb > 0),
  output_limit_kb int check (output_limit_kb is null or output_limit_kb > 0),
  is_active boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references app_identity.users(id) on delete set null,
  updated_by_user_id uuid references app_identity.users(id) on delete set null,
  reviewed_by_user_id uuid references app_identity.users(id) on delete set null,
  published_by_user_id uuid references app_identity.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  constraint ck_problem_problems_statement_source
    check (
      (statement_source_code = 'inline_md' and statement_md is not null and statement_object_id is null)
      or
      (statement_source_code in ('object_md', 'object_pdf') and statement_md is null and statement_object_id is not null)
    ),
  constraint ck_problem_problems_review_actor_pair
    check (
      (reviewed_at is null and reviewed_by_user_id is null)
      or
      (reviewed_at is not null and reviewed_by_user_id is not null)
    ),
  constraint ck_problem_problems_publish_actor_pair
    check (
      (published_at is null and published_by_user_id is null)
      or
      (published_at is not null and published_by_user_id is not null)
    ),
  constraint ck_problem_problems_publish_consistency
    check (
      (status_code = 'published' and published_at is not null)
      or
      (status_code <> 'published' and (published_at is null or status_code = 'archived'))
    )
);

comment on table problem.problems is
  'Core problem catalog. Statement content is inline markdown or an object-store reference.';

create unique index if not exists uq_problem_problems_slug_ci
  on problem.problems (lower(slug));

create index if not exists ix_problem_problems_public_listing
  on problem.problems (status_code, visibility_code, published_at desc, display_index, created_at desc);

create index if not exists ix_problem_problems_created_by
  on problem.problems (created_by_user_id, created_at desc);

create table if not exists problem.problem_assets (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references problem.problems(id) on delete cascade,
  storage_object_id uuid not null references storage.objects(id),
  asset_role_code text not null default 'statement_media'
    check (asset_role_code in ('statement_media', 'statement_attachment')),
  logical_name text,
  sort_order int not null default 0,
  created_by_user_id uuid references app_identity.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_problem_problem_assets_problem_object unique (problem_id, storage_object_id)
);

create index if not exists ix_problem_problem_assets_problem_role_sort
  on problem.problem_assets (problem_id, asset_role_code, sort_order, created_at);

create table if not exists problem.problem_tags (
  problem_id uuid not null references problem.problems(id) on delete cascade,
  tag_id uuid not null references problem.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (problem_id, tag_id)
);

create index if not exists ix_problem_problem_tags_tag_problem
  on problem.problem_tags (tag_id, problem_id);

create table if not exists problem.testsets (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references problem.problems(id) on delete cascade,
  testset_type_code text not null
    check (testset_type_code in ('primary', 'samples', 'hidden', 'custom')),
  title text,
  is_active boolean not null default true,
  note text,
  archive_object_id uuid references storage.objects(id) on delete set null,
  extracted_case_count int not null default 0 check (extracted_case_count >= 0),
  metadata_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references app_identity.users(id) on delete set null,
  updated_by_user_id uuid references app_identity.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table problem.testsets is
  'Canonical testset records. Uploaded archives live in object storage and extracted cases are tracked separately.';

create index if not exists ix_problem_testsets_problem_active_type
  on problem.testsets (problem_id, is_active, testset_type_code, created_at desc);

create unique index if not exists uq_problem_testsets_active_primary
  on problem.testsets (problem_id)
  where testset_type_code = 'primary' and is_active;

create table if not exists problem.testcases (
  id uuid primary key default gen_random_uuid(),
  testset_id uuid not null references problem.testsets(id) on delete cascade,
  ordinal int not null check (ordinal > 0),
  weight int not null default 1 check (weight > 0),
  is_sample boolean not null default false,
  input_object_id uuid references storage.objects(id),
  expected_output_object_id uuid references storage.objects(id),
  input_text text,
  expected_output_text text,
  note text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint uq_problem_testcases_testset_ordinal unique (testset_id, ordinal)
);

create index if not exists ix_problem_testcases_testset_sample_ordinal
  on problem.testcases (testset_id, is_sample, ordinal);

create table if not exists problem.checkers (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references problem.problems(id) on delete cascade,
  testset_id uuid references problem.testsets(id) on delete set null,
  checker_type_code text not null default 'diff'
    check (checker_type_code in ('diff', 'custom')),
  runtime_profile_key text,
  source_object_id uuid references storage.objects(id),
  compiled_object_id uuid references storage.objects(id) on delete set null,
  entrypoint text,
  is_active boolean not null default true,
  note text,
  created_by_user_id uuid references app_identity.users(id) on delete set null,
  updated_by_user_id uuid references app_identity.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_problem_checkers_shape
    check (
      (checker_type_code = 'diff' and runtime_profile_key is null and source_object_id is null)
      or
      (checker_type_code = 'custom' and runtime_profile_key is not null and source_object_id is not null)
    )
);

create index if not exists ix_problem_checkers_problem_active
  on problem.checkers (problem_id, is_active, checker_type_code);

create table if not exists problem.problem_stats (
  problem_id uuid primary key references problem.problems(id) on delete cascade,
  submissions_count bigint not null default 0 check (submissions_count >= 0),
  accepted_count bigint not null default 0 check (accepted_count >= 0),
  unique_solvers_count bigint not null default 0 check (unique_solvers_count >= 0),
  avg_time_ms bigint check (avg_time_ms is null or avg_time_ms >= 0),
  avg_memory_kb bigint check (avg_memory_kb is null or avg_memory_kb >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists submission.runtimes (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null,
  runtime_name text not null,
  runtime_version text,
  source_file_name text not null,
  image_ref text,
  compile_command text not null default '',
  run_command text not null,
  default_time_limit_ms int not null default 1000 check (default_time_limit_ms > 0),
  default_memory_limit_kb int not null default 262144 check (default_memory_limit_kb > 0),
  default_output_limit_kb int check (default_output_limit_kb is null or default_output_limit_kb > 0),
  is_active boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table submission.runtimes is
  'Language/runtime catalog used by the worker. profile_key is the stable contract between API and worker.';

create unique index if not exists uq_submission_runtimes_profile_key_ci
  on submission.runtimes (lower(profile_key));

create index if not exists ix_submission_runtimes_is_active
  on submission.runtimes (is_active, runtime_name);

create table if not exists submission.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_identity.users(id),
  problem_id uuid not null references problem.problems(id),
  runtime_id uuid not null references submission.runtimes(id),
  source_object_id uuid references storage.objects(id),
  source_code text,
  source_size_bytes bigint not null default 0 check (source_size_bytes >= 0),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  source_filename text,
  status_code text not null default 'queued'
    check (status_code in ('queued', 'running', 'done', 'failed', 'cancelled')),
  verdict_code text
    check (verdict_code is null or verdict_code in ('ac', 'wa', 'tle', 'mle', 'ce', 're', 'ie')),
  submission_kind_code text not null default 'practice'
    check (submission_kind_code in ('practice', 'run')),
  final_score numeric(18,2) check (final_score is null or final_score >= 0),
  time_ms int check (time_ms is null or time_ms >= 0),
  memory_kb int check (memory_kb is null or memory_kb >= 0),
  output_kb int check (output_kb is null or output_kb >= 0),
  judged_at timestamptz,
  testset_id uuid references problem.testsets(id),
  testcase_id uuid references problem.testcases(id),
  custom_input text,
  note text,
  ip_address inet,
  user_agent text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_submission_submissions_has_source
    check (source_object_id is not null or source_code is not null),
  constraint ck_submission_submissions_done_requires_verdict
    check (status_code <> 'done' or verdict_code is not null),
  constraint ck_submission_submissions_status_judged_at
    check (
      (status_code in ('queued', 'running') and judged_at is null and verdict_code is null)
      or
      (status_code in ('done', 'failed', 'cancelled') and judged_at is not null)
    ),
  constraint ck_submission_submissions_custom_input
    check (
      (submission_kind_code = 'run' and (custom_input is not null or testset_id is not null))
      or
      (submission_kind_code <> 'run')
    )
);

comment on table submission.submissions is
  'Practice and interactive run submissions only. Contest-coupled submission tables stay in the legacy path for now.';

create index if not exists ix_submission_submissions_user_problem_created_at
  on submission.submissions (user_id, problem_id, created_at desc);

create index if not exists ix_submission_submissions_problem_created_at
  on submission.submissions (problem_id, created_at desc);

create index if not exists ix_submission_submissions_status_verdict_created_at
  on submission.submissions (status_code, verdict_code, created_at desc);

create index if not exists ix_submission_submissions_runtime_created_at
  on submission.submissions (runtime_id, created_at desc);

alter table if exists submission.submissions
  drop constraint if exists submission_submissions_submission_kind_code_check;

alter table if exists submission.submissions
  drop constraint if exists submissions_submission_kind_code_check;

alter table if exists submission.submissions
  add constraint submission_submissions_submission_kind_code_check
  check (submission_kind_code in ('practice', 'run'));

alter table if exists submission.submissions
  drop constraint if exists ck_submission_submissions_custom_input;

alter table if exists submission.submissions
  add constraint ck_submission_submissions_custom_input
  check (
    (submission_kind_code = 'run' and (custom_input is not null or testset_id is not null))
    or
    (submission_kind_code <> 'run')
  );

create table if not exists submission.judge_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text,
  status_code text not null default 'starting'
    check (status_code in ('starting', 'online', 'busy', 'offline', 'draining', 'error')),
  capabilities_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capabilities_json) = 'array'),
  max_parallel_jobs int not null default 1 check (max_parallel_jobs > 0),
  running_jobs int not null default 0 check (running_jobs >= 0),
  cpu_usage_percent numeric(5,2)
    check (cpu_usage_percent is null or (cpu_usage_percent >= 0 and cpu_usage_percent <= 100)),
  memory_used_mb int check (memory_used_mb is null or memory_used_mb >= 0),
  memory_total_mb int check (memory_total_mb is null or memory_total_mb > 0),
  last_seen_at timestamptz,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  constraint uq_submission_judge_workers_name unique (name)
);

create index if not exists ix_submission_judge_workers_last_seen_at
  on submission.judge_workers (last_seen_at);

create index if not exists ix_submission_judge_workers_status_last_seen
  on submission.judge_workers (status_code, last_seen_at desc);

create table if not exists submission.judge_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submission.submissions(id) on delete cascade,
  enqueue_at timestamptz not null default now(),
  dequeued_by_worker_id uuid references submission.judge_workers(id) on delete set null,
  dequeued_at timestamptz,
  finished_at timestamptz,
  status_code text not null default 'queued'
    check (status_code in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts > 0),
  last_error text,
  priority int not null default 0,
  triggered_by_user_id uuid references app_identity.users(id) on delete set null,
  trigger_type_code text not null default 'submit'
    check (trigger_type_code in ('submit', 'rejudge', 'admin', 'system')),
  trigger_reason text,
  options_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_submission_judge_jobs_dequeue_worker
    check (dequeued_at is null or dequeued_by_worker_id is not null),
  constraint ck_submission_judge_jobs_finished_state
    check (
      (status_code in ('queued', 'running') and finished_at is null)
      or
      (status_code in ('done', 'failed', 'cancelled') and finished_at is not null)
    )
);

create index if not exists ix_submission_judge_jobs_status_priority_enqueue_at
  on submission.judge_jobs (status_code, priority desc, enqueue_at);

create index if not exists ix_submission_judge_jobs_submission_created_at
  on submission.judge_jobs (submission_id, created_at desc);

create unique index if not exists uq_submission_judge_jobs_one_active_per_submission
  on submission.judge_jobs (submission_id)
  where status_code in ('queued', 'running');

create table if not exists submission.judge_runs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submission.submissions(id) on delete cascade,
  judge_job_id uuid references submission.judge_jobs(id) on delete set null,
  worker_id uuid references submission.judge_workers(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status_code text not null
    check (status_code in ('running', 'done', 'failed', 'cancelled')),
  runtime_id uuid references submission.runtimes(id) on delete set null,
  container_image text,
  limits_json jsonb not null default '{}'::jsonb,
  note text,
  compile_log_object_id uuid references storage.objects(id) on delete set null,
  compile_exit_code int,
  compile_time_ms int check (compile_time_ms is null or compile_time_ms >= 0),
  total_time_ms int check (total_time_ms is null or total_time_ms >= 0),
  total_memory_kb int check (total_memory_kb is null or total_memory_kb >= 0),
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ck_submission_judge_runs_finished_state
    check (
      (status_code = 'running' and finished_at is null)
      or
      (status_code in ('done', 'failed', 'cancelled') and finished_at is not null)
    )
);

create index if not exists ix_submission_judge_runs_submission_started_at
  on submission.judge_runs (submission_id, started_at desc);

create index if not exists ix_submission_judge_runs_worker_started_at
  on submission.judge_runs (worker_id, started_at desc);

create unique index if not exists uq_submission_judge_runs_one_active_per_submission
  on submission.judge_runs (submission_id)
  where status_code = 'running';

create table if not exists submission.results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submission.submissions(id) on delete cascade,
  judge_run_id uuid references submission.judge_runs(id) on delete cascade,
  testcase_id uuid references problem.testcases(id) on delete set null,
  result_type_code text not null default 'testcase'
    check (result_type_code in ('compile', 'testcase', 'custom_case')),
  status_code text not null
    check (status_code in ('ac', 'wa', 'tle', 'mle', 'ce', 're', 'ie', 'skipped')),
  runtime_ms int check (runtime_ms is null or runtime_ms >= 0),
  memory_kb int check (memory_kb is null or memory_kb >= 0),
  input_preview text,
  expected_output_preview text,
  actual_output_preview text,
  stdout_object_id uuid references storage.objects(id) on delete set null,
  stderr_object_id uuid references storage.objects(id) on delete set null,
  checker_message text,
  exit_code int,
  signal int,
  message text,
  note text,
  created_at timestamptz not null default now(),
  constraint ck_submission_results_compile_shape
    check (
      (result_type_code = 'compile' and testcase_id is null)
      or
      (result_type_code = 'testcase' and testcase_id is not null)
      or
      (result_type_code = 'custom_case' and testcase_id is null)
    )
);

alter table if exists submission.results
  drop constraint if exists submission_results_result_type_code_check;

alter table if exists submission.results
  drop constraint if exists results_result_type_code_check;

alter table if exists submission.results
  add constraint submission_results_result_type_code_check
  check (result_type_code in ('compile', 'testcase', 'custom_case'));

alter table if exists submission.results
  drop constraint if exists ck_submission_results_compile_shape;

alter table if exists submission.results
  add constraint ck_submission_results_compile_shape
  check (
    (result_type_code = 'compile' and testcase_id is null)
    or
    (result_type_code = 'testcase' and testcase_id is not null)
    or
    (result_type_code = 'custom_case' and testcase_id is null)
  );

create index if not exists ix_submission_results_submission_created_at
  on submission.results (submission_id, created_at desc);

create index if not exists ix_submission_results_judge_run_id
  on submission.results (judge_run_id);

create index if not exists ix_submission_results_testcase_id
  on submission.results (testcase_id);

create table if not exists submission.run_metrics (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submission.submissions(id) on delete cascade,
  runtime_ms int not null default 0 check (runtime_ms >= 0),
  memory_kb int not null default 0 check (memory_kb >= 0),
  cpu_usage_percent numeric(5,2)
    check (cpu_usage_percent is null or (cpu_usage_percent >= 0 and cpu_usage_percent <= 100)),
  passed_testcases int not null default 0 check (passed_testcases >= 0),
  total_testcases int not null default 0 check (total_testcases >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_submission_run_metrics_submission unique (submission_id),
  constraint ck_submission_run_metrics_passed_lte_total
    check (passed_testcases <= total_testcases)
);

create table if not exists submission.outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload_json jsonb not null,
  status_code text not null default 'pending'
    check (status_code in ('pending', 'published', 'failed')),
  retry_count int not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,
  last_error text,
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ck_submission_outbox_events_published_state
    check (
      (status_code = 'published' and published_at is not null)
      or
      (status_code in ('pending', 'failed') and published_at is null)
    )
);

comment on table submission.outbox_events is
  'Submission-service outbox for queue/event publishing. Keeps queue transport changes separate from state ownership.';

create index if not exists ix_submission_outbox_events_status_occurred_at
  on submission.outbox_events (status_code, occurred_at);

create index if not exists ix_submission_outbox_events_aggregate
  on submission.outbox_events (aggregate_type, aggregate_id, occurred_at desc);

drop trigger if exists trg_app_identity_users_touch_updated_at on app_identity.users;
create trigger trg_app_identity_users_touch_updated_at
before update on app_identity.users
for each row execute function public.touch_updated_at();

drop trigger if exists trg_storage_objects_touch_updated_at on storage.objects;
create trigger trg_storage_objects_touch_updated_at
before update on storage.objects
for each row execute function public.touch_updated_at();

drop trigger if exists trg_problem_tags_touch_updated_at on problem.tags;
create trigger trg_problem_tags_touch_updated_at
before update on problem.tags
for each row execute function public.touch_updated_at();

drop trigger if exists trg_problem_problems_touch_updated_at on problem.problems;
create trigger trg_problem_problems_touch_updated_at
before update on problem.problems
for each row execute function public.touch_updated_at();

drop trigger if exists trg_problem_testsets_touch_updated_at on problem.testsets;
create trigger trg_problem_testsets_touch_updated_at
before update on problem.testsets
for each row execute function public.touch_updated_at();

drop trigger if exists trg_problem_checkers_touch_updated_at on problem.checkers;
create trigger trg_problem_checkers_touch_updated_at
before update on problem.checkers
for each row execute function public.touch_updated_at();

drop trigger if exists trg_problem_problem_stats_touch_updated_at on problem.problem_stats;
create trigger trg_problem_problem_stats_touch_updated_at
before update on problem.problem_stats
for each row execute function public.touch_updated_at();

drop trigger if exists trg_submission_runtimes_touch_updated_at on submission.runtimes;
create trigger trg_submission_runtimes_touch_updated_at
before update on submission.runtimes
for each row execute function public.touch_updated_at();

drop trigger if exists trg_submission_submissions_touch_updated_at on submission.submissions;
create trigger trg_submission_submissions_touch_updated_at
before update on submission.submissions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_submission_judge_workers_touch_updated_at on submission.judge_workers;
create trigger trg_submission_judge_workers_touch_updated_at
before update on submission.judge_workers
for each row execute function public.touch_updated_at();

drop trigger if exists trg_submission_judge_jobs_touch_updated_at on submission.judge_jobs;
create trigger trg_submission_judge_jobs_touch_updated_at
before update on submission.judge_jobs
for each row execute function public.touch_updated_at();

drop trigger if exists trg_submission_run_metrics_touch_updated_at on submission.run_metrics;
create trigger trg_submission_run_metrics_touch_updated_at
before update on submission.run_metrics
for each row execute function public.touch_updated_at();

drop trigger if exists trg_submission_outbox_events_touch_updated_at on submission.outbox_events;
create trigger trg_submission_outbox_events_touch_updated_at
before update on submission.outbox_events
for each row execute function public.touch_updated_at();

commit;
