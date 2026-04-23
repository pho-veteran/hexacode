export type RoleCode = "contestant" | "author" | "reviewer" | "moderator" | "admin";

export type PermissionCode =
  | "problem.read_public"
  | "submission.create"
  | "submission.read_own"
  | "submission.read_public_summary"
  | "submission.read_public_detail"
  | "problem.create"
  | "problem.read_own_dashboard"
  | "problem.update_own_draft"
  | "problem.delete_own_draft"
  | "problem.request_review_own"
  | "problem.archive_own"
  | "testset.manage_own"
  | "tag.read_dashboard"
  | "problem.read_review_queue"
  | "problem.review"
  | "problem.publish"
  | "problem.unpublish"
  | "problem.archive_any"
  | "tag.create"
  | "tag.update"
  | "tag.lifecycle"
  | "tag.delete"
  | "user.read_directory"
  | "user.disable"
  | "user.enable"
  | "role.grant"
  | "role.revoke"
  | "ops.read_dashboard"
  | "ops.manage_storage_orphans"
  | "ops.read_worker_state"
  | "ops.read_queue_state"
  | "admin.full";

export type AuthMe = {
  id: string;
  cognito_sub: string;
  username?: string | null;
  email?: string | null;
  groups: string[];
  token_use?: string | null;
  roles: RoleCode[];
  permissions: PermissionCode[];
  status_code: "active" | "disabled";
  is_admin: boolean;
  is_disabled: boolean;
};

export type ProblemTag = {
  id?: string;
  slug: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
};

export type ProblemSummary = {
  id: string;
  slug: string;
  title: string;
  summary_md?: string | null;
  difficulty: string | null;
  visibility: string;
  status: string;
  created_at: string;
  submissions_count?: number;
  accepted_count?: number;
  unique_solvers_count?: number;
  tags?: ProblemTag[];
};

export type DashboardTag = ProblemTag & {
  id: string;
  is_active: boolean;
  problem_count: number;
  created_at: string;
  updated_at: string;
};

export type StorageObject = {
  id: string;
  bucket: string;
  object_key: string;
  content_type?: string | null;
  original_filename?: string | null;
  size_bytes: number;
  sha256?: string | null;
  etag?: string | null;
};

export type ProblemAsset = {
  id: string;
  asset_role_code: string;
  logical_name?: string | null;
  sort_order: number;
  object: StorageObject;
};

export type ProblemTestset = {
  id: string;
  testset_type_code: string;
  title?: string | null;
  note?: string | null;
  extracted_case_count: number;
  archive_object?: StorageObject | null;
};

export type ProblemTestcase = {
  id: string;
  ordinal: number;
  weight: number;
  is_sample: boolean;
  note?: string | null;
  input_text?: string | null;
  expected_output_text?: string | null;
  input_object?: StorageObject | null;
  expected_output_object?: StorageObject | null;
};

export type ManagedProblemTestset = ProblemTestset & {
  testcases: ProblemTestcase[];
};

export type ProblemChecker = {
  id: string;
  checker_type_code: string;
  runtime_profile_key?: string | null;
  entrypoint?: string | null;
  note?: string | null;
  source_object?: StorageObject | null;
  compiled_object?: StorageObject | null;
};

export type ProblemDetail = {
  id: string;
  slug: string;
  title: string;
  summary_md?: string | null;
  statement_source: string;
  statement_md?: string | null;
  statement_object?: StorageObject | null;
  difficulty?: string | null;
  type_code?: string | null;
  visibility?: string | null;
  scoring_code?: string | null;
  status?: string | null;
  time_limit_ms?: number | null;
  memory_limit_kb?: number | null;
  output_limit_kb?: number | null;
  tags: ProblemTag[];
  statement_assets: ProblemAsset[];
  testsets: ProblemTestset[];
  active_checker?: ProblemChecker | null;
};

export type ProblemSolveSampleTestcase = {
  id: string;
  ordinal: number;
  note?: string | null;
  input_text?: string | null;
  expected_output_text?: string | null;
};

export type ProblemSolveDetail = ProblemDetail & {
  run_testset?: ProblemTestset | null;
  sample_testcases: ProblemSolveSampleTestcase[];
};

export type DashboardProblemSummary = ProblemSummary & {
  updated_at: string;
  active_testset_count: number;
  active_checker_type_code?: string | null;
  authored_by_me?: boolean;
};

export type DashboardProblemDetail = Omit<ProblemDetail, "testsets"> & {
  created_at: string;
  updated_at: string;
  authored_by_me: boolean;
  testsets: ManagedProblemTestset[];
};

export type RuntimeProfile = {
  id: string;
  profile_key: string;
  runtime_name: string;
  runtime_version?: string | null;
  source_file_name: string;
  compile_command: string;
  run_command: string;
};

export type SubmissionDetail = {
  id: string;
  problem_id: string;
  problem_slug?: string | null;
  problem_title?: string | null;
  status: string;
  verdict: string | null;
  final_score?: number | null;
  time_ms?: number | null;
  memory_kb?: number | null;
  created_at: string;
  judged_at?: string | null;
  submission_kind_code?: string | null;
  source_filename?: string | null;
  custom_input?: string | null;
  custom_cases?: Array<{
    id: string;
    input: string;
    expected_output?: string | null;
  }> | null;
  note?: string | null;
  runtime_profile_key: string;
  runtime_name: string;
};

export type SubmissionSource = {
  id: string;
  problem_slug?: string | null;
  source_code?: string | null;
  source_filename?: string | null;
};

export type SubmissionResult = {
  id: string;
  testcase_id?: string | null;
  testcase_ordinal?: number | null;
  result_type_code: string;
  status_code: string;
  runtime_ms?: number | null;
  memory_kb?: number | null;
  input_preview?: string | null;
  expected_output_preview?: string | null;
  actual_output_preview?: string | null;
  stdout_object_id?: string | null;
  stderr_object_id?: string | null;
  checker_message?: string | null;
  exit_code?: number | null;
  signal?: number | null;
  message?: string | null;
  note?: string | null;
  created_at: string;
};

export type ProblemSubmissionState = {
  problem_id: string;
  submission_count: number;
  solved: boolean;
  attempted: boolean;
  last_submission_at?: string | null;
  solved_at?: string | null;
};

export type DashboardUser = {
  id: string;
  cognito_sub: string;
  username?: string | null;
  status_code: "active" | "disabled";
  roles: RoleCode[];
  created_at: string;
  updated_at: string;
  problem_count: number;
  submission_count: number;
};

export type DashboardOperationWorker = {
  id: string;
  name: string;
  version?: string | null;
  status_code: string;
  max_parallel_jobs: number;
  running_jobs: number;
  cpu_usage_percent?: number | null;
  memory_used_mb?: number | null;
  memory_total_mb?: number | null;
  last_seen_at?: string | null;
  registered_at: string;
};

export type DashboardOperationJob = {
  id: string;
  status_code: string;
  attempts: number;
  max_attempts: number;
  trigger_type_code: string;
  trigger_reason?: string | null;
  last_error?: string | null;
  enqueue_at: string;
  finished_at?: string | null;
  submission_id: string;
  problem_slug?: string | null;
  worker_name?: string | null;
};

export type DashboardOperationRun = {
  id: string;
  status_code: string;
  started_at: string;
  finished_at?: string | null;
  compile_exit_code?: number | null;
  compile_time_ms?: number | null;
  total_time_ms?: number | null;
  total_memory_kb?: number | null;
  submission_id: string;
  problem_slug?: string | null;
  worker_name?: string | null;
};

export type DashboardOperationOutboxEvent = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  status_code: string;
  retry_count: number;
  next_retry_at?: string | null;
  last_error?: string | null;
  occurred_at: string;
  published_at?: string | null;
};

export type DashboardOperationMetric = {
  submission_id: string;
  problem_slug?: string | null;
  runtime_ms: number;
  memory_kb: number;
  passed_testcases: number;
  total_testcases: number;
  final_score?: number | null;
  created_at: string;
};

export type DashboardOperations = {
  workers: DashboardOperationWorker[];
  jobs: DashboardOperationJob[];
  runs: DashboardOperationRun[];
  outbox: DashboardOperationOutboxEvent[];
  metrics: DashboardOperationMetric[];
};

export type StorageLifecycleObject = {
  id: string;
  bucket: string;
  object_key: string;
  content_type?: string | null;
  original_filename?: string | null;
  size_bytes: number;
  created_at: string;
  role?: string | null;
  problem_id?: string | null;
  testset_id?: string | null;
  checker_type_code?: string | null;
};

export type StorageLifecycleInspection = {
  total_count: number;
  objects: StorageLifecycleObject[];
  limit: number;
};

export type StorageLifecycleCleanup = {
  scanned_count: number;
  deleted_count: number;
  deleted_objects: Array<{ id: string; bucket: string; object_key: string }>;
  remaining_estimate: number;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatArea = "public" | "dashboard" | "workspace";

export type ChatPageContext = {
  route: string;
  area: ChatArea;
  problemSlug?: string | null;
};

export type ChatRequest = {
  sessionId: string;
  messages: ChatMessage[];
  pageContext?: ChatPageContext;
};

export type ChatResponse = {
  reply: ChatMessage;
  requestId: string;
};

export type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> };

export type UploadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type ProblemLifecycleAction =
  | "request-review"
  | "approve"
  | "reject"
  | "publish"
  | "unpublish"
  | "archive";
export type TagLifecycleAction = "activate" | "deactivate";
export type UserLifecycleAction = "enable" | "disable";
