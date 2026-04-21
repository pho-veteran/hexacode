import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, FileStack, Eye, Trash2, ShieldCheck, ShieldX, Send, Archive, Upload, PackageX, BadgeCheck } from "lucide-react";
import {
  deleteDashboardProblem,
  getDashboardProblems,
  transitionDashboardProblem,
  type DashboardProblemSummary,
  type ProblemLifecycleAction,
} from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip, DifficultyChip, StatusChip, VisibilityChip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { toast } from "sonner";

function availableActions(
  p: DashboardProblemSummary,
  permissions: {
    canRequestReview: boolean;
    canReview: boolean;
    canPublish: boolean;
    canUnpublish: boolean;
    canArchiveOwn: boolean;
    canArchiveAny: boolean;
  },
): ProblemLifecycleAction[] {
  const out: ProblemLifecycleAction[] = [];
  const authored = !!p.authored_by_me;
  if (authored && permissions.canRequestReview && (p.status === "draft" || p.status === "rejected")) {
    out.push("request-review");
  }
  if (permissions.canReview && p.status === "pending_review") out.push("approve", "reject");
  if (permissions.canPublish && p.status === "approved") out.push("publish");
  if (permissions.canUnpublish && p.status === "published") out.push("unpublish");
  if (p.status !== "archived" && ((authored && permissions.canArchiveOwn) || permissions.canArchiveAny)) {
    out.push("archive");
  }
  return out;
}

const ACTION_LABEL: Record<ProblemLifecycleAction, string> = {
  "request-review": "Request review",
  approve: "Approve",
  reject: "Reject",
  publish: "Publish",
  unpublish: "Unpublish",
  archive: "Archive",
};

export function DashboardProblemsRoute() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const scope = (params.get("scope") ?? "mine") as "mine" | "review";
  const canViewMine = auth.hasPermission("problem.read_own_dashboard");
  const canViewReview = auth.hasPermission("problem.read_review_queue");
  const canCreate = auth.hasPermission("problem.create");
  const canDeleteOwn = auth.hasPermission("problem.delete_own_draft");
  const policy = {
    canRequestReview: auth.hasPermission("problem.request_review_own"),
    canReview: auth.hasPermission("problem.review"),
    canPublish: auth.hasPermission("problem.publish"),
    canUnpublish: auth.hasPermission("problem.unpublish"),
    canArchiveOwn: auth.hasPermission("problem.archive_own"),
    canArchiveAny: auth.hasPermission("problem.archive_any"),
  };
  const supportedScopes = (["mine", "review"] as const).filter((value) =>
    value === "mine" ? canViewMine : canViewReview,
  );
  const effScope =
    scope === "review" && canViewReview ? "review" : canViewMine ? "mine" : supportedScopes[0] ?? "mine";

  const q = useQuery({
    queryKey: ["dashboard-problems", effScope],
    queryFn: () => getDashboardProblems(effScope),
    enabled: auth.status === "authenticated" && !auth.authzLoading && (canViewMine || canViewReview),
  });

  const [busy, setBusy] = useState<string | null>(null);

  const mutAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ProblemLifecycleAction }) =>
      transitionDashboardProblem(id, action),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["dashboard-problems"] });
      toast.success("Problem updated");
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusy(null),
  });

  const mutDelete = useMutation({
    mutationFn: (id: string) => deleteDashboardProblem(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["dashboard-problems"] });
      toast.success("Deleted");
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusy(null),
  });

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-64" />;
  if (!canViewMine && !canViewReview) {
    return (
      <AccessDenied
        title="Problem dashboard unavailable"
        message="This account does not have authoring or review permissions."
        backTo="/dashboard"
        backLabel="Back to dashboard"
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-eyebrow">Catalog</div>
          <h1 className="mt-1 text-h1">Problems</h1>
        </div>
        <div className="flex items-center gap-2">
          {canCreate ? (
            <Link
              to="/dashboard/problems/new"
              className="inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
            >
              New problem
            </Link>
          ) : null}
        </div>
      </header>

      <div className="flex items-center gap-1 rounded-full hairline p-1 bg-[var(--color-bg-elevated)] w-max">
        {supportedScopes.map((s) => {
          const active = effScope === s;
          return (
            <button
              key={s}
              onClick={() => {
                const next = new URLSearchParams(params);
                if (s === "mine") next.delete("scope");
                else next.set("scope", s);
                setParams(next, { replace: true });
              }}
              className={
                "rounded-full px-3 py-1 text-[13px] font-medium transition-colors " +
                (active
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
              }
            >
              {s === "mine" ? "Mine" : "Review"}
            </button>
          );
        })}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          title={effScope === "review" ? "Nothing awaiting review" : "No problems yet"}
          description={effScope === "review" ? undefined : "Create a new problem to get started."}
          action={
            effScope !== "review" && canCreate ? (
              <Link
                to="/dashboard/problems/new"
                className="inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)]"
              >
                New problem
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {q.data!.map((p) => {
            const actions = availableActions(p, policy);
            const isBusy = busy === p.id;
            const deletable = p.authored_by_me && canDeleteOwn;
            const canEdit = p.authored_by_me && auth.hasPermission("problem.update_own_draft");
            const canManageTestsets = p.authored_by_me && auth.hasPermission("testset.manage_own");
            return (
              <Card key={p.id}>
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={canEdit ? `/dashboard/problems/${p.id}/edit` : `/problems/${p.slug}`}
                        className="font-semibold hover:underline"
                      >
                        {p.title}
                      </Link>
                      <DifficultyChip value={p.difficulty} />
                      <VisibilityChip value={p.visibility} />
                      <StatusChip value={p.status} />
                      {p.authored_by_me ? <Chip tone="accent">mine</Chip> : <Chip tone="info">review</Chip>}
                      <Chip tone="neutral">{p.active_testset_count} tests</Chip>
                      {p.active_checker_type_code ? (
                        <Chip tone="neutral">checker: {p.active_checker_type_code}</Chip>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                      Updated {formatRelative(p.updated_at)} · {p.slug}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {p.visibility === "public" && p.status === "published" ? (
                      <LinkButton to={`/problems/${p.slug}`} icon={Eye}>
                        Public
                      </LinkButton>
                    ) : null}
                    {canEdit ? (
                      <>
                        <LinkButton to={`/dashboard/problems/${p.id}/edit`} icon={Edit2}>
                          Edit
                        </LinkButton>
                      </>
                    ) : null}
                    {canManageTestsets ? (
                      <>
                        <LinkButton to={`/dashboard/problems/${p.id}/testsets`} icon={FileStack}>
                          Testsets
                        </LinkButton>
                      </>
                    ) : null}
                    {actions.map((a) => (
                      <button
                        key={a}
                        disabled={isBusy || mutAction.isPending}
                        onClick={() => {
                          if (!window.confirm(`${ACTION_LABEL[a]}: "${p.title}"?`)) return;
                          setBusy(p.id);
                          mutAction.mutate({ id: p.id, action: a });
                        }}
                        className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-2.5 py-1 text-[12px] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
                      >
                        <LifecycleIcon action={a} />
                        {ACTION_LABEL[a]}
                      </button>
                    ))}
                    {deletable ? (
                      <button
                        disabled={isBusy || mutDelete.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete "${p.title}"? This only works when no submissions exist.`,
                            )
                          )
                            return;
                          setBusy(p.id);
                          mutDelete.mutate(p.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-err-bg)] px-2.5 py-1 text-[12px] text-[var(--color-err-fg)] hover:brightness-95 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LinkButton({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-2.5 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
    >
      <Icon className="h-3 w-3" />
      {children}
    </Link>
  );
}

function LifecycleIcon({ action }: { action: ProblemLifecycleAction }) {
  const cls = "h-3 w-3";
  switch (action) {
    case "request-review":
      return <Send className={cls} />;
    case "approve":
      return <ShieldCheck className={cls} />;
    case "reject":
      return <ShieldX className={cls} />;
    case "publish":
      return <Upload className={cls} />;
    case "unpublish":
      return <PackageX className={cls} />;
    case "archive":
      return <Archive className={cls} />;
    default:
      return <BadgeCheck className={cls} />;
  }
}
