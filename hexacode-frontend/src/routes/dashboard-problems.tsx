import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Edit2,
  FileStack,
  Eye,
  Trash2,
  ShieldCheck,
  ShieldX,
  Send,
  Archive,
  Upload,
  PackageX,
  BadgeCheck,
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  deleteDashboardProblem,
  getDashboardProblems,
  transitionDashboardProblem,
  type DashboardProblemSummary,
  type ProblemLifecycleAction,
  type DashboardProblemsParams,
} from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip, DifficultyChip, StatusChip, VisibilityChip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { toast } from "sonner";

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "pending_review", label: "Pending Review" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title A-Z" },
] as const;

function primaryAction(
  p: DashboardProblemSummary,
  permissions: ReturnType<typeof usePolicy>,
): ProblemLifecycleAction | null {
  const authored = !!p.authored_by_me;
  if (authored && permissions.canRequestReview && (p.status === "draft" || p.status === "rejected"))
    return "request-review";
  if (permissions.canReview && p.status === "pending_review") return "approve";
  if (permissions.canPublish && p.status === "approved") return "publish";
  return null;
}

function secondaryActions(
  p: DashboardProblemSummary,
  permissions: ReturnType<typeof usePolicy>,
): ProblemLifecycleAction[] {
  const out: ProblemLifecycleAction[] = [];
  const authored = !!p.authored_by_me;
  if (authored && permissions.canRequestReview && (p.status === "draft" || p.status === "rejected"))
    out.push("request-review");
  if (permissions.canReview && p.status === "pending_review") {
    out.push("approve", "reject");
  }
  if (permissions.canPublish && p.status === "approved") out.push("publish");
  if (permissions.canUnpublish && p.status === "published") out.push("unpublish");
  if (p.status !== "archived" && ((authored && permissions.canArchiveOwn) || permissions.canArchiveAny))
    out.push("archive");
  // Remove the primary action from secondary list
  const primary = primaryAction(p, permissions);
  return out.filter((a) => a !== primary);
}

const ACTION_LABEL: Record<ProblemLifecycleAction, string> = {
  "request-review": "Request review",
  approve: "Approve",
  reject: "Reject",
  publish: "Publish",
  unpublish: "Unpublish",
  archive: "Archive",
};

function usePolicy() {
  const auth = useAuth();
  return {
    canRequestReview: auth.hasPermission("problem.request_review_own"),
    canReview: auth.hasPermission("problem.review"),
    canPublish: auth.hasPermission("problem.publish"),
    canUnpublish: auth.hasPermission("problem.unpublish"),
    canArchiveOwn: auth.hasPermission("problem.archive_own"),
    canArchiveAny: auth.hasPermission("problem.archive_any"),
  };
}

type ConfirmState = {
  type: "action" | "delete";
  problem: DashboardProblemSummary;
  action?: ProblemLifecycleAction;
};

export function DashboardProblemsRoute() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const policy = usePolicy();

  const scope = (params.get("scope") ?? "mine") as "mine" | "review" | "all";
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "newest";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));

  const canViewMine = auth.hasPermission("problem.read_own_dashboard");
  const canViewReview = auth.hasPermission("problem.read_review_queue");
  const canViewAll = auth.hasPermission("admin.full");
  const canCreate = auth.hasPermission("problem.create");
  const canDeleteOwn = auth.hasPermission("problem.delete_own_draft");

  const supportedScopes = (["mine", "review", "all"] as const).filter((s) =>
    s === "mine" ? canViewMine : s === "review" ? canViewReview : canViewAll,
  );
  const effScope = supportedScopes.includes(scope as "mine" | "review" | "all")
    ? scope
    : supportedScopes[0] ?? "mine";

  const queryParams: DashboardProblemsParams = {
    scope: effScope,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    ...(search && { search }),
    ...(status && { status }),
    ...(sort !== "newest" && { sort }),
  };

  const q = useQuery({
    queryKey: ["dashboard-problems", queryParams],
    queryFn: () => getDashboardProblems(queryParams),
    enabled: auth.status === "authenticated" && !auth.authzLoading && supportedScopes.length > 0,
  });

  const total = q.data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const mutAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ProblemLifecycleAction }) =>
      transitionDashboardProblem(id, action),
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: ["dashboard-problems"] });
      const p = confirmState?.problem;
      toast.success(`Problem "${p?.title ?? ""}" ${ACTION_LABEL[vars.action].toLowerCase()}d`);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setConfirmState(null),
  });

  const mutDelete = useMutation({
    mutationFn: (id: string) => deleteDashboardProblem(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["dashboard-problems"] });
      toast.success(`Problem "${confirmState?.problem.title}" deleted`);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setConfirmState(null),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || (key === "scope" && value === "mine") || (key === "sort" && value === "newest") || (key === "page" && value === "1")) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  }

  function handleConfirm() {
    if (!confirmState) return;
    if (confirmState.type === "delete") {
      mutDelete.mutate(confirmState.problem.id);
    } else if (confirmState.action) {
      mutAction.mutate({ id: confirmState.problem.id, action: confirmState.action });
    }
  }

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-64" />;
  if (!canViewMine && !canViewReview && !canViewAll) {
    return (
      <AccessDenied
        title="Problem dashboard unavailable"
        message="This account does not have authoring or review permissions."
        backTo="/dashboard"
        backLabel="Back to dashboard"
      />
    );
  }

  const problems = q.data?.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-eyebrow">Catalog</div>
          <h1 className="mt-1 text-h1">Problems</h1>
        </div>
        {canCreate && (
          <Link
            to="/dashboard/problems/new"
            className="inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
          >
            New problem
          </Link>
        )}
      </header>

      {/* Scope tabs */}
      <div className="flex items-center gap-1 rounded-full hairline p-1 bg-[var(--color-bg-elevated)] w-max">
        {supportedScopes.map((s) => (
          <button
            key={s}
            onClick={() => setParam("scope", s)}
            className={
              "rounded-full px-3 py-1 text-[13px] font-medium transition-colors " +
              (effScope === s
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
            }
          >
            {s === "mine" ? "Mine" : s === "review" ? "Review" : "All"}
          </button>
        ))}
      </div>

      {/* Search + Status filter + Sort */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(v) => setParam("search", v)}
          placeholder="Search problems…"
          className="w-64"
        />
        <div className="flex items-center gap-1 rounded-full hairline p-0.5 bg-[var(--color-bg-elevated)]">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setParam("status", t.value)}
              className={
                "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors " +
                (status === t.value
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setParam("sort", e.target.value)}
          className="rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] focus-visible:outline-[var(--color-accent)]"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Problem list */}
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : problems.length === 0 ? (
        <EmptyState
          title={search ? "No problems match your search" : effScope === "review" ? "Nothing awaiting review" : "No problems yet"}
          description={!search && effScope !== "review" ? "Create a new problem to get started." : undefined}
          action={
            !search && effScope !== "review" && canCreate ? (
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
        <>
          <div className="space-y-2">
            {problems.map((p) => (
              <ProblemCard
                key={p.id}
                problem={p}
                policy={policy}
                canDeleteOwn={canDeleteOwn}
                auth={auth}
                onAction={(action) => setConfirmState({ type: "action", problem: p, action })}
                onDelete={() => setConfirmState({ type: "delete", problem: p })}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                disabled={page <= 1}
                onClick={() => setParam("page", String(page - 1))}
                className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[12px] hover:bg-[var(--color-bg-muted)] disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> Previous
              </button>
              <span className="text-[12px] text-[var(--color-text-secondary)]">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setParam("page", String(page + 1))}
                className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[12px] hover:bg-[var(--color-bg-muted)] disabled:opacity-40"
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmState}
        onOpenChange={(v) => { if (!v) setConfirmState(null); }}
        title={
          confirmState?.type === "delete"
            ? `Delete "${confirmState.problem.title}"?`
            : `${ACTION_LABEL[confirmState?.action ?? "approve"]} "${confirmState?.problem.title ?? ""}"?`
        }
        description={
          confirmState?.type === "delete"
            ? "This only works when no submissions exist. This action cannot be undone."
            : undefined
        }
        confirmLabel={confirmState?.type === "delete" ? "Delete" : ACTION_LABEL[confirmState?.action ?? "approve"]}
        variant={confirmState?.type === "delete" ? "danger" : "default"}
        onConfirm={handleConfirm}
        loading={mutAction.isPending || mutDelete.isPending}
      />
    </div>
  );
}

function ProblemCard({
  problem: p,
  policy,
  canDeleteOwn,
  auth,
  onAction,
  onDelete,
}: {
  problem: DashboardProblemSummary;
  policy: ReturnType<typeof usePolicy>;
  canDeleteOwn: boolean;
  auth: ReturnType<typeof useAuth>;
  onAction: (action: ProblemLifecycleAction) => void;
  onDelete: () => void;
}) {
  const primary = primaryAction(p, policy);
  const secondary = secondaryActions(p, policy);
  const deletable = p.authored_by_me && canDeleteOwn;
  const canEdit = p.authored_by_me && auth.hasPermission("problem.update_own_draft");
  const canManageTestsets = p.authored_by_me && auth.hasPermission("testset.manage_own");
  const hasOverflow = secondary.length > 0 || deletable;

  return (
    <Card>
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
          </div>
          <div className="mt-1 flex items-center gap-3 text-[12px] text-[var(--color-text-tertiary)]">
            <span>Updated {formatRelative(p.updated_at)} · {p.slug}</span>
            {/* Completeness indicators */}
            <span className="inline-flex items-center gap-0.5" title={p.active_testset_count > 0 ? "Has testset" : "No testset"}>
              {p.active_testset_count > 0
                ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                : <XCircle className="h-3 w-3 text-[var(--color-text-tertiary)]" />}
              testset
            </span>
            <span className="inline-flex items-center gap-0.5" title={p.active_checker_type_code ? "Has checker" : "No checker"}>
              {p.active_checker_type_code
                ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                : <XCircle className="h-3 w-3 text-[var(--color-text-tertiary)]" />}
              checker
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {p.visibility === "public" && p.status === "published" && (
            <LinkButton to={`/problems/${p.slug}`} icon={Eye}>Public</LinkButton>
          )}
          {canEdit && (
            <LinkButton to={`/dashboard/problems/${p.id}/edit`} icon={Edit2}>Edit</LinkButton>
          )}
          {canManageTestsets && (
            <LinkButton to={`/dashboard/problems/${p.id}/testsets`} icon={FileStack}>Testsets</LinkButton>
          )}
          {primary && (
            <button
              onClick={() => onAction(primary)}
              className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-2.5 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
            >
              <LifecycleIcon action={primary} />
              {ACTION_LABEL[primary]}
            </button>
          )}
          {hasOverflow && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center justify-center rounded-full hairline bg-[var(--color-bg-elevated)] p-1.5 hover:bg-[var(--color-bg-muted)]">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {secondary.map((a) => (
                  <DropdownMenuItem key={a} onSelect={() => onAction(a)} icon={LifecycleIconComponent(a)}>
                    {ACTION_LABEL[a]}
                  </DropdownMenuItem>
                ))}
                {secondary.length > 0 && deletable && <DropdownMenuSeparator />}
                {deletable && (
                  <DropdownMenuItem onSelect={onDelete} destructive icon={Trash2}>
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </Card>
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

function LifecycleIconComponent(action: ProblemLifecycleAction): React.ComponentType<{ className?: string }> {
  switch (action) {
    case "request-review": return Send;
    case "approve": return ShieldCheck;
    case "reject": return ShieldX;
    case "publish": return Upload;
    case "unpublish": return PackageX;
    case "archive": return Archive;
    default: return BadgeCheck;
  }
}

function LifecycleIcon({ action }: { action: ProblemLifecycleAction }) {
  const Icon = LifecycleIconComponent(action);
  return <Icon className="h-3 w-3" />;
}
