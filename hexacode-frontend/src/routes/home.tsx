import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Cpu, Code2, Sparkles } from "lucide-react";
import { getProblems } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { DifficultyChip, Chip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner } from "@/components/ui/Feedback";

export function HomeRoute() {
  const q = useQuery({
    queryKey: ["problems", "featured"],
    queryFn: () => getProblems({}),
  });
  const featured = (q.data ?? []).slice(0, 2);

  return (
    <div className="space-y-20">
      <section className="pt-8 pb-4">
        <h1 className="text-display max-w-3xl">
          Ship problems.{" "}
          <span className="bg-gradient-to-br from-[var(--color-grad-orange)] via-[var(--color-grad-pink)] to-[var(--color-grad-cyan)] bg-clip-text text-transparent">
            Judge code.
          </span>{" "}
          Look good doing it.
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] text-[var(--color-text-secondary)]">
          Hexacode is a programming-judge platform with a quiet surface and a serious engine.
          Browse the catalog, open a problem, or start authoring in seconds.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/problems"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-accent)] px-5 text-[14px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
          >
            Browse problems <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/dashboard/problems/new"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-bg-elevated)] hairline px-5 text-[14px] font-medium hover:bg-[var(--color-bg-muted)]"
          >
            Open authoring form
          </Link>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-eyebrow">Featured</div>
            <h2 className="text-h2 mt-1">Two problems worth your attention</h2>
          </div>
          <Link
            to="/problems"
            className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] inline-flex items-center gap-1"
          >
            All problems <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {q.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : q.isError ? (
          <ErrorBanner
            message={(q.error as Error)?.message}
            onRetry={() => q.refetch()}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {featured.length === 0 ? (
              <Card className="md:col-span-2 text-center py-10 text-[var(--color-text-secondary)]">
                The catalog has no public problems yet.
              </Card>
            ) : (
              featured.map((p) => (
                <Card key={p.id}>
                  <div className="flex items-center gap-2">
                    <DifficultyChip value={p.difficulty} />
                    {p.tags?.slice(0, 2).map((t) => (
                      <Chip key={t.slug} tone="neutral">
                        #{t.slug}
                      </Chip>
                    ))}
                  </div>
                  <h3 className="mt-3 text-[18px] font-semibold">
                    <Link to={`/problems/${p.slug}`} className="hover:underline">
                      {p.title}
                    </Link>
                  </h3>
                  <p className="mt-2 line-clamp-3 text-[13px] text-[var(--color-text-secondary)]">
                    {p.summary_md ?? "No summary."}
                  </p>
                  <div className="mt-4 flex items-center gap-3 text-[13px]">
                    <Link
                      to={`/problems/${p.slug}`}
                      className="text-[var(--color-text-primary)] hover:underline"
                    >
                      Read statement
                    </Link>
                    <Link
                      to={`/problems/${p.slug}/solve`}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-3 py-1 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
                    >
                      Open solve
                    </Link>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </section>

      <section>
        <div className="text-eyebrow">The platform</div>
        <h2 className="text-h2 mt-1">Built on boring, durable pieces</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <Card>
            <Code2 className="h-4 w-4 text-[var(--color-accent)]" />
            <h3 className="mt-2 text-[15px] font-semibold">Author with confidence</h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Multi-part uploads, autosave, checker wiring, and a 1-click lifecycle.
            </p>
          </Card>
          <Card>
            <Cpu className="h-4 w-4 text-[var(--color-accent)]" />
            <h3 className="mt-2 text-[15px] font-semibold">Judge queues that hum</h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Workers, jobs, runs, outbox — all visible in the ops view. No black box.
            </p>
          </Card>
          <Card>
            <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
            <h3 className="mt-2 text-[15px] font-semibold">A surface you can read</h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              One design system. One verdict vocabulary. No neon glow, ever.
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
}
