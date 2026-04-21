import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Files, Tags, Users, Wrench, HardDrive, PlusCircle } from "lucide-react";
import type { PermissionCode } from "@/lib/api";
import { getDashboardProblems } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Skeleton, ErrorBanner } from "@/components/ui/Feedback";
import { StatusChip, DifficultyChip } from "@/components/ui/Chip";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

const CTAS = [
  { to: "/dashboard/problems/new", label: "New problem", icon: PlusCircle, permissions: ["problem.create"] as PermissionCode[] },
  { to: "/dashboard/problems", label: "Problems", icon: Files, permissions: ["problem.read_own_dashboard", "problem.read_review_queue"] as PermissionCode[] },
  { to: "/dashboard/tags", label: "Tags", icon: Tags, permissions: ["tag.read_dashboard"] as PermissionCode[] },
  { to: "/dashboard/users", label: "Users", icon: Users, permissions: ["user.read_directory"] as PermissionCode[] },
  { to: "/dashboard/storage", label: "Storage", icon: HardDrive, permissions: ["ops.manage_storage_orphans"] as PermissionCode[] },
  { to: "/dashboard/operations", label: "Operations", icon: Wrench, permissions: ["ops.read_dashboard"] as PermissionCode[] },
];

export function DashboardHomeRoute() {
  const auth = useAuth();
  const canViewOwnProblems = auth.hasPermission("problem.read_own_dashboard");
  const canCreateProblem = auth.hasPermission("problem.create");
  const ctas = CTAS.filter((cta) => auth.hasAnyPermission(cta.permissions));
  const q = useQuery({
    queryKey: ["dashboard-problems", "mine"],
    queryFn: () => getDashboardProblems("mine"),
    enabled: auth.status === "authenticated" && canViewOwnProblems,
  });

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-64" />;
  if (!auth.canAccessDashboard) {
    return (
      <AccessDenied
        title="Dashboard access unavailable"
        message="This account does not have dashboard permissions."
        backTo="/problems"
        backLabel="Browse problems"
      />
    );
  }

  const problems = q.data ?? [];
  const draftCount = problems.filter((p) => p.status === "draft").length;
  const publishedCount = problems.filter((p) => p.status === "published").length;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-eyebrow">Dashboard</div>
        <h1 className="mt-1 text-h1">Welcome back</h1>
        <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">
          Author problems, manage tags, and keep the judge healthy.
        </p>
      </header>

      {canViewOwnProblems ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Authored" value={problems.length} loading={q.isLoading} />
          <Stat label="Drafts" value={draftCount} loading={q.isLoading} />
          <Stat label="Published" value={publishedCount} loading={q.isLoading} />
        </div>
      ) : (
        <Card>
          <div className="text-eyebrow">Access</div>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            This dashboard is scoped to your assigned staff capabilities. Problem authoring panels are hidden for this account.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {ctas.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.to}
              to={c.to}
              className="group flex items-center gap-2 rounded-[var(--radius-md)] hairline bg-[var(--color-bg-elevated)] px-3 py-3 text-[13px] font-medium hover:bg-[var(--color-bg-muted)]"
            >
              <Icon className="h-4 w-4 text-[var(--color-accent)]" />
              <span>{c.label}</span>
              <ArrowRight className="ml-auto h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          );
        })}
      </div>

      {canViewOwnProblems ? (
        <section>
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-eyebrow">Recent</div>
              <h2 className="text-h3">Your problems</h2>
            </div>
            <Link
              to="/dashboard/problems"
              className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] inline-flex items-center gap-1"
            >
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {q.isLoading ? (
            <Skeleton className="h-40" />
          ) : q.isError ? (
            <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
          ) : problems.length === 0 ? (
            <Card className="text-center text-[13px] text-[var(--color-text-secondary)] py-8">
              No problems yet.{" "}
              {canCreateProblem ? (
                <>
                  <Link to="/dashboard/problems/new" className="text-[var(--color-info-fg)] underline">
                    Create your first
                  </Link>
                  .
                </>
              ) : (
                "Waiting for author permissions."
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {problems.slice(0, 5).map((p) => (
                <Card key={p.id} className="py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Link
                      to={auth.hasPermission("problem.update_own_draft") ? `/dashboard/problems/${p.id}/edit` : `/problems/${p.slug}`}
                      className="font-medium hover:underline"
                    >
                      {p.title}
                    </Link>
                    <DifficultyChip value={p.difficulty} />
                    <StatusChip value={p.status} />
                    <span className="text-[11px] text-[var(--color-text-tertiary)] ml-auto">
                      {formatRelative(p.updated_at)}
                    </span>
                    {auth.hasPermission("testset.manage_own") ? (
                      <Link
                        to={`/dashboard/problems/${p.id}/testsets`}
                        className="text-[12px] text-[var(--color-info-fg)] hover:underline"
                      >
                        Testsets
                      </Link>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, loading }: { label: string; value: number; loading?: boolean }) {
  return (
    <Card>
      <div className="text-eyebrow">{label}</div>
      <div className="mt-1 text-[28px] font-semibold tabular-nums">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </div>
    </Card>
  );
}
