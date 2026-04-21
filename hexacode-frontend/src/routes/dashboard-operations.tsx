import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { getDashboardOperations } from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

export function DashboardOperationsRoute() {
  const auth = useAuth();
  const canRead = auth.hasPermission("ops.read_dashboard");
  const q = useQuery({
    queryKey: ["dashboard-operations"],
    queryFn: getDashboardOperations,
    enabled: auth.status === "authenticated" && canRead,
    refetchInterval: 15_000,
  });

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-64" />;
  if (!canRead) {
    return (
      <AccessDenied
        title="Operations dashboard unavailable"
        message="This account does not have moderator operations access."
        backTo="/dashboard"
        backLabel="Back to dashboard"
      />
    );
  }

  const data = q.data;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-eyebrow">Telemetry</div>
          <h1 className="mt-1 text-h1">Operations</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Live view of workers, queued jobs, runs, outbox and recent scoring metrics.
          </p>
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex h-9 items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 text-[13px] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (q.isFetching ? "animate-spin" : "")} />
          Refresh
        </button>
      </header>

      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : !data ? null : (
        <>
          <section className="space-y-2">
            <div className="text-eyebrow">Workers</div>
            {data.workers.length === 0 ? (
              <EmptyState title="No workers registered" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {data.workers.map((w) => (
                  <Card key={w.id}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">{w.name}</div>
                        {w.version ? (
                          <div className="text-[11px] text-[var(--color-text-tertiary)]">v{w.version}</div>
                        ) : null}
                      </div>
                      <Chip tone={w.status_code === "online" ? "ok" : w.status_code === "busy" ? "warn" : "neutral"} dot>
                        {w.status_code}
                      </Chip>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-y-1 text-[12px]">
                      <span className="text-[var(--color-text-secondary)]">Jobs</span>
                      <span className="font-medium">{w.running_jobs} / {w.max_parallel_jobs}</span>
                      <span className="text-[var(--color-text-secondary)]">CPU</span>
                      <span className="font-medium">{w.cpu_usage_percent != null ? `${w.cpu_usage_percent}%` : "—"}</span>
                      <span className="text-[var(--color-text-secondary)]">Memory</span>
                      <span className="font-medium">
                        {w.memory_used_mb != null && w.memory_total_mb != null
                          ? `${w.memory_used_mb}/${w.memory_total_mb} MB`
                          : "—"}
                      </span>
                      <span className="text-[var(--color-text-secondary)]">Last seen</span>
                      <span className="font-medium">{w.last_seen_at ? formatRelative(w.last_seen_at) : "—"}</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <SectionTable
            title="Recent jobs"
            rows={data.jobs}
            columns={[
              { header: "Status", render: (j) => <Chip tone={toneFor(j.status_code)}>{j.status_code}</Chip> },
              { header: "Problem", render: (j) => j.problem_slug ?? "—" },
              { header: "Attempts", render: (j) => `${j.attempts}/${j.max_attempts}` },
              { header: "Worker", render: (j) => j.worker_name ?? "—" },
              { header: "Trigger", render: (j) => j.trigger_type_code },
              { header: "Enqueued", render: (j) => formatRelative(j.enqueue_at) },
              {
                header: "Submission",
                render: (j) => (
                  <Link className="text-[var(--color-info-fg)] hover:underline" to={`/submissions/${j.submission_id}`}>
                    open
                  </Link>
                ),
              },
            ]}
          />

          <SectionTable
            title="Recent runs"
            rows={data.runs}
            columns={[
              { header: "Status", render: (r) => <Chip tone={toneFor(r.status_code)}>{r.status_code}</Chip> },
              { header: "Problem", render: (r) => r.problem_slug ?? "—" },
              { header: "Worker", render: (r) => r.worker_name ?? "—" },
              {
                header: "Compile",
                render: (r) => `${r.compile_exit_code ?? "—"} · ${r.compile_time_ms ?? "—"}ms`,
              },
              {
                header: "Total",
                render: (r) =>
                  `${r.total_time_ms ?? "—"}ms · ${r.total_memory_kb != null ? Math.round(r.total_memory_kb / 1024) + "MB" : "—"}`,
              },
              { header: "Started", render: (r) => formatRelative(r.started_at) },
              {
                header: "Submission",
                render: (r) => (
                  <Link className="text-[var(--color-info-fg)] hover:underline" to={`/submissions/${r.submission_id}`}>
                    open
                  </Link>
                ),
              },
            ]}
          />

          <SectionTable
            title="Outbox"
            rows={data.outbox}
            columns={[
              { header: "Status", render: (e) => <Chip tone={toneFor(e.status_code)}>{e.status_code}</Chip> },
              { header: "Event", render: (e) => e.event_type },
              { header: "Aggregate", render: (e) => `${e.aggregate_type} · ${e.aggregate_id.slice(0, 8)}…` },
              { header: "Retries", render: (e) => e.retry_count },
              { header: "Occurred", render: (e) => formatRelative(e.occurred_at) },
              { header: "Published", render: (e) => (e.published_at ? formatRelative(e.published_at) : "—") },
            ]}
          />

          <SectionTable
            title="Recent metrics"
            rows={data.metrics}
            columns={[
              { header: "Problem", render: (m) => m.problem_slug ?? "—" },
              { header: "Passed", render: (m) => `${m.passed_testcases}/${m.total_testcases}` },
              {
                header: "Resources",
                render: (m) => `${m.runtime_ms}ms · ${Math.round(m.memory_kb / 1024)}MB`,
              },
              { header: "Score", render: (m) => (m.final_score != null ? String(m.final_score) : "—") },
              { header: "When", render: (m) => formatRelative(m.created_at) },
              {
                header: "Submission",
                render: (m) => (
                  <Link className="text-[var(--color-info-fg)] hover:underline" to={`/submissions/${m.submission_id}`}>
                    open
                  </Link>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

function toneFor(code: string): "ok" | "warn" | "err" | "info" | "neutral" {
  const c = code.toLowerCase();
  if (["done", "published", "succeeded", "ok", "online"].includes(c)) return "ok";
  if (["running", "pending", "queued", "busy"].includes(c)) return "info";
  if (["failed", "errored", "error", "offline"].includes(c)) return "err";
  if (["retry", "retrying"].includes(c)) return "warn";
  return "neutral";
}

function SectionTable<Row>({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Row[];
  columns: { header: string; render: (r: Row) => React.ReactNode }[];
}) {
  return (
    <section className="space-y-2">
      <div className="text-eyebrow">{title}</div>
      {rows.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()}`} />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <THead>
              <TR>
                {columns.map((c) => (
                  <TH key={c.header}>{c.header}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={i}>
                  {columns.map((c) => (
                    <TD key={c.header}>{c.render(r)}</TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
