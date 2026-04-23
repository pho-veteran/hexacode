import { apiDelete, apiGet, apiMultipart, apiPost, apiPut, buildApiUrl } from "./client";
import type {
  AuthMe,
  ChatRequest,
  ChatResponse,
  DashboardOperations,
  DashboardProblemDetail,
  DashboardProblemSummary,
  DashboardTag,
  DashboardUser,
  ProblemDetail,
  ProblemSolveDetail,
  ProblemLifecycleAction,
  ProblemSubmissionState,
  ProblemSummary,
  ProblemTag,
  RoleCode,
  RuntimeProfile,
  StorageLifecycleCleanup,
  StorageLifecycleInspection,
  SubmissionDetail,
  SubmissionResult,
  SubmissionSource,
  TagLifecycleAction,
  UploadProgress,
  UserLifecycleAction,
} from "./types";

// ---------- Public ----------

export type ProblemFilters = {
  q?: string;
  difficulty?: string;
  visibility?: string;
  status?: string;
  sort?: string;
  tags?: string[];
};

export async function getProblems(filters: ProblemFilters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.difficulty && filters.difficulty !== "all") params.set("difficulty", filters.difficulty);
  if (filters.visibility && filters.visibility !== "all") params.set("visibility", filters.visibility);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.sort && filters.sort !== "newest") params.set("sort", filters.sort);
  filters.tags?.forEach((t) => t && params.append("tag", t));
  const qs = params.size ? `?${params.toString()}` : "";
  return apiGet<ProblemSummary[]>(`/api/problems${qs}`);
}

export const getProblem = (slug: string) => apiGet<ProblemDetail>(`/api/problems/${slug}`);
export const getProblemSolve = (slug: string) => apiGet<ProblemSolveDetail>(`/api/problems/${slug}/solve`);
export const getTags = () => apiGet<ProblemTag[]>(`/api/tags`);
export const getRuntimes = () => apiGet<RuntimeProfile[]>(`/api/runtimes`);
export const getCurrentActor = () => apiGet<AuthMe>(`/api/auth/me`);
export const postChatMessages = (payload: ChatRequest) =>
  apiPost<ChatResponse>(`/api/chat/messages`, payload);

export function getPublicProblemFileUrl(slug: string, objectId: string) {
  return buildApiUrl(`/api/problems/${slug}/files/${objectId}`);
}

// ---------- Submissions ----------

export type SubmissionFilters = {
  problemId?: string;
  q?: string;
  status?: string;
  verdict?: string;
  kind?: string;
  limit?: number;
};

export async function getMySubmissions(filters: SubmissionFilters = {}) {
  const p = new URLSearchParams();
  if (filters.problemId) p.set("problem_id", filters.problemId);
  if (filters.q) p.set("q", filters.q);
  if (filters.status && filters.status !== "all") p.set("status", filters.status);
  if (filters.verdict && filters.verdict !== "all") p.set("verdict", filters.verdict);
  if (filters.kind && filters.kind !== "all") p.set("kind", filters.kind);
  if (filters.limit) p.set("limit", String(filters.limit));
  const qs = p.size ? `?${p.toString()}` : "";
  return apiGet<SubmissionDetail[]>(`/api/submissions${qs}`);
}

export const getSubmission = (id: string) => apiGet<SubmissionDetail>(`/api/submissions/${id}`);
export const getSubmissionSource = (id: string) =>
  apiGet<SubmissionSource>(`/api/submissions/${id}/source`);
export const getSubmissionResults = (id: string) =>
  apiGet<{ submission_id: string; results: SubmissionResult[] }>(`/api/submissions/${id}/results`);

export type CreateSubmissionInput = {
  problem_id: string;
  runtime_profile_key: string;
  source_code: string;
  testset_id?: string | null;
  custom_input?: string | null;
  custom_cases?: Array<{
    id: string;
    input: string;
    expected_output?: string | null;
  }>;
  submission_kind_code: "practice" | "run";
};
export const createSubmission = (payload: CreateSubmissionInput) =>
  apiPost<{
    id: string;
    status: string;
    submission_kind_code: string;
    dispatch_status: string;
    outbox_event_id: string;
    queue?: { queue_url: string; message_id: string };
  }>(`/api/submissions`, payload);

export async function getProblemSubmissionStates(problemIds: string[]) {
  if (!problemIds.length) return [] as ProblemSubmissionState[];
  const p = new URLSearchParams();
  problemIds.forEach((id) => p.append("problem_ids", id));
  return apiGet<ProblemSubmissionState[]>(`/api/submissions/problem-states?${p.toString()}`);
}

export function getSubmissionFileUrl(submissionId: string, objectId: string) {
  return `/api/submissions/${submissionId}/files/${objectId}`;
}

// ---------- Dashboard / problems ----------

export const getDashboardProblems = (scope: "mine" | "review" = "mine") =>
  apiGet<DashboardProblemSummary[]>(`/api/dashboard/problems?scope=${encodeURIComponent(scope)}`);

export const getDashboardProblem = (id: string) =>
  apiGet<DashboardProblemDetail>(`/api/dashboard/problems/${id}`);

export const transitionDashboardProblem = (id: string, action: ProblemLifecycleAction) =>
  apiPost<{ id: string; slug: string; title: string; status: string; visibility: string }>(
    `/api/dashboard/problems/${id}/actions/${action}`,
  );

export const deleteDashboardProblem = (id: string) =>
  apiDelete<{ id: string; slug: string; deleted: boolean }>(`/api/dashboard/problems/${id}`);

export function createProblem(
  accessToken: string,
  form: FormData,
  opts?: { onUploadProgress?: (p: UploadProgress) => void },
) {
  return apiMultipart<{ id: string; slug: string; title: string; status: string }>(
    "POST",
    `/api/problems`,
    form,
    { accessToken, onUploadProgress: opts?.onUploadProgress },
  );
}

export function updateProblem(
  accessToken: string,
  problemId: string,
  form: FormData,
  opts?: { onUploadProgress?: (p: UploadProgress) => void },
) {
  return apiMultipart<{ id: string; slug: string; title: string; status: string }>(
    "PUT",
    `/api/dashboard/problems/${problemId}`,
    form,
    { accessToken, onUploadProgress: opts?.onUploadProgress },
  );
}

export function getDashboardProblemFileUrl(problemId: string, objectId: string) {
  return `/api/dashboard/problems/${problemId}/files/${objectId}`;
}

export const updateDashboardTestcase = (
  problemId: string,
  testsetId: string,
  testcaseId: string,
  payload: { weight: number; is_sample: boolean; note?: string | null },
) =>
  apiPut<{ id: string; weight: number; is_sample: boolean; note?: string | null }>(
    `/api/dashboard/problems/${problemId}/testsets/${testsetId}/testcases/${testcaseId}`,
    payload,
  );

export const deleteDashboardTestcase = (problemId: string, testsetId: string, testcaseId: string) =>
  apiDelete<{ id: string; deleted: boolean }>(
    `/api/dashboard/problems/${problemId}/testsets/${testsetId}/testcases/${testcaseId}`,
  );

export const deleteDashboardTestset = (problemId: string, testsetId: string) =>
  apiDelete<{ id: string; deleted: boolean }>(
    `/api/dashboard/problems/${problemId}/testsets/${testsetId}`,
  );

// ---------- Tags ----------

export const getDashboardTags = () => apiGet<DashboardTag[]>(`/api/dashboard/tags`);
export const createDashboardTag = (payload: Record<string, unknown>) =>
  apiPost<DashboardTag>(`/api/dashboard/tags`, payload);
export const updateDashboardTag = (id: string, payload: Record<string, unknown>) =>
  apiPut<DashboardTag>(`/api/dashboard/tags/${id}`, payload);
export const transitionDashboardTag = (id: string, action: TagLifecycleAction) =>
  apiPost<DashboardTag>(`/api/dashboard/tags/${id}/actions/${action}`);
export const deleteDashboardTag = (id: string) =>
  apiDelete<{ id: string; slug: string; deleted: boolean }>(`/api/dashboard/tags/${id}`);

// ---------- Users ----------
export const getDashboardUsers = () => apiGet<DashboardUser[]>(`/api/dashboard/users`);
export const transitionDashboardUser = (id: string, action: UserLifecycleAction) =>
  apiPost<DashboardUser>(`/api/dashboard/users/${id}/actions/${action}`);
export const grantDashboardUserRole = (id: string, roleCode: RoleCode) =>
  apiPost<DashboardUser>(`/api/dashboard/users/${id}/roles/${roleCode}`);
export const revokeDashboardUserRole = (id: string, roleCode: RoleCode) =>
  apiDelete<DashboardUser>(`/api/dashboard/users/${id}/roles/${roleCode}`);

// ---------- Operations ----------
export const getDashboardOperations = () =>
  apiGet<DashboardOperations>(`/api/dashboard/operations`);

// ---------- Storage ----------
export const inspectDashboardStorageLifecycle = (limit = 100) =>
  apiGet<StorageLifecycleInspection>(
    `/api/dashboard/storage/orphans?limit=${encodeURIComponent(String(limit))}`,
  );
export const cleanupDashboardStorageLifecycle = (payload?: { limit?: number }) =>
  apiPost<StorageLifecycleCleanup>(`/api/dashboard/storage/orphans/cleanup`, payload ?? {});
