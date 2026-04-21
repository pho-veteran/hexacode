import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ArrowRight } from "lucide-react";
import { getProblem, getPublicProblemFileUrl } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { DifficultyChip, StatusChip, VisibilityChip, Chip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner } from "@/components/ui/Feedback";
import { Markdown } from "@/components/Markdown";

export function ProblemDetailRoute() {
  const { slug = "" } = useParams();
  const q = useQuery({
    queryKey: ["problem", slug],
    queryFn: () => getProblem(slug),
    enabled: Boolean(slug),
  });

  if (q.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-60" />
      </div>
    );
  if (q.isError)
    return <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  if (!q.data) return null;
  const p = q.data;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
      <article>
        <div className="flex items-center gap-2 flex-wrap">
          <DifficultyChip value={p.difficulty} />
          <StatusChip value={p.status ?? null} />
          <VisibilityChip value={p.visibility ?? null} />
          {p.tags?.map((t) => (
            <Chip key={t.slug} tone="neutral">
              #{t.slug}
            </Chip>
          ))}
        </div>
        <h1 className="mt-3 text-h1">{p.title}</h1>
        {p.summary_md ? (
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)] max-w-2xl">{p.summary_md}</p>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Link
            to={`/problems/${p.slug}/solve`}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-accent)] px-5 text-[14px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
          >
            Open solve <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/problems"
            className="inline-flex h-11 items-center rounded-full hairline bg-[var(--color-bg-elevated)] px-5 text-[14px] font-medium hover:bg-[var(--color-bg-muted)]"
          >
            Back to catalog
          </Link>
        </div>
        {p.statement_object ? (
          <div className="mt-4 text-[13px]">
            <a
              href={getPublicProblemFileUrl(p.slug, p.statement_object.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[var(--color-info-fg)] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View statement file ({p.statement_source})
            </a>
          </div>
        ) : null}
        <hr className="my-6" />
        {p.statement_md ? (
          <Markdown source={p.statement_md} />
        ) : (
          <p className="text-[var(--color-text-secondary)] text-[13px]">
            Statement is stored externally. Use the statement file link above.
          </p>
        )}
        {p.statement_assets.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-h3">Attachments</h2>
            <ul className="mt-2 space-y-1 text-[13px]">
              {p.statement_assets.map((a) => (
                <li key={a.id}>
                  <a
                    href={getPublicProblemFileUrl(p.slug, a.object.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-info-fg)] hover:underline"
                  >
                    {a.logical_name ?? a.object.original_filename ?? a.object.object_key}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>

      <aside className="space-y-3">
        <Card>
          <div className="text-eyebrow">Problem metadata</div>
          <dl className="mt-3 space-y-2 text-[13px]">
            <Row k="Slug" v={p.slug} />
            <Row k="Status" v={p.status ?? "—"} />
            <Row k="Visibility" v={p.visibility ?? "—"} />
            <Row k="Difficulty" v={p.difficulty ?? "—"} />
            <Row k="Scoring" v={p.scoring_code ?? "—"} />
            <Row k="Time limit" v={p.time_limit_ms ? `${p.time_limit_ms} ms` : "—"} />
            <Row k="Memory" v={p.memory_limit_kb ? `${p.memory_limit_kb} KB` : "—"} />
            <Row k="Output" v={p.output_limit_kb ? `${p.output_limit_kb} KB` : "—"} />
          </dl>
        </Card>
        {p.testsets.length > 0 ? (
          <Card>
            <div className="text-eyebrow">Testsets</div>
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {p.testsets.map((ts) => (
                <li key={ts.id} className="flex justify-between gap-3">
                  <span className="truncate">
                    {ts.title ?? ts.testset_type_code}
                    <span className="ml-2 text-[var(--color-text-tertiary)]">
                      {ts.testset_type_code}
                    </span>
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    {ts.extracted_case_count} cases
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {p.active_checker ? (
          <Card>
            <div className="text-eyebrow">Checker</div>
            <dl className="mt-3 space-y-2 text-[13px]">
              <Row k="Type" v={p.active_checker.checker_type_code} />
              {p.active_checker.runtime_profile_key ? (
                <Row k="Runtime" v={p.active_checker.runtime_profile_key} />
              ) : null}
              {p.active_checker.entrypoint ? (
                <Row k="Entry" v={p.active_checker.entrypoint} />
              ) : null}
              {p.active_checker.note ? <Row k="Note" v={p.active_checker.note} /> : null}
            </dl>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border-hair)] pb-1.5 last:border-0 last:pb-0">
      <dt className="text-[12px] text-[var(--color-text-tertiary)] uppercase tracking-wider">{k}</dt>
      <dd className="font-medium text-[13px] text-right truncate">{v}</dd>
    </div>
  );
}
