import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Filter, ArrowRight, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { getProblems, getTags, getProblemSubmissionStates, type ProblemSummary } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { DifficultyChip, Chip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner, EmptyState, Banner } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Input";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type FilterState = {
  q: string;
  difficulty: string;
  sort: string;
  solved: string;
  tags: string[];
};

const DIFFICULTIES = ["all", "easy", "medium", "hard"];
const SORTS = ["newest", "title", "acceptance"];
const SOLVED = ["all", "solved", "attempted", "unsolved"];

function parseFilters(p: URLSearchParams): FilterState {
  return {
    q: (p.get("q") ?? "").trim(),
    difficulty: p.get("difficulty") ?? "all",
    sort: p.get("sort") ?? "newest",
    solved: p.get("solved") ?? "all",
    tags: p.getAll("tag"),
  };
}

function acceptanceLabel(p: ProblemSummary) {
  if (!p.submissions_count || p.submissions_count === 0) return "No submissions";
  return `${Math.round(((p.accepted_count ?? 0) / p.submissions_count) * 100)}%`;
}

export function ProblemsRoute() {
  const [params, setParams] = useSearchParams();
  const f = parseFilters(params);
  const auth = useAuth();

  const problemsQ = useQuery({
    queryKey: ["problems", "list", f],
    queryFn: () =>
      getProblems({
        q: f.q,
        difficulty: f.difficulty,
        sort: f.sort,
        tags: f.tags,
      }),
  });

  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: () => getTags() });
  const problems = problemsQ.data ?? [];
  const problemIds = problems.map((p) => p.id);
  const authed = auth.status === "authenticated";

  const statesQ = useQuery({
    queryKey: ["problem-states", problemIds],
    queryFn: () => getProblemSubmissionStates(problemIds),
    enabled: authed && problemIds.length > 0,
  });

  const statesMap = useMemo(() => {
    const m = new Map<string, { solved: boolean; attempted: boolean }>();
    statesQ.data?.forEach((s) => m.set(s.problem_id, { solved: s.solved, attempted: s.attempted }));
    return m;
  }, [statesQ.data]);

  const visible = useMemo(() => {
    if (f.solved === "all") return problems;
    if (!authed) return [];
    return problems.filter((p) => {
      const s = statesMap.get(p.id);
      if (f.solved === "solved") return s?.solved;
      if (f.solved === "attempted") return s?.attempted;
      if (f.solved === "unsolved") return !s?.solved;
      return true;
    });
  }, [problems, f.solved, authed, statesMap]);

  const update = (patch: Partial<FilterState>) => {
    const next = new URLSearchParams();
    const merged = { ...f, ...patch };
    if (merged.q) next.set("q", merged.q);
    if (merged.difficulty !== "all") next.set("difficulty", merged.difficulty);
    if (merged.sort !== "newest") next.set("sort", merged.sort);
    if (merged.solved !== "all") next.set("solved", merged.solved);
    merged.tags.forEach((t) => next.append("tag", t));
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (problemsQ.isError) console.error(problemsQ.error);
  }, [problemsQ.isError, problemsQ.error]);

  const toggleTag = (slug: string) => {
    update({
      tags: f.tags.includes(slug) ? f.tags.filter((t) => t !== slug) : [...f.tags, slug],
    });
  };

  const activeFilters =
    (f.difficulty !== "all" ? 1 : 0) +
    (f.solved !== "all" ? 1 : 0) +
    (f.tags.length ? 1 : 0);

  return (
    <div className="space-y-6">
      <header>
        <div className="text-eyebrow">Catalog</div>
        <h1 className="mt-1 text-h1">Problems</h1>
      </header>

      <Card padded>
        <form
          className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const el = e.currentTarget.querySelector<HTMLInputElement>("[name=q]");
            update({ q: el?.value.trim() ?? "" });
          }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" />
            <Input name="q" defaultValue={f.q} placeholder="Search title or slug…" className="pl-9" />
          </div>
          <Select value={f.difficulty} onChange={(e) => update({ difficulty: e.target.value })}>
            {DIFFICULTIES.map((v) => (
              <option key={v} value={v}>
                Difficulty: {v}
              </option>
            ))}
          </Select>
          <Select value={f.sort} onChange={(e) => update({ sort: e.target.value })}>
            {SORTS.map((v) => (
              <option key={v} value={v}>
                Sort: {v}
              </option>
            ))}
          </Select>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            value={f.solved}
            onChange={(e) => update({ solved: e.target.value })}
            className="max-w-[200px]"
          >
            {SOLVED.map((v) => (
              <option key={v} value={v}>
                {v === "all" ? "All progress" : `My: ${v}`}
              </option>
            ))}
          </Select>
          {activeFilters > 0 ? (
            <Chip tone="accent">
              <Filter className="h-3 w-3" /> {activeFilters} active
            </Chip>
          ) : null}
          {activeFilters > 0 ? (
            <button
              type="button"
              onClick={() =>
                update({
                  q: "",
                  difficulty: "all",
                  sort: "newest",
                  solved: "all",
                  tags: [],
                })
              }
              className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] inline-flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          ) : null}
        </div>

        {tagsQ.data && tagsQ.data.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider mr-1">Tags</span>
            {tagsQ.data.map((t) => (
              <button
                key={t.slug}
                type="button"
                onClick={() => toggleTag(t.slug)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors hairline",
                  f.tags.includes(t.slug)
                    ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-transparent"
                    : "bg-[var(--color-bg-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                )}
              >
                #{t.slug}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      {f.solved !== "all" && !authed ? (
        <Banner tone="warn">
          Sign in to filter by solved/attempted. The overlay needs your bearer token.
        </Banner>
      ) : null}

      {statesQ.isError ? (
        <Banner tone="warn">
          Could not load solved-state overlay ({(statesQ.error as Error).message}). Problems still load.
        </Banner>
      ) : null}

      {problemsQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : problemsQ.isError ? (
        <ErrorBanner
          message={(problemsQ.error as Error).message}
          onRetry={() => problemsQ.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No problems match"
          description="Try clearing some filters or changing the search query."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {visible.map((p) => {
            const s = statesMap.get(p.id);
            return (
              <Card key={p.id} className="py-3">
                <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                  <div className="flex-none w-6 flex items-center justify-center">
                    {s?.solved ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--color-ok-fg)]" />
                    ) : s?.attempted ? (
                      <AlertCircle className="h-4 w-4 text-[var(--color-warn-fg)]" />
                    ) : (
                      <Circle className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/problems/${p.slug}`}
                        className="text-[15px] font-semibold hover:underline"
                      >
                        {p.title}
                      </Link>
                      <DifficultyChip value={p.difficulty} />
                      {p.tags?.slice(0, 3).map((t) => (
                        <Chip key={t.slug} tone="neutral">
                          #{t.slug}
                        </Chip>
                      ))}
                    </div>
                    {p.summary_md ? (
                      <p className="mt-1 line-clamp-1 text-[12.5px] text-[var(--color-text-secondary)]">
                        {p.summary_md}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-[var(--color-text-secondary)]">
                    <div className="text-center">
                      <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase">Acceptance</div>
                      <div className="font-medium text-[var(--color-text-primary)]">
                        {acceptanceLabel(p)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[11px] text-[var(--color-text-tertiary)] uppercase">Solvers</div>
                      <div className="font-medium text-[var(--color-text-primary)]">
                        {p.unique_solvers_count ?? 0}
                      </div>
                    </div>
                    <Link
                      to={`/problems/${p.slug}/solve`}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-3 py-1 text-[12px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
                    >
                      Solve <ArrowRight className="h-3 w-3" />
                    </Link>
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
