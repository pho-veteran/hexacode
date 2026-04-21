import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboardProblem, updateProblem } from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Skeleton, ErrorBanner } from "@/components/ui/Feedback";
import { useAuth } from "@/lib/auth";
import {
  ProblemEditor,
  buildEditorInitial,
  type ProblemEditorInitialData,
} from "@/features/problem-editor/ProblemEditor";

export function ProblemEditRoute() {
  const { problemId = "" } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["dashboard-problem", problemId],
    queryFn: () => getDashboardProblem(problemId),
    enabled: !!problemId && auth.status === "authenticated",
  });

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-96" />;
  if (!auth.hasPermission("problem.update_own_draft")) {
    return (
      <AccessDenied
        title="Problem editing unavailable"
        message="This account does not have permission to edit draft problems."
        backTo="/dashboard/problems"
        backLabel="Back to problems"
      />
    );
  }
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError)
    return <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  if (!q.data) return null;

  const p = q.data;
  const initial: ProblemEditorInitialData = buildEditorInitial({
    id: p.id,
    slug: p.slug,
    title: p.title,
    summaryMd: p.summary_md ?? "",
    statementSource: p.statement_source,
    statementMd: p.statement_md ?? "",
    statementObject: p.statement_object ?? null,
    difficultyCode: p.difficulty ?? "easy",
    typeCode: p.type_code ?? "traditional",
    visibilityCode: p.visibility ?? "private",
    scoringCode: p.scoring_code ?? "icpc",
    statusCode: p.status ?? "draft",
    timeLimitMs: p.time_limit_ms != null ? String(p.time_limit_ms) : "1000",
    memoryLimitKb: p.memory_limit_kb != null ? String(p.memory_limit_kb) : "262144",
    outputLimitKb: p.output_limit_kb != null ? String(p.output_limit_kb) : "65536",
    tagSlugs: p.tags.map((t) => t.slug),
    statementAssets: p.statement_assets,
    testsets: p.testsets,
    activeChecker: p.active_checker ?? null,
  });

  return (
    <div className="space-y-5">
      <header>
        <div className="text-eyebrow">Edit problem</div>
        <h1 className="mt-1 text-h1">{p.title}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Update statement, assets, testsets, and checker configuration.
        </p>
      </header>
      <ProblemEditor
        mode="edit"
        initialData={initial}
        accessToken={auth.accessToken}
        loginRedirectPath={`/dashboard/problems/${problemId}/edit`}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSubmit={async (form, _slug, _intent, opts) => {
          if (!auth.accessToken) throw new Error("Sign-in required.");
          const res = await updateProblem(auth.accessToken, problemId, form, opts);
          await qc.invalidateQueries({ queryKey: ["dashboard-problem", problemId] });
          if (res.slug !== p.slug) {
            navigate(`/dashboard/problems/${res.id}/edit`, { replace: true });
          }
        }}
      />
    </div>
  );
}
