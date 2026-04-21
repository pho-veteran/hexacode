import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowLeft,
  CheckSquare,
  ExternalLink,
  FileText,
  History as HistoryIcon,
  ListChecks,
  Play,
  Plus,
  Send,
  Settings,
  Terminal,
  X,
} from "lucide-react";
import {
  createSubmission,
  getMySubmissions,
  getProblemSolve,
  getRuntimes,
  getSubmission,
  getSubmissionResults,
  getSubmissionSource,
  type ProblemSolveDetail,
  type ProblemSolveSampleTestcase,
  type SubmissionDetail,
  type SubmissionResult,
} from "@/lib/api";
import { DifficultyChip, VerdictChip } from "@/components/ui/Chip";
import { Tabs, TabContent } from "@/components/ui/Tabs";
import { Markdown } from "@/components/Markdown";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Input";
import { useAuth } from "@/lib/auth";
import {
  createCustomTestcase,
  loadWorkspace,
  saveWorkspace,
  type CustomTestcase,
  type WorkspaceState,
} from "@/stores/workspace";
import { clamp, formatDate } from "@/lib/utils";
import { Brand } from "@/components/shell/Brand";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

const POLL_MS = 2000;

function languageForRuntime(runtimeKey: string) {
  const k = runtimeKey.toLowerCase();
  if (k.includes("py")) return "python";
  if (k.includes("go")) return "go";
  if (k.includes("rust") || k.includes("rs")) return "rust";
  if (k.includes("java")) return "java";
  if (k.includes("kotlin")) return "kotlin";
  if (k.includes("cpp") || k.includes("c++") || k.includes("gpp")) return "cpp";
  if (k.includes("node") || k.includes("js")) return "javascript";
  if (k.includes("ts")) return "typescript";
  if (k.includes("c")) return "c";
  return "plaintext";
}

function isTerminal(status: string | undefined) {
  return status === "done" || status === "failed" || status === "cancelled";
}

function getVisibleRunTestset(problem: ProblemSolveDetail) {
  return problem.run_testset?.id && problem.sample_testcases.length > 0 ? problem.run_testset : null;
}

function hasCustomInput(value: string) {
  return value.length > 0;
}

function runnableCustomCases(customTestcases: CustomTestcase[]) {
  return customTestcases.filter((testcase) => testcase.input.trim().length > 0);
}

function normalizeOutput(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\s+$/g, "");
}

function compareOutput(expected: string, actual: string | null | undefined) {
  if (!expected.trim()) return null;
  if (actual == null) return "pending" as const;
  return normalizeOutput(expected) === normalizeOutput(actual) ? "match" : "mismatch";
}

function customResultCaseId(result: SubmissionResult) {
  return result.result_type_code === "custom_case" ? result.note ?? null : null;
}

export type RunEntry = {
  id: string;
  submission: SubmissionDetail | null;
  results: SubmissionResult[];
};

export function ProblemSolveRoute() {
  const { slug = "" } = useParams();
  const auth = useAuth();
  const qc = useQueryClient();

  const problemQ = useQuery({
    queryKey: ["problem-solve", slug],
    queryFn: () => getProblemSolve(slug),
    enabled: !!slug,
  });
  const runtimesQ = useQuery({ queryKey: ["runtimes"], queryFn: getRuntimes });

  const problem = problemQ.data;
  const runtimes = runtimesQ.data ?? [];

  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [recent, setRecent] = useState<SubmissionDetail[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [localSaveStamp, setLocalSaveStamp] = useState<string | null>(null);

  const primaryRun = runs[0] ?? null;
  const aggregateSubmitting =
    submitting ||
    (runs.length > 0 && runs.some((run) => !run.submission || !isTerminal(run.submission.status)));

  useEffect(() => {
    if (!problem || runtimes.length === 0) return;
    const ws = loadWorkspace(problem.id, runtimes[0].profile_key);
    if (!runtimes.some((r) => r.profile_key === ws.runtimeKey)) ws.runtimeKey = runtimes[0].profile_key;
    setWorkspace(ws);
    setWorkspaceReady(true);
  }, [problem, runtimes]);

  useEffect(() => {
    if (!workspaceReady || !workspace || !problem) return;
    saveWorkspace(problem.id, workspace);
    setLocalSaveStamp(new Date().toISOString());
  }, [workspace, workspaceReady, problem]);

  const update = useCallback((patch: Partial<WorkspaceState>) => {
    setWorkspace((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const loadRecent = useCallback(async () => {
    if (!auth.accessToken || !problem) return;
    setRecentLoading(true);
    setRecentError(null);
    try {
      const list = await getMySubmissions({ problemId: problem.id, limit: 50 });
      setRecent(list.filter((submission) => submission.submission_kind_code !== "run"));
    } catch (error) {
      setRecentError((error as Error).message);
    } finally {
      setRecentLoading(false);
    }
  }, [auth.accessToken, problem]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  const runIdsKey = runs.map((run) => run.id).join(",");
  useEffect(() => {
    if (runs.length === 0) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const pending = runsRef.current.filter(
          (run) => !run.submission || !isTerminal(run.submission.status),
        );
        if (pending.length === 0) return;

        const updates = await Promise.all(
          pending.map(async (run) => {
            try {
              const [nextSubmission, nextResults] = await Promise.all([
                getSubmission(run.id),
                getSubmissionResults(run.id),
              ]);
              return { id: run.id, submission: nextSubmission, results: nextResults.results };
            } catch {
              return null;
            }
          }),
        );
        if (!alive) return;

        setRuns((current) =>
          current.map((run) => {
            const update = updates.find((u) => u && u.id === run.id);
            if (!update) return run;
            return { ...run, submission: update.submission, results: update.results };
          }),
        );

        setRecent((current) =>
          current.map((item) => {
            const update = updates.find((u) => u && u.id === item.id);
            return update && update.submission ? { ...item, ...update.submission } : item;
          }),
        );

        const stillPending = updates.some((u) => u && !isTerminal(u.submission.status));
        if (stillPending) timer = setTimeout(tick, POLL_MS);
      } catch (error) {
        if (!alive) return;
        setSubmissionError((error as Error).message);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIdsKey]);

  const submit = useCallback(
    async (kind: "run" | "practice") => {
      if (!workspace || !problem) return;
      setSubmissionError(null);
      if (!auth.accessToken) {
        setSubmissionError("Sign in before creating a submission.");
        return;
      }
      if (!workspace.runtimeKey) {
        setSubmissionError("Select a runtime.");
        return;
      }
      if (!workspace.sourceCode.trim()) {
        setSubmissionError("Source code is empty.");
        return;
      }

      if (kind === "practice") {
        setSubmitting(true);
        setRuns([]);
        try {
          const created = await createSubmission({
            problem_id: problem.id,
            runtime_profile_key: workspace.runtimeKey,
            source_code: workspace.sourceCode,
            submission_kind_code: "practice",
          });
          setRuns([{ id: created.id, submission: null, results: [] }]);
          void loadRecent();
          void qc.invalidateQueries({ queryKey: ["my-submissions"] });
        } catch (error) {
          setSubmissionError((error as Error).message);
        } finally {
          setSubmitting(false);
        }
        return;
      }

      const runTestset = getVisibleRunTestset(problem);
      const customCases = runnableCustomCases(workspace.customTestcases);
      if (!runTestset && customCases.length === 0) {
        setSubmissionError("Add custom input or use a problem with visible sample testcases before running.");
        update({ activeLowerTab: "testcase" });
        return;
      }

      setSubmitting(true);
      update({ activeLowerTab: "testresult" });
      setRuns([]);

      try {
        const created = await createSubmission({
          problem_id: problem.id,
          runtime_profile_key: workspace.runtimeKey,
          source_code: workspace.sourceCode,
          submission_kind_code: "run",
          testset_id: runTestset?.id ?? null,
          custom_cases: customCases.map((testcase) => ({
            id: testcase.id,
            input: testcase.input,
            expected_output: testcase.expected_output,
          })),
        });
        setRuns([{ id: created.id, submission: null, results: [] }]);
      } catch (error) {
        setSubmissionError((error as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [auth.accessToken, loadRecent, problem, qc, update, workspace],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) void submit("practice");
        else void submit("run");
      }
      if (event.altKey && event.key === "1") update({ activeLowerTab: "testcase" });
      if (event.altKey && event.key === "2") update({ activeLowerTab: "testresult" });
      if (event.altKey && event.key === "\\") update({ sidebarVisible: !workspace?.sidebarVisible });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, update, workspace?.sidebarVisible]);

  const reuseSource = useCallback(
    async (id: string) => {
      if (!auth.accessToken) {
        setSubmissionError("Sign in required to fetch source.");
        return;
      }
      try {
        const source = await getSubmissionSource(id);
        if (source.source_code) {
          update({ sourceCode: source.source_code });
        }
      } catch (error) {
        setSubmissionError((error as Error).message);
      }
    },
    [auth.accessToken, update],
  );

  if (problemQ.isLoading || runtimesQ.isLoading) return <WorkspaceSkeleton />;
  if (problemQ.isError) {
    return (
      <div className="p-6">
        <ErrorBanner message={(problemQ.error as Error).message} onRetry={() => problemQ.refetch()} />
      </div>
    );
  }
  if (!problem || !workspace) return <WorkspaceSkeleton />;

  const lang = languageForRuntime(workspace.runtimeKey);
  const canRun =
    !!getVisibleRunTestset(problem) || runnableCustomCases(workspace.customTestcases).length > 0;

  const openRecentRun = (id: string) => {
    setRuns([{ id, submission: null, results: [] }]);
    update({ activeLowerTab: "testresult" });
    void reuseSource(id);
  };

  return (
    <div className="flex h-screen min-h-[640px] min-w-[1024px] flex-col">
      <WorkspaceTopBar
        title={problem.title}
        slug={problem.slug}
        difficulty={problem.difficulty}
        status={primaryRun?.submission?.status}
        verdict={primaryRun?.submission?.verdict}
        canRun={canRun}
        onRun={() => submit("run")}
        onSubmit={() => submit("practice")}
        submitting={aggregateSubmitting}
        localSaveStamp={localSaveStamp}
      />

      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" className="h-full">
          <Panel defaultSize={workspace.sidebarWidthPercent} minSize={24} maxSize={48}>
            <SidePanel
              problem={problem}
              workspace={workspace}
              update={update}
              recent={recent}
              onOpenRecent={openRecentRun}
              onReuse={reuseSource}
            />
          </Panel>
          <PanelResizeHandle className="w-px bg-[var(--color-border-hair)] hover:bg-[var(--color-accent)] transition-colors" />
          <Panel defaultSize={100 - workspace.sidebarWidthPercent} minSize={30}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={62} minSize={30}>
                <EditorPanel
                  value={workspace.sourceCode}
                  language={lang}
                  fontSize={workspace.editorFontSize}
                  onChange={(value) => update({ sourceCode: value })}
                  runtimeKey={workspace.runtimeKey}
                  runtimes={runtimes.map((runtime) => ({ key: runtime.profile_key, name: runtime.runtime_name }))}
                  onRuntimeChange={(runtimeKey) => update({ runtimeKey })}
                />
              </Panel>
              <PanelResizeHandle className="h-px bg-[var(--color-border-hair)] hover:bg-[var(--color-accent)] transition-colors" />
              <Panel defaultSize={38} minSize={18}>
                <LowerPanel
                  problem={problem}
                  workspace={workspace}
                  update={update}
                  runs={runs}
                  submissionError={submissionError}
                  submitting={aggregateSubmitting}
                  onRun={() => submit("run")}
                />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="p-6 space-y-3">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

function WorkspaceTopBar(props: {
  title: string;
  slug: string;
  difficulty?: string | null;
  status?: string;
  verdict?: string | null;
  canRun: boolean;
  onRun: () => void;
  onSubmit: () => void;
  submitting: boolean;
  localSaveStamp: string | null;
}) {
  return (
    <header className="h-14 grid grid-cols-[1fr_auto_1fr] items-center px-4 border-b border-[var(--color-border-hair)] bg-[var(--color-bg-base)] flex-none gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/" className="flex items-center" aria-label="Hexacode home">
          <Brand size="sm" />
        </Link>
        <span className="h-4 w-px bg-[var(--color-border-hair)]" />
        <Link
          to="/problems"
          className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-2.5 h-7 text-[11.5px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)] transition-colors"
          title="Back to problems"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Problems
        </Link>
        <div className="min-w-0 flex items-center gap-2">
          <Link
            to={`/problems/${props.slug}`}
            className="truncate font-semibold text-[14px] hover:underline"
            title="Open problem page"
          >
            {props.title}
          </Link>
          <DifficultyChip value={props.difficulty} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={props.submitting || !props.canRun}
          onClick={props.onRun}
          className="inline-flex h-8 items-center gap-1.5 rounded-full hairline bg-[var(--color-bg-elevated)] px-3.5 text-[12.5px] font-medium hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
          title={props.canRun ? "Run visible samples and custom input" : "Add custom input or use visible sample cases to run"}
        >
          <Play className="h-3.5 w-3.5" /> Run
        </button>
        <button
          type="button"
          disabled={props.submitting}
          onClick={props.onSubmit}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-4 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:brightness-95 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> Submit
        </button>
      </div>
      <div className="flex items-center justify-end gap-2 text-[11px] text-[var(--color-text-tertiary)]">
        {props.localSaveStamp ? <span>Local save · {new Date(props.localSaveStamp).toLocaleTimeString()}</span> : null}
        <VerdictChip verdict={props.verdict} status={props.status} />
        <ThemeToggle />
      </div>
    </header>
  );
}

function SidePanel({
  problem,
  workspace,
  update,
  recent,
  onOpenRecent,
  onReuse,
}: {
  problem: ProblemSolveDetail;
  workspace: WorkspaceState;
  update: (patch: Partial<WorkspaceState>) => void;
  recent: SubmissionDetail[];
  onOpenRecent: (id: string) => void;
  onReuse: (id: string) => void;
}) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      <Tabs
        value={workspace.activeSideTab}
        onValueChange={(value) => update({ activeSideTab: value as WorkspaceState["activeSideTab"] })}
        items={[
          { value: "statement", label: <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Statement</span> },
          { value: "problem", label: <span className="inline-flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Problem</span> },
          { value: "history", label: <span className="inline-flex items-center gap-1.5"><HistoryIcon className="h-3.5 w-3.5" /> History</span> },
          { value: "preferences", label: <span className="inline-flex items-center gap-1.5"><Settings className="h-3.5 w-3.5" /> Prefs</span> },
        ]}
      >
        <div className="relative flex-1 min-h-0">
          <TabContent value="statement" className="h-full outline-none">
            <div className="h-full overflow-y-auto p-4">
              {problem.statement_md ? (
                <Markdown source={problem.statement_md} />
              ) : (
                <p className="text-[13px] text-[var(--color-text-secondary)]">No inline statement. See attachments.</p>
              )}
            </div>
          </TabContent>
          <TabContent value="problem" className="h-full outline-none">
            <div className="h-full overflow-y-auto p-4">
              <div className="space-y-3 text-[13px]">
                <InfoRow k="Slug" v={problem.slug} />
                <InfoRow k="Difficulty" v={problem.difficulty ?? "—"} />
                <InfoRow k="Time" v={problem.time_limit_ms ? `${problem.time_limit_ms} ms` : "—"} />
                <InfoRow k="Memory" v={problem.memory_limit_kb ? `${problem.memory_limit_kb} KB` : "—"} />
                <InfoRow k="Scoring" v={problem.scoring_code ?? "—"} />
                <InfoRow k="Samples" v={problem.sample_testcases.length ? String(problem.sample_testcases.length) : "None"} />
                <div>
                  <div className="text-eyebrow mt-4">Testsets</div>
                  <ul className="mt-2 space-y-1 text-[13px]">
                    {problem.testsets.map((testset) => (
                      <li key={testset.id} className="flex justify-between gap-2">
                        <span>{testset.title ?? testset.testset_type_code}</span>
                        <span className="text-[var(--color-text-tertiary)]">{testset.extracted_case_count}</span>
                      </li>
                    ))}
                    {problem.testsets.length === 0 ? <li className="text-[var(--color-text-tertiary)]">None yet</li> : null}
                  </ul>
                </div>
                {problem.active_checker ? (
                  <div>
                    <div className="text-eyebrow mt-4">Checker</div>
                    <div className="mt-1">{problem.active_checker.checker_type_code}</div>
                  </div>
                ) : null}
              </div>
            </div>
          </TabContent>
          <TabContent value="history" className="h-full outline-none">
            <div className="h-full overflow-y-auto p-4">
              <RecentList recent={recent} onOpen={onOpenRecent} onReuse={onReuse} />
            </div>
          </TabContent>
          <TabContent value="preferences" className="h-full outline-none">
            <div className="h-full overflow-y-auto p-4">
              <div className="space-y-4 text-[13px]">
                <div>
                  <label className="text-eyebrow">Font size ({workspace.editorFontSize}px)</label>
                  <input
                    type="range"
                    min={12}
                    max={22}
                    value={workspace.editorFontSize}
                    onChange={(event) => update({ editorFontSize: clamp(Number(event.target.value), 12, 22) })}
                    className="w-full accent-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <div className="text-eyebrow">Shortcuts</div>
                  <ul className="mt-2 space-y-1 text-[12px] text-[var(--color-text-secondary)]">
                    <li><kbd>Ctrl/⌘ Enter</kbd> — run samples and custom input</li>
                    <li><kbd>Ctrl/⌘ Shift Enter</kbd> — submit full judge</li>
                    <li><kbd>Alt 1</kbd> — Testcase tab</li>
                    <li><kbd>Alt 2</kbd> — Test Result tab</li>
                    <li><kbd>Alt \\</kbd> — toggle sidebar</li>
                  </ul>
                </div>
              </div>
            </div>
          </TabContent>
        </div>
      </Tabs>
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border-hair)] pb-1 last:border-0 last:pb-0">
      <dt className="text-[11px] uppercase tracking-wider text-[var(--color-text-tertiary)]">{k}</dt>
      <dd className="font-medium text-right truncate">{v}</dd>
    </div>
  );
}

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function getTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function EditorPanel({
  value,
  language,
  fontSize,
  onChange,
  runtimeKey,
  runtimes,
  onRuntimeChange,
}: {
  value: string;
  language: string;
  fontSize: number;
  onChange: (value: string) => void;
  runtimeKey: string;
  runtimes: { key: string; name: string }[];
  onRuntimeChange: (runtimeKey: string) => void;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "light");
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-base)]">
      <div className="h-10 flex items-center justify-between gap-3 px-3 border-b border-[var(--color-border-hair)] text-[12px] text-[var(--color-text-secondary)] flex-none">
        <Select
          value={runtimeKey}
          onChange={(event) => onRuntimeChange(event.target.value)}
          className="h-8 max-w-[240px] text-[12px] py-0"
        >
          {runtimes.map((runtime) => (
            <option key={runtime.key} value={runtime.key}>
              {runtime.name} ({runtime.key})
            </option>
          ))}
        </Select>
        <span className="text-[11px] text-[var(--color-text-tertiary)] flex items-center gap-2">
          <span className="uppercase tracking-wider">{language}</span>
          <span className="h-3 w-px bg-[var(--color-border-hair)]" />
          <span className="tabular-nums">{value.length} chars</span>
        </span>
      </div>
      <div className="flex-1 min-h-0 monaco-host">
        <Editor
          height="100%"
          theme={monacoTheme}
          language={language}
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? "")}
          onMount={(editor, monaco) => {
            const remeasure = () => {
              try {
                monaco.editor.remeasureFonts();
                editor.render(true);
              } catch {}
            };
            remeasure();
            const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
            if (fonts?.ready) {
              void fonts.ready.then(remeasure);
            }
            window.setTimeout(remeasure, 250);
            window.setTimeout(remeasure, 1000);
          }}
          options={{
            fontSize,
            fontFamily: "'JetBrains Mono', 'JetBrains Mono Variable', ui-monospace, Menlo, Consolas, monospace",
            fontWeight: "400",
            fontLigatures: false,
            lineHeight: Math.round(fontSize * 1.55),
            letterSpacing: 0,
            disableMonospaceOptimizations: true,
            minimap: { enabled: false },
            smoothScrolling: false,
            scrollBeyondLastLine: false,
            tabSize: 2,
            automaticLayout: true,
            wordWrap: "on",
            renderLineHighlight: "line",
            roundedSelection: false,
            selectionHighlight: true,
            occurrencesHighlight: "singleFile",
            padding: { top: 12, bottom: 12 },
            scrollbar: {
              vertical: "auto",
              horizontal: "auto",
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
          }}
        />
      </div>
    </div>
  );
}

function LowerPanel({
  problem,
  workspace,
  update,
  runs,
  submissionError,
  submitting,
  onRun,
}: {
  problem: ProblemSolveDetail;
  workspace: WorkspaceState;
  update: (patch: Partial<WorkspaceState>) => void;
  runs: RunEntry[];
  submissionError: string | null;
  submitting: boolean;
  onRun: () => void;
}) {
  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-base)]">
      <div className="h-9 flex items-center px-3 border-b border-[var(--color-border-hair)] flex-none gap-0.5">
        <button
          type="button"
          onClick={() => update({ activeLowerTab: "testcase" })}
          className={
            "inline-flex items-center gap-1.5 text-[12.5px] font-medium px-1 py-1 transition-colors " +
            (workspace.activeLowerTab === "testcase"
              ? "text-[var(--color-text-primary)]"
              : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]")
          }
        >
          <CheckSquare className="h-3.5 w-3.5" /> Testcase
        </button>
        <span className="mx-2 text-[var(--color-text-tertiary)] select-none text-[11px]">|</span>
        <button
          type="button"
          onClick={() => update({ activeLowerTab: "testresult" })}
          className={
            "inline-flex items-center gap-1.5 text-[12.5px] font-medium px-1 py-1 transition-colors " +
            (workspace.activeLowerTab === "testresult"
              ? "text-[var(--color-text-primary)]"
              : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]")
          }
        >
          <Terminal className="h-3.5 w-3.5" /> Test Result
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {workspace.activeLowerTab === "testcase" ? (
          <TestcaseView
            problem={problem}
            workspace={workspace}
            update={update}
            submitting={submitting}
            onRun={onRun}
          />
        ) : (
          <TestResultView
            problem={problem}
            workspace={workspace}
            update={update}
            runs={runs}
            error={submissionError}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}

type LowerCase =
  | { kind: "sample"; ordinal: number; sampleId: string; input: string | null | undefined; expected: string | null | undefined; note?: string | null }
  | { kind: "custom"; ordinal: number; customId: string; customIdx: number };

function useLowerCases(problem: ProblemSolveDetail, workspace: WorkspaceState): LowerCase[] {
  const samples: LowerCase[] = problem.sample_testcases.map((sample) => ({
    kind: "sample" as const,
    ordinal: sample.ordinal,
    sampleId: sample.id,
    input: sample.input_text,
    expected: sample.expected_output_text,
    note: sample.note,
  }));
  const sampleCount = samples.length;
  const customs: LowerCase[] = workspace.customTestcases.map((testcase, customIdx) => ({
    kind: "custom" as const,
    ordinal: sampleCount + customIdx + 1,
    customId: testcase.id,
    customIdx,
  }));
  return [...samples, ...customs];
}

function TestcaseView({
  problem,
  workspace,
  update,
  submitting,
  onRun,
}: {
  problem: ProblemSolveDetail;
  workspace: WorkspaceState;
  update: (patch: Partial<WorkspaceState>) => void;
  submitting: boolean;
  onRun: () => void;
}) {
  const cases = useLowerCases(problem, workspace);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (selectedIdx >= cases.length && cases.length > 0) setSelectedIdx(0);
  }, [cases.length, selectedIdx]);

  const idx = cases.length === 0 ? 0 : Math.min(selectedIdx, cases.length - 1);
  const selected = cases[idx];

  const canRun =
    problem.sample_testcases.length > 0 ||
    runnableCustomCases(workspace.customTestcases).length > 0;

  const addCustom = () => {
    const next = [...workspace.customTestcases, createCustomTestcase("", "")];
    update({ customTestcases: next });
    setSelectedIdx(problem.sample_testcases.length + next.length - 1);
  };

  const updateCustom = (customId: string, patch: Partial<CustomTestcase>) => {
    update({
      customTestcases: workspace.customTestcases.map((testcase) =>
        testcase.id === customId ? { ...testcase, ...patch } : testcase,
      ),
    });
  };

  const removeCustom = (customId: string) => {
    const next = workspace.customTestcases.filter((testcase) => testcase.id !== customId);
    update({ customTestcases: next });
    setSelectedIdx((current) => Math.max(0, Math.min(current, problem.sample_testcases.length + next.length - 1)));
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {cases.map((c, i) => (
          <div
            key={c.kind === "sample" ? c.sampleId : c.customId}
            className="group relative"
          >
            <button
              type="button"
              onClick={() => setSelectedIdx(i)}
              className={
                "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 h-7 text-[12px] font-medium transition-colors hairline " +
                (c.kind === "custom" ? "pr-8 " : "") +
                (i === idx
                  ? "bg-[var(--color-bg-muted)] text-[var(--color-text-primary)]"
                  : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
              }
            >
              Case {c.ordinal}
            </button>
            {c.kind === "custom" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeCustom(c.customId);
                }}
                title="Remove this custom testcase"
                className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-err-fg)] group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={addCustom}
          title="Add custom testcase"
          className="inline-flex items-center justify-center rounded-[var(--radius-sm)] w-7 h-7 text-[12px] font-medium transition-colors hairline bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onRun}
            disabled={!canRun || submitting}
            className="inline-flex h-7 items-center gap-1.5 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 text-[12px] font-medium hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
          >
            <Play className="h-3 w-3" /> Run all
          </button>
        </div>
      </div>

      {!selected ? (
        <EmptyState
          title="No testcases yet"
          description="This problem has no visible sample cases. Use the + button to add a custom testcase."
        />
      ) : selected.kind === "sample" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-eyebrow">Input</div>
            <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12.5px] font-mono text-[var(--color-text-primary)] whitespace-pre-wrap overflow-auto m-0">
              {selected.input ?? "No input available."}
            </pre>
          </div>
          <div className="space-y-1.5">
            <div className="text-eyebrow">Expected output</div>
            <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12.5px] font-mono text-[var(--color-text-primary)] whitespace-pre-wrap overflow-auto m-0">
              {selected.expected ?? "No expected output available."}
            </pre>
          </div>
          {selected.note ? (
            <p className="text-[12px] text-[var(--color-text-tertiary)]">{selected.note}</p>
          ) : null}
        </div>
      ) : (
        (() => {
          const testcase = workspace.customTestcases[selected.customIdx];
          if (!testcase) return null;
          return (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-eyebrow">Input</span>
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">Custom testcase</span>
                </div>
                <textarea
                  value={testcase.input}
                  onChange={(e) => updateCustom(testcase.id, { input: e.target.value })}
                  placeholder="Paste or type the input for this testcase."
                  className="w-full min-h-24 resize-y rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 font-mono text-[12.5px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-[var(--color-accent)]"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-eyebrow">Expected output</div>
                <textarea
                  value={testcase.expected_output}
                  onChange={(e) => updateCustom(testcase.id, { expected_output: e.target.value })}
                  placeholder="Optional — if provided, Run will compare actual output against this."
                  className="w-full min-h-20 resize-y rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 font-mono text-[12.5px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-[var(--color-accent)]"
                  spellCheck={false}
                />
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

type CaseResultInfo = {
  statusCode: string;
  actualOutput: string | null;
  expected: string;
  message: string | null;
  checkerMessage: string | null;
  runtimeMs: number | null;
  comparison: "match" | "mismatch" | "pending" | null;
  run: RunEntry | null;
  result: SubmissionResult | null;
};

function resolveCaseResult(lowerCase: LowerCase, workspace: WorkspaceState, runs: RunEntry[]): CaseResultInfo {
  if (lowerCase.kind === "sample") {
    const primary = runs[0] ?? null;
    const sampleResult =
      primary?.results.find(
        (r) => r.result_type_code === "testcase" && r.testcase_id === lowerCase.sampleId,
      ) ?? null;
    return {
      statusCode: sampleResult?.status_code ?? (primary ? "pending" : "neutral"),
      actualOutput: sampleResult?.actual_output_preview ?? null,
      expected: lowerCase.expected ?? "",
      message: sampleResult?.message ?? null,
      checkerMessage: sampleResult?.checker_message ?? null,
      runtimeMs: sampleResult?.runtime_ms ?? null,
      comparison: null,
      run: primary,
      result: sampleResult,
    };
  }

  const testcase = workspace.customTestcases[lowerCase.customIdx];
  const run = runs[0] ?? null;
  const result =
    run?.results.find((r) => r.result_type_code === "custom_case" && customResultCaseId(r) === lowerCase.customId) ??
    null;
  const actualOutput = result?.actual_output_preview ?? null;
  const expected = result?.expected_output_preview ?? testcase?.expected_output ?? "";
  const judgeStatus = result?.status_code ?? (run ? "pending" : "neutral");
  const comparison = run && isTerminal(run.submission?.status ?? "") ? compareOutput(expected, actualOutput) : expected.trim() ? "pending" : null;

  let statusCode = judgeStatus;
  if (run && isTerminal(run.submission?.status ?? "")) {
    if (judgeStatus?.toLowerCase() === "re" || judgeStatus?.toLowerCase() === "tle" || judgeStatus?.toLowerCase() === "mle" || judgeStatus?.toLowerCase() === "ce") {
      statusCode = judgeStatus;
    } else if (comparison === "match") statusCode = "ac";
    else if (comparison === "mismatch") statusCode = "wa";
    else statusCode = judgeStatus || "neutral";
  }

  return {
    statusCode,
    actualOutput,
    expected,
    message: result?.message ?? null,
    checkerMessage: result?.checker_message ?? null,
    runtimeMs: result?.runtime_ms ?? null,
    comparison,
    run,
    result,
  };
}

function TestResultView({
  problem,
  workspace,
  update,
  runs,
  error,
  submitting,
}: {
  problem: ProblemSolveDetail;
  workspace: WorkspaceState;
  update: (patch: Partial<WorkspaceState>) => void;
  runs: RunEntry[];
  error: string | null;
  submitting: boolean;
}) {
  const cases = useLowerCases(problem, workspace);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (selectedIdx >= cases.length && cases.length > 0) setSelectedIdx(0);
  }, [cases.length, selectedIdx]);

  const removeCustom = (customId: string) => {
    const next = workspace.customTestcases.filter((testcase) => testcase.id !== customId);
    update({ customTestcases: next });
    setSelectedIdx((current) => Math.max(0, Math.min(current, problem.sample_testcases.length + next.length - 1)));
  };

  const ceRun = runs.find((run) =>
    run.submission?.verdict?.toUpperCase() === "CE" ||
    run.results.some((r) => r.status_code?.toUpperCase() === "CE"),
  );
  if (ceRun) {
    const ceResult = ceRun.results.find((r) => r.status_code?.toUpperCase() === "CE");
    const errorMsg = ceResult?.message ?? "Compilation failed.";
    return (
      <div className="p-4 space-y-3">
        <h3 className="text-[15px] font-semibold text-[var(--color-err-fg)]">Compile Error</h3>
        <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12px] font-mono text-[var(--color-err-fg)] whitespace-pre-wrap break-words m-0">
          {errorMsg}
        </pre>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-4 text-[13px] text-[var(--color-text-tertiary)]">
        {submitting ? "Running…" : "Run your code to see the results here."}
      </div>
    );
  }

  const practiceRun =
    runs.length === 1 && runs[0].submission?.submission_kind_code === "practice" ? runs[0] : null;
  if (practiceRun) {
    const submission = practiceRun.submission!;
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <VerdictChip verdict={submission.verdict} status={submission.status} />
          {submission.time_ms != null ? (
            <span className="text-[12px] text-[var(--color-text-tertiary)] tabular-nums">{submission.time_ms} ms</span>
          ) : null}
          <Link
            to={`/submissions/${submission.id}`}
            className="text-[12px] inline-flex items-center gap-1 text-[var(--color-info-fg)] hover:underline"
          >
            Full detail <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        {practiceRun.results.length > 0 ? (
          <div className="space-y-2">
            {practiceRun.results.slice(0, 10).map((result, i) => (
              <TestcaseResultCard key={result.testcase_id ?? result.testcase_ordinal ?? i} result={result} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="p-4 text-[13px] text-[var(--color-text-tertiary)]">No testcases to show.</div>
    );
  }

  const idx = Math.min(selectedIdx, cases.length - 1);
  const selected = cases[idx];
  const info = resolveCaseResult(selected, workspace, runs);
  const isRunning = info.run ? !isTerminal(info.run.submission?.status ?? "") : false;

  const selectedInput = selected.kind === "sample"
    ? selected.input
    : workspace.customTestcases[selected.customIdx]?.input ?? "";
  const selectedExpected = info.expected;

  const toneText =
    info.comparison === "match" || info.statusCode?.toLowerCase() === "ac"
      ? "text-[var(--color-ok-fg)]"
      : info.comparison === "mismatch" || ["wa", "re", "tle", "mle", "ie"].includes(info.statusCode?.toLowerCase() ?? "")
        ? "text-[var(--color-err-fg)]"
        : "text-[var(--color-text-secondary)]";
  const headline =
    info.comparison === "match" || info.statusCode?.toLowerCase() === "ac"
      ? "Accepted"
      : info.comparison === "mismatch"
        ? "Wrong Answer"
        : info.statusCode && info.statusCode !== "neutral" && info.statusCode !== "pending"
          ? info.statusCode.toUpperCase()
          : isRunning
            ? "Running…"
            : "Waiting";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={"text-[15px] font-semibold " + toneText}>{headline}</span>
        {info.runtimeMs != null ? (
          <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">{info.runtimeMs} ms</span>
        ) : null}
        {info.run?.submission ? (
          <Link
            to={`/submissions/${info.run.submission.id}`}
            className="ml-auto text-[11px] inline-flex items-center gap-1 text-[var(--color-info-fg)] hover:underline"
          >
            Full detail <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {cases.map((c, i) => {
          const caseInfo = resolveCaseResult(c, workspace, runs);
          return (
            <div
              key={c.kind === "sample" ? c.sampleId : c.customId}
              className="group relative"
            >
              <button
                type="button"
                onClick={() => setSelectedIdx(i)}
                className={
                  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 h-7 text-[12px] font-medium transition-colors hairline " +
                  (c.kind === "custom" ? "pr-8 " : "") +
                  (i === idx
                    ? "bg-[var(--color-bg-muted)] text-[var(--color-text-primary)]"
                    : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
                }
              >
                <StatusDot code={caseInfo.statusCode ?? "neutral"} />
                Case {c.ordinal}
              </button>
              {c.kind === "custom" ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeCustom(c.customId);
                  }}
                  title="Remove this custom testcase"
                  className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-err-fg)] group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-eyebrow">Input</div>
          <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12.5px] font-mono text-[var(--color-text-primary)] whitespace-pre-wrap overflow-auto m-0">
            {selectedInput || "No input."}
          </pre>
        </div>
        <div className="space-y-1.5">
          <div className="text-eyebrow">Output</div>
          <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12.5px] font-mono text-[var(--color-text-primary)] whitespace-pre-wrap overflow-auto m-0">
            {info.actualOutput ?? (isRunning ? "Waiting for output…" : "No output captured.")}
          </pre>
        </div>
        {selectedExpected.trim() || selected.kind === "sample" ? (
          <div className="space-y-1.5">
            <div className="text-eyebrow flex items-center gap-2">
              Expected
              {selected.kind === "custom" && info.comparison ? (
                <span
                  className={
                    "text-[10px] uppercase tracking-wider font-semibold " +
                    (info.comparison === "match"
                      ? "text-[var(--color-ok-fg)]"
                      : info.comparison === "mismatch"
                        ? "text-[var(--color-err-fg)]"
                        : "text-[var(--color-text-tertiary)]")
                  }
                >
                  · {info.comparison === "match" ? "match" : info.comparison === "mismatch" ? "mismatch" : "pending"}
                </span>
              ) : null}
            </div>
            <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12.5px] font-mono text-[var(--color-text-primary)] whitespace-pre-wrap overflow-auto m-0">
              {selectedExpected || "No expected output set."}
            </pre>
          </div>
        ) : null}
        {info.message ? (
          <div className="space-y-1.5">
            <div className="text-eyebrow">Message</div>
            <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-words m-0">
              {info.message}
            </pre>
          </div>
        ) : null}
        {info.checkerMessage ? (
          <div className="space-y-1.5">
            <div className="text-eyebrow">Checker</div>
            <pre className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] hairline p-3 text-[12px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-words m-0">
              {info.checkerMessage}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function statusTone(code: string): "ok" | "err" | "warn" | "neutral" {
  const normalized = code.toLowerCase();
  if (normalized === "ac") return "ok";
  if (normalized === "neutral") return "neutral";
  if (normalized.startsWith("wa") || normalized === "re" || normalized === "ie") return "err";
  if (normalized === "tle" || normalized === "mle" || normalized === "ce") return "warn";
  return "neutral";
}

function StatusDot({ code }: { code: string }) {
  const tone = statusTone(code);
  const color =
    tone === "ok"
      ? "var(--color-ok-fg)"
      : tone === "err"
        ? "var(--color-err-fg)"
        : tone === "warn"
          ? "var(--color-warn-fg)"
          : "var(--color-text-tertiary)";
  return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />;
}

function PreviewBlock({
  label,
  value,
  empty,
}: {
  label: string;
  value?: string | null;
  empty: string;
}) {
  return (
    <div>
      <div className="text-eyebrow mb-1">{label}</div>
      <pre className="min-h-32 text-[11.5px] whitespace-pre-wrap bg-[var(--color-bg-muted)] hairline rounded-[var(--radius-md)] p-3 overflow-auto">
        {value ?? empty}
      </pre>
    </div>
  );
}

function TestcaseResultCard({
  result,
  title,
}: {
  result: SubmissionResult;
  title?: string;
}) {
  const tone = statusTone(result.status_code);
  const toneClass =
    tone === "ok"
      ? "text-[var(--color-ok-fg)]"
      : tone === "err"
        ? "text-[var(--color-err-fg)]"
        : tone === "warn"
          ? "text-[var(--color-warn-fg)]"
          : "text-[var(--color-text-secondary)]";
  return (
    <div className="rounded-[var(--radius-md)] hairline bg-[var(--color-bg-muted)] p-3 space-y-3">
      {title ? <div className="text-eyebrow">{title}</div> : null}
      <div className="flex items-center gap-3 flex-wrap text-[12px]">
        <span className={"font-semibold " + toneClass}>{result.status_code.toUpperCase()}</span>
        {result.runtime_ms != null ? (
          <span className="text-[var(--color-text-tertiary)] tabular-nums">{result.runtime_ms} ms</span>
        ) : null}
        {result.memory_kb != null ? (
          <span className="text-[var(--color-text-tertiary)] tabular-nums">
            {Math.round(result.memory_kb / 1024)} MB
          </span>
        ) : null}
        {result.testcase_ordinal != null ? (
          <span className="text-[var(--color-text-tertiary)]">Case #{result.testcase_ordinal}</span>
        ) : null}
      </div>
      {result.message ? (
        <div>
          <div className="text-eyebrow mb-1">Message</div>
          <pre className="whitespace-pre-wrap break-words text-[12px] text-[var(--color-text-secondary)] font-mono m-0">
            {result.message}
          </pre>
        </div>
      ) : null}
      {result.checker_message ? (
        <div>
          <div className="text-eyebrow mb-1">Checker</div>
          <pre className="whitespace-pre-wrap break-words text-[12px] text-[var(--color-text-secondary)] font-mono m-0">
            {result.checker_message}
          </pre>
        </div>
      ) : null}
      {result.actual_output_preview ? (
        <PreviewBlock label="Output" value={result.actual_output_preview} empty="No output was captured." />
      ) : null}
      {!result.message && !result.checker_message && !result.actual_output_preview ? (
        <p className="text-[11.5px] text-[var(--color-text-tertiary)]">No additional output.</p>
      ) : null}
    </div>
  );
}

function RecentList({
  recent,
  onOpen,
  onReuse,
}: {
  recent: SubmissionDetail[];
  onOpen: (id: string) => void;
  onReuse: (id: string) => void;
}) {
  if (recent.length === 0) {
    return <EmptyState title="No submissions yet" description="Your submissions for this problem will appear here." />;
  }
  return (
    <ul className="space-y-1.5">
      {recent.map((submission) => (
        <li
          key={submission.id}
          className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] hairline px-3 py-2 text-[12.5px] bg-[var(--color-bg-base)]"
        >
          <button onClick={() => onOpen(submission.id)} className="inline-flex items-center gap-2 hover:underline">
            <VerdictChip verdict={submission.verdict} status={submission.status} />
            <span className="text-[12px] text-[var(--color-text-secondary)]">{submission.runtime_name}</span>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">{formatDate(submission.created_at)}</span>
          </button>
          <div className="flex items-center gap-2">
            <Link
              to={`/submissions/${submission.id}`}
              className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline-offset-2 hover:underline"
            >
              Detail
            </Link>
            <button
              onClick={() => onReuse(submission.id)}
              className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              Reuse
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
