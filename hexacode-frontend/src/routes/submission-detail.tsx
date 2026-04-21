import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Download, ExternalLink } from "lucide-react";
import {
  downloadAuthenticatedFile,
  getSubmission,
  getSubmissionFileUrl,
  getSubmissionResults,
  type SubmissionResult,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { VerdictChip, Chip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

export function SubmissionDetailRoute() {
  const { submissionId = "" } = useParams();
  const auth = useAuth();
  const sQ = useQuery({
    queryKey: ["submission", submissionId],
    queryFn: () => getSubmission(submissionId),
    enabled: !!submissionId,
  });
  const rQ = useQuery({
    queryKey: ["submission-results", submissionId],
    queryFn: () => getSubmissionResults(submissionId),
    enabled: !!submissionId,
  });

  const results = useMemo(() => rQ.data?.results ?? [], [rQ.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && results[0]) setSelectedId(results[0].id);
  }, [results, selectedId]);
  const selected = results.find((r) => r.id === selectedId);

  if (sQ.isLoading) return <Skeleton className="h-64" />;
  if (sQ.isError)
    return <ErrorBanner message={(sQ.error as Error).message} onRetry={() => sQ.refetch()} />;
  if (!sQ.data) return null;
  const s = sQ.data;

  const download = async (objectId: string) => {
    if (!auth.accessToken) return;
    try {
      await downloadAuthenticatedFile(getSubmissionFileUrl(submissionId, objectId), auth.accessToken);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
      <section className="space-y-4">
        <header>
          <div className="text-eyebrow">Submission</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <h1 className="text-h2">
              <span className="font-mono text-[18px]">{s.id.slice(0, 8)}…</span>
            </h1>
            <VerdictChip verdict={s.verdict} status={s.status} />
            <Chip tone="neutral">{s.submission_kind_code}</Chip>
          </div>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            {s.problem_title ?? s.problem_slug ?? s.problem_id} · {s.runtime_name}
          </p>
        </header>

        <Card>
          <div className="text-eyebrow mb-2">Result rows</div>
          {rQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : rQ.isError ? (
            <ErrorBanner message={(rQ.error as Error).message} />
          ) : results.length === 0 ? (
            <EmptyState title="No results yet" description="Judging may still be in progress." />
          ) : (
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={
                      "w-full flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[12.5px] hairline " +
                      (selectedId === r.id
                        ? "bg-[var(--color-bg-muted)]"
                        : "bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-muted)]")
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                        {r.result_type_code}
                        {r.testcase_ordinal != null ? ` #${r.testcase_ordinal}` : ""}
                      </span>
                      <span className="font-medium">{r.status_code.toUpperCase()}</span>
                    </span>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {r.runtime_ms != null ? `${r.runtime_ms}ms` : ""}
                      {r.memory_kb != null ? ` · ${Math.round(r.memory_kb / 1024)}MB` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected ? (
          <Card>
            <div className="text-eyebrow mb-2">Inspector</div>
            <InspectorPanel r={selected} onDownload={download} canDownload={!!auth.accessToken} />
          </Card>
        ) : null}
      </section>

      <aside className="space-y-3">
        <Card>
          <div className="text-eyebrow">Meta</div>
          <dl className="mt-3 space-y-2 text-[13px]">
            <Row k="Problem" v={s.problem_slug ?? s.problem_id} />
            <Row k="Kind" v={s.submission_kind_code ?? "—"} />
            <Row k="Runtime" v={`${s.runtime_name} · ${s.runtime_profile_key}`} />
            <Row k="Source file" v={s.source_filename ?? "—"} />
            <Row k="Created" v={formatDate(s.created_at)} />
            <Row k="Judged" v={formatDate(s.judged_at)} />
            <Row k="Time / Mem" v={`${s.time_ms ?? "—"}ms · ${s.memory_kb != null ? Math.round(s.memory_kb / 1024) + "MB" : "—"}`} />
            <Row k="Final score" v={s.final_score != null ? String(s.final_score) : "—"} />
          </dl>
          {s.problem_slug ? (
            <Link
              to={`/problems/${s.problem_slug}/solve`}
              className="mt-3 inline-flex items-center gap-1 text-[12px] text-[var(--color-info-fg)] hover:underline"
            >
              Open in solve <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null}
        </Card>
        {s.custom_input ? (
          <Card>
            <div className="text-eyebrow mb-2">Custom input</div>
            <pre className="text-[12px] whitespace-pre-wrap bg-[var(--color-bg-muted)] hairline rounded-[var(--radius-md)] p-2 max-h-60 overflow-auto">
              {s.custom_input}
            </pre>
          </Card>
        ) : null}
        {s.note ? (
          <Card>
            <div className="text-eyebrow mb-2">Note</div>
            <p className="text-[13px] text-[var(--color-text-secondary)]">{s.note}</p>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border-hair)] pb-1.5 last:border-0 last:pb-0">
      <dt className="text-[11px] uppercase tracking-wider text-[var(--color-text-tertiary)]">{k}</dt>
      <dd className="font-medium text-right truncate max-w-[60%]">{v}</dd>
    </div>
  );
}

function InspectorPanel({
  r,
  onDownload,
  canDownload,
}: {
  r: SubmissionResult;
  onDownload: (objectId: string) => void;
  canDownload: boolean;
}) {
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--color-text-secondary)]">Status</span>
        <span className="font-medium">{r.status_code.toUpperCase()}</span>
        {r.exit_code != null ? (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">exit {r.exit_code}</span>
        ) : null}
        {r.signal != null ? (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">signal {r.signal}</span>
        ) : null}
      </div>
      {r.message ? (
        <div>
          <div className="text-eyebrow mb-1">Message</div>
          <p className="text-[12.5px] text-[var(--color-text-secondary)] whitespace-pre-wrap">{r.message}</p>
        </div>
      ) : null}
      {r.checker_message ? (
        <div>
          <div className="text-eyebrow mb-1">Checker</div>
          <p className="text-[12.5px] text-[var(--color-text-secondary)] whitespace-pre-wrap">{r.checker_message}</p>
        </div>
      ) : null}
      {r.note ? (
        <div>
          <div className="text-eyebrow mb-1">Note</div>
          <p className="text-[12.5px] text-[var(--color-text-secondary)]">{r.note}</p>
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {[
          { label: "Input", value: r.input_preview },
          { label: "Expected", value: r.expected_output_preview },
          { label: "Actual", value: r.actual_output_preview },
        ].map((v) =>
          v.value ? (
            <div key={v.label}>
              <div className="text-eyebrow mb-1">{v.label}</div>
              <pre className="text-[11.5px] whitespace-pre-wrap bg-[var(--color-bg-muted)] hairline rounded-[var(--radius-md)] p-2 max-h-60 overflow-auto">
                {v.value}
              </pre>
            </div>
          ) : null,
        )}
      </div>
      {canDownload && (r.stdout_object_id || r.stderr_object_id) ? (
        <div className="flex gap-2">
          {r.stdout_object_id ? (
            <button
              onClick={() => onDownload(r.stdout_object_id!)}
              className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
            >
              <Download className="h-3 w-3" /> stdout
            </button>
          ) : null}
          {r.stderr_object_id ? (
            <button
              onClick={() => onDownload(r.stderr_object_id!)}
              className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
            >
              <Download className="h-3 w-3" /> stderr
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
