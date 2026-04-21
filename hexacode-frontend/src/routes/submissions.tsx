import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMySubmissions } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { AuthRequired } from "@/components/shell";
import { Input, Select } from "@/components/ui/Input";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { VerdictChip, Chip } from "@/components/ui/Chip";
import { useAuth } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/utils";

const STATUSES = ["all", "queued", "running", "done", "failed", "cancelled"];
const VERDICTS = ["all", "ac", "wa", "tle", "re", "ce", "ie"];
const KINDS = ["all", "run", "practice"];

export function SubmissionsRoute() {
  const [params, setParams] = useSearchParams();
  const auth = useAuth();

  const q = (params.get("q") ?? "").trim();
  const status = params.get("status") ?? "all";
  const verdict = params.get("verdict") ?? "all";
  const kind = params.get("kind") ?? "all";

  const query = useQuery({
    queryKey: ["my-submissions", { q, status, verdict, kind }],
    queryFn: () => getMySubmissions({ q, status, verdict, kind, limit: 100 }),
    enabled: auth.status === "authenticated",
  });

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === "all") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  if (auth.status !== "authenticated") return <AuthRequired />;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-eyebrow">History</div>
        <h1 className="mt-1 text-h1">My submissions</h1>
      </header>
      <Card>
        <form
          className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const el = e.currentTarget.querySelector<HTMLInputElement>("[name=q]");
            update({ q: el?.value.trim() ?? "" });
          }}
        >
          <Input name="q" defaultValue={q} placeholder="Search problem title / slug…" />
          <Select value={status} onChange={(e) => update({ status: e.target.value })}>
            {STATUSES.map((v) => (
              <option key={v} value={v}>Status: {v}</option>
            ))}
          </Select>
          <Select value={verdict} onChange={(e) => update({ verdict: e.target.value })}>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>Verdict: {v}</option>
            ))}
          </Select>
          <Select value={kind} onChange={(e) => update({ kind: e.target.value })}>
            {KINDS.map((v) => (
              <option key={v} value={v}>Kind: {v.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </form>
      </Card>

      {query.isLoading ? (
        <Skeleton className="h-64" />
      ) : query.isError ? (
        <ErrorBanner message={(query.error as Error).message} onRetry={() => query.refetch()} />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState title="No submissions match" description="Adjust filters or submit a solution." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Verdict</TH>
              <TH>Problem</TH>
              <TH>Runtime</TH>
              <TH>Time / Mem</TH>
              <TH>Score</TH>
              <TH>When</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {query.data!.map((s) => (
              <TR key={s.id}>
                <TD><VerdictChip verdict={s.verdict} status={s.status} /></TD>
                <TD className="max-w-[280px]">
                  <div className="truncate font-medium">{s.problem_title ?? s.problem_slug ?? s.problem_id}</div>
                  <div className="text-[11px] text-[var(--color-text-tertiary)]">{s.submission_kind_code}</div>
                </TD>
                <TD>{s.runtime_name}</TD>
                <TD>
                  <span className="text-[12px]">
                    {s.time_ms != null ? `${s.time_ms}ms` : "—"} ·{" "}
                    {s.memory_kb != null ? `${Math.round(s.memory_kb / 1024)}MB` : "—"}
                  </span>
                </TD>
                <TD>{s.final_score ?? <Chip tone="neutral">—</Chip>}</TD>
                <TD title={formatDate(s.created_at)}>{formatRelative(s.created_at)}</TD>
                <TD className="text-right">
                  <Link
                    to={`/submissions/${s.id}`}
                    className="text-[12px] text-[var(--color-info-fg)] hover:underline"
                  >
                    Detail
                  </Link>
                  {s.problem_slug ? (
                    <>
                      {" · "}
                      <Link
                        to={`/problems/${s.problem_slug}/solve`}
                        className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                      >
                        Solve
                      </Link>
                    </>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
