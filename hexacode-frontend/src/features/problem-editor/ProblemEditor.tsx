import { useEffect, useMemo, useState } from "react";
import { Link, unstable_usePrompt, useBeforeUnload } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Upload, X, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Editor from "@monaco-editor/react";
import { MarkdownPreview } from "@/components/ui/MarkdownPreview";
import {
  getRuntimes,
  getTags,
  type ProblemAsset,
  type ProblemChecker,
  type ProblemTestset,
  type StorageObject,
  type UploadProgress,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field, Input, Select, Textarea, Label } from "@/components/ui/Input";
import { Skeleton, Banner } from "@/components/ui/Feedback";
import { formatBytes, slugify } from "@/lib/utils";

const DEFAULT_STATEMENT = `# Problem statement

Describe the task clearly.

## Input

Describe the input format.

## Output

Describe the expected output.

## Constraints

- Time limit:
- Memory limit:

## Sample

### Input

### Output
`;

const DRAFT_VERSION = 1;

export type ProblemEditorInitialData = {
  id?: string;
  slug: string;
  title: string;
  summaryMd: string;
  statementSource: string;
  statementMd: string;
  statementObject?: StorageObject | null;
  difficultyCode: string;
  typeCode: string;
  visibilityCode: string;
  scoringCode: string;
  statusCode: string;
  timeLimitMs: string;
  memoryLimitKb: string;
  outputLimitKb: string;
  tagSlugs: string[];
  statementAssets: ProblemAsset[];
  testsets: ProblemTestset[];
  activeChecker?: ProblemChecker | null;
};

export type ProblemSubmitIntent = "save_draft" | "request_review" | "save_changes";

type Props = {
  mode: "create" | "edit";
  initialData: ProblemEditorInitialData;
  accessToken: string | null;
  loginRedirectPath: string;
  onSubmit: (
    form: FormData,
    slug: string,
    intent: ProblemSubmitIntent,
    opts: { onUploadProgress: (p: UploadProgress) => void },
  ) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
};

type StatementMode = "inline" | "markdown_file" | "pdf_file";

export function buildEditorInitial(input?: Partial<ProblemEditorInitialData>): ProblemEditorInitialData {
  return {
    slug: "",
    title: "",
    summaryMd: "",
    statementSource: "inline_md",
    statementMd: DEFAULT_STATEMENT,
    statementObject: null,
    difficultyCode: "easy",
    typeCode: "traditional",
    visibilityCode: "private",
    scoringCode: "icpc",
    statusCode: "draft",
    timeLimitMs: "1000",
    memoryLimitKb: "262144",
    outputLimitKb: "65536",
    tagSlugs: [],
    statementAssets: [],
    testsets: [],
    activeChecker: {
      id: "",
      checker_type_code: "diff",
      runtime_profile_key: null,
      entrypoint: null,
      note: null,
      source_object: null,
      compiled_object: null,
    },
    ...input,
  };
}

function modeFromSource(source: string): StatementMode {
  if (source === "object_pdf") return "pdf_file";
  if (source === "object_md") return "markdown_file";
  return "inline";
}

function isPositiveInt(v: string) {
  if (!v.trim()) return true;
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

function draftKey(mode: "create" | "edit", init: ProblemEditorInitialData) {
  return `hexacode.problem-editor:${mode}:${init.id ?? "new"}`;
}

type Draft = {
  slug: string;
  title: string;
  summaryMd: string;
  statementMode: StatementMode;
  statementMd: string;
  replaceStatementAssets: boolean;
  difficultyCode: string;
  scoringCode: string;
  timeLimitMs: string;
  memoryLimitKb: string;
  outputLimitKb: string;
  selectedTags: string[];
  testsetTypeCode: string;
  testsetTitle: string;
  testsetNote: string;
  checkerTypeCode: string;
  checkerRuntimeProfileKey: string;
  checkerEntrypoint: string;
  checkerNote: string;
};

function draftFromInitial(init: ProblemEditorInitialData): Draft {
  return {
    slug: init.slug,
    title: init.title,
    summaryMd: init.summaryMd,
    statementMode: modeFromSource(init.statementSource),
    statementMd: init.statementMd || DEFAULT_STATEMENT,
    replaceStatementAssets: false,
    difficultyCode: init.difficultyCode,
    scoringCode: init.scoringCode,
    timeLimitMs: init.timeLimitMs,
    memoryLimitKb: init.memoryLimitKb,
    outputLimitKb: init.outputLimitKb,
    selectedTags: [...init.tagSlugs],
    testsetTypeCode: init.testsets[0]?.testset_type_code ?? "primary",
    testsetTitle: init.testsets[0]?.title ?? "Primary testset",
    testsetNote: init.testsets[0]?.note ?? "",
    checkerTypeCode: init.activeChecker?.checker_type_code ?? "diff",
    checkerRuntimeProfileKey: init.activeChecker?.runtime_profile_key ?? "",
    checkerEntrypoint: init.activeChecker?.entrypoint ?? "checker.cpp",
    checkerNote: init.activeChecker?.note ?? "",
  };
}

function validateField(field: string, value: string): string | null {
  switch (field) {
    case "slug":
      if (!value.trim()) return "Slug is required.";
      if (value.length > 128) return "Slug must be ≤128 characters.";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return "Only lowercase letters, numbers, and hyphens.";
      return null;
    case "title":
      if (!value.trim()) return "Title is required.";
      if (value.length > 256) return "Title must be ≤256 characters.";
      return null;
    case "timeLimitMs": {
      const n = Number(value);
      if (!value.trim() || !Number.isInteger(n) || n <= 0) return "Must be a positive integer.";
      if (n > 30000) return "Max 30000 ms.";
      return null;
    }
    case "memoryLimitKb": {
      const n = Number(value);
      if (!value.trim() || !Number.isInteger(n) || n <= 0) return "Must be a positive integer.";
      if (n > 1048576) return "Max 1048576 KB.";
      return null;
    }
    case "outputLimitKb": {
      const n = Number(value);
      if (!value.trim() || !Number.isInteger(n) || n <= 0) return "Must be a positive integer.";
      if (n > 262144) return "Max 262144 KB.";
      return null;
    }
    default:
      return null;
  }
}


export function ProblemEditor({
  mode,
  initialData,
  accessToken,
  loginRedirectPath,
  onSubmit,
  submitLabel,
  submittingLabel,
}: Props) {
  const initial = useMemo(() => draftFromInitial(initialData), [initialData]);
  const storageKey = useMemo(() => draftKey(mode, initialData), [initialData, mode]);

  const [draft, setDraft] = useState<Draft>(initial);
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [statementAssets, setStatementAssets] = useState<File[]>([]);
  const [checkerSource, setCheckerSource] = useState<File | null>(null);
  const [intent, setIntent] = useState<ProblemSubmitIntent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [recovered, setRecovered] = useState<{ draft: Draft; savedAt: string } | null>(null);
  const [editorMode, setEditorMode] = useState<"edit" | "preview" | "split">("split");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkerExpanded, setCheckerExpanded] = useState(initial.checkerTypeCode === "custom");
  const [tagFilter, setTagFilter] = useState("");

  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: getTags });
  const runtimesQ = useQuery({ queryKey: ["runtimes"], queryFn: getRuntimes });

  const initialStatementMode = modeFromSource(initialData.statementSource);
  const canReuseStatement = !!initialData.statementObject && draft.statementMode === initialStatementMode;
  const canReuseChecker =
    draft.checkerTypeCode === "custom" &&
    initialData.activeChecker?.checker_type_code === "custom" &&
    !!initialData.activeChecker?.source_object;

  const baseStr = JSON.stringify(initial);
  const curStr = JSON.stringify(draft);
  const hasFiles = !!(statementFile || statementAssets.length || checkerSource);
  const dirty = curStr !== baseStr || hasFiles;
  const busy = intent !== null;

  // Completeness checks
  const basicInfoReady = !!draft.slug.trim() && !!draft.title.trim();
  const statementReady =
    (draft.statementMd !== DEFAULT_STATEMENT && draft.statementMd.length > 50) || !!statementFile;
  const testsetReady = initialData.testsets.length > 0;
  const checkerReady = !!draft.checkerTypeCode;
  const canSubmitForReview = basicInfoReady && statementReady;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.version === DRAFT_VERSION && parsed.draft && parsed.savedAt) {
        if (JSON.stringify(parsed.draft) !== baseStr) {
          setRecovered({ draft: parsed.draft, savedAt: parsed.savedAt });
        }
      }
    } catch { /* ignore */ }
  }, [storageKey, baseStr]);

  useEffect(() => {
    if (!dirty) {
      localStorage.removeItem(storageKey);
      return;
    }
    const t = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      localStorage.setItem(storageKey, JSON.stringify({ draft, savedAt, version: DRAFT_VERSION }));
      setAutosavedAt(savedAt);
    }, 800);
    return () => window.clearTimeout(t);
  }, [draft, dirty, storageKey]);

  unstable_usePrompt({
    when: dirty && !busy,
    message: "You have unsaved problem authoring changes. Leave this page?",
  });
  useBeforeUnload((e: BeforeUnloadEvent) => {
    if (!dirty || busy) return;
    e.preventDefault();
    e.returnValue = "";
  });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((prev) => { const n = { ...prev }; delete n[k]; return n; });
  };

  const handleBlur = (field: string, value: string) => {
    const e = validateField(field, value);
    if (e) setErrors((prev) => ({ ...prev, [field]: e }));
    else setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  };

  function validate(): string | null {
    const s = draft.slug.trim().toLowerCase();
    if (!s || !draft.title.trim()) return "Slug and title are required.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s))
      return "Slug may only contain lowercase letters, numbers, and hyphens.";
    if (draft.statementMode === "inline" && !draft.statementMd.trim())
      return "Inline statement markdown is required.";
    if (draft.statementMode !== "inline" && !statementFile && !canReuseStatement)
      return "Select a statement file before submitting.";
    if (!isPositiveInt(draft.timeLimitMs) || !isPositiveInt(draft.memoryLimitKb) || !isPositiveInt(draft.outputLimitKb))
      return "Time, memory, and output limits must be positive integers.";
    if (draft.checkerTypeCode === "custom" && !draft.checkerRuntimeProfileKey)
      return "Choose a runtime profile for the custom checker.";
    if (draft.checkerTypeCode === "custom" && !checkerSource && !canReuseChecker)
      return "Upload the custom checker source file.";
    return null;
  }

  async function handleSubmit(submitIntent: ProblemSubmitIntent) {
    setErr(null);
    if (!accessToken) { setErr("Sign in before saving."); return; }
    const v = validate();
    if (v) { setErr(v); return; }

    let resolvedStatus: string;
    let resolvedVisibility: string;
    if (submitIntent === "save_draft") {
      resolvedStatus = "draft";
      resolvedVisibility = "private";
    } else if (submitIntent === "request_review") {
      resolvedStatus = "pending_review";
      resolvedVisibility = "private";
    } else {
      resolvedStatus = initialData.statusCode;
      resolvedVisibility = initialData.visibilityCode;
    }

    const s = draft.slug.trim().toLowerCase();
    const fd = new FormData();
    fd.append("slug", s);
    fd.append("title", draft.title.trim());
    fd.append("summary_md", draft.summaryMd);
    fd.append("difficulty_code", draft.difficultyCode);
    fd.append("type_code", "traditional");
    fd.append("visibility_code", resolvedVisibility);
    fd.append("scoring_code", draft.scoringCode);
    fd.append("status_code", resolvedStatus);
    fd.append("time_limit_ms", draft.timeLimitMs.trim());
    fd.append("memory_limit_kb", draft.memoryLimitKb.trim());
    fd.append("output_limit_kb", draft.outputLimitKb.trim());
    if (draft.statementMode === "inline") {
      fd.append("statement_md", draft.statementMd);
    } else if (statementFile) {
      fd.append("statement_file", statementFile);
    }
    if (mode === "edit" && draft.replaceStatementAssets) {
      fd.append("replace_statement_assets", "true");
    }
    draft.selectedTags.forEach((t) => fd.append("tag_slugs", t));
    statementAssets.forEach((f) => fd.append("statement_assets", f));
    fd.append("checker_type_code", draft.checkerTypeCode);
    fd.append("checker_note", draft.checkerNote);
    if (draft.checkerTypeCode === "custom") {
      fd.append("checker_runtime_profile_key", draft.checkerRuntimeProfileKey);
      fd.append("checker_entrypoint", draft.checkerEntrypoint.trim());
      if (checkerSource) fd.append("checker_source", checkerSource);
    }

    try {
      setIntent(submitIntent);
      setProgress(null);
      await onSubmit(fd, s, submitIntent, { onUploadProgress: (p) => setProgress(p) });
      localStorage.removeItem(storageKey);
      setAutosavedAt(null);
      toast.success(mode === "create" ? "Problem created" : "Problem saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIntent(null);
    }
  }

  const runtimes = runtimesQ.data ?? [];
  const tags = tagsQ.data ?? [];

  const draftButtonLabel = mode === "edit" && initialData.statusCode !== "draft" && initialData.statusCode !== "rejected"
    ? "Save changes" : "Save draft";
  const draftIntent: ProblemSubmitIntent = mode === "edit" && initialData.statusCode !== "draft" && initialData.statusCode !== "rejected"
    ? "save_changes" : "save_draft";


  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      {/* Main column */}
      <div className="space-y-5">
        {/* Recovery banner */}
        {recovered && (
          <Banner tone="info">
            <span className="text-[13px]">
              Recovered draft from {new Date(recovered.savedAt).toLocaleString()}.{" "}
              <button className="underline" onClick={() => { setDraft(recovered.draft); setRecovered(null); }}>
                Restore
              </button>{" "}
              or{" "}
              <button className="underline" onClick={() => { setRecovered(null); localStorage.removeItem(storageKey); }}>
                Discard
              </button>
            </span>
          </Banner>
        )}

        {/* Error banner */}
        {err && <Banner tone="err">{err}</Banner>}

        {/* Basic info */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-4">Basic info</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Slug" id="slug" error={errors.slug}>
              <Input
                id="slug"
                value={draft.slug}
                onChange={(e) => set("slug", slugify(e.target.value))}
                onBlur={() => handleBlur("slug", draft.slug)}
                placeholder="my-problem"
                className={errors.slug ? "border-[var(--color-err-fg)]" : ""}
              />
            </Field>
            <Field label="Title" id="title" error={errors.title}>
              <Input
                id="title"
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                onBlur={() => handleBlur("title", draft.title)}
                placeholder="Problem title"
                className={errors.title ? "border-[var(--color-err-fg)]" : ""}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Summary" id="summary">
              <Textarea
                id="summary"
                value={draft.summaryMd}
                onChange={(e) => set("summaryMd", e.target.value)}
                placeholder="Short summary (optional)"
                rows={2}
              />
            </Field>
          </div>
        </Card>

        {/* Metadata grid — only Difficulty and Scoring */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-4">Metadata</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Difficulty" id="difficulty">
              <Select id="difficulty" value={draft.difficultyCode} onChange={(e) => set("difficultyCode", e.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
            <Field label="Scoring" id="scoring">
              <Select id="scoring" value={draft.scoringCode} onChange={(e) => set("scoringCode", e.target.value)}>
                <option value="icpc">ICPC</option>
                <option value="ioi">IOI</option>
              </Select>
            </Field>
          </div>
        </Card>

        {/* Limits */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-4">Limits</h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Time (ms)" id="timeLimitMs" error={errors.timeLimitMs}>
              <Input
                id="timeLimitMs"
                type="number"
                value={draft.timeLimitMs}
                onChange={(e) => set("timeLimitMs", e.target.value)}
                onBlur={() => handleBlur("timeLimitMs", draft.timeLimitMs)}
                className={errors.timeLimitMs ? "border-[var(--color-err-fg)]" : ""}
              />
            </Field>
            <Field label="Memory (KB)" id="memoryLimitKb" error={errors.memoryLimitKb}>
              <Input
                id="memoryLimitKb"
                type="number"
                value={draft.memoryLimitKb}
                onChange={(e) => set("memoryLimitKb", e.target.value)}
                onBlur={() => handleBlur("memoryLimitKb", draft.memoryLimitKb)}
                className={errors.memoryLimitKb ? "border-[var(--color-err-fg)]" : ""}
              />
            </Field>
            <Field label="Output (KB)" id="outputLimitKb" error={errors.outputLimitKb}>
              <Input
                id="outputLimitKb"
                type="number"
                value={draft.outputLimitKb}
                onChange={(e) => set("outputLimitKb", e.target.value)}
                onBlur={() => handleBlur("outputLimitKb", draft.outputLimitKb)}
                className={errors.outputLimitKb ? "border-[var(--color-err-fg)]" : ""}
              />
            </Field>
          </div>
        </Card>

        {/* Statement */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-4">Statement</h3>
          {/* Statement mode selector */}
          <div className="flex gap-2 mb-3">
            {(["inline", "markdown_file", "pdf_file"] as StatementMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`px-3 py-1.5 text-[12px] rounded-[var(--radius-md)] ${draft.statementMode === m ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-bg-muted)] text-[var(--color-text-secondary)]"}`}
                onClick={() => set("statementMode", m)}
              >
                {m === "inline" ? "Inline MD" : m === "markdown_file" ? "MD File" : "PDF File"}
              </button>
            ))}
          </div>

          {draft.statementMode === "inline" && (
            <>
              {/* Editor mode tabs */}
              <div className="flex gap-1 mb-2">
                {(["edit", "preview", "split"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`px-3 py-1 text-[12px] rounded-[var(--radius-md)] capitalize ${editorMode === m ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-bg-muted)] text-[var(--color-text-secondary)]"}`}
                    onClick={() => setEditorMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="min-h-[400px] hairline rounded-[var(--radius-md)] overflow-hidden">
                {editorMode === "edit" && (
                  <Editor
                    height="400px"
                    language="markdown"
                    value={draft.statementMd}
                    onChange={(v) => set("statementMd", v ?? "")}
                    options={{ minimap: { enabled: false }, wordWrap: "on", lineNumbers: "off", fontSize: 13, scrollBeyondLastLine: false }}
                  />
                )}
                {editorMode === "preview" && (
                  <div className="p-4 h-[400px] overflow-auto">
                    <MarkdownPreview content={draft.statementMd} />
                  </div>
                )}
                {editorMode === "split" && (
                  <PanelGroup direction="horizontal">
                    <Panel defaultSize={50} minSize={30}>
                      <Editor
                        height="400px"
                        language="markdown"
                        value={draft.statementMd}
                        onChange={(v) => set("statementMd", v ?? "")}
                        options={{ minimap: { enabled: false }, wordWrap: "on", lineNumbers: "off", fontSize: 13, scrollBeyondLastLine: false }}
                      />
                    </Panel>
                    <PanelResizeHandle className="w-1.5 bg-[var(--color-border-hair)] hover:bg-[var(--color-accent)] transition-colors" />
                    <Panel defaultSize={50} minSize={30}>
                      <div className="p-4 h-[400px] overflow-auto">
                        <MarkdownPreview content={draft.statementMd} />
                      </div>
                    </Panel>
                  </PanelGroup>
                )}
              </div>
            </>
          )}

          {draft.statementMode !== "inline" && (
            <div className="space-y-3">
              {canReuseStatement && initialData.statementObject && (
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  Current: {initialData.statementObject.original_filename ?? "uploaded file"}
                </p>
              )}
              <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[var(--color-accent)]">
                <Upload size={14} />
                {statementFile ? statementFile.name : "Choose file"}
                <input
                  type="file"
                  className="hidden"
                  accept={draft.statementMode === "pdf_file" ? ".pdf" : ".md"}
                  onChange={(e) => setStatementFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          )}

          {/* Statement assets */}
          {draft.statementMode === "inline" && (
            <div className="mt-4">
              <Label>Statement assets (images)</Label>
              {mode === "edit" && initialData.statementAssets.length > 0 && (
                <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)] mb-2">
                  <input
                    type="checkbox"
                    checked={draft.replaceStatementAssets}
                    onChange={(e) => set("replaceStatementAssets", e.target.checked)}
                  />
                  Replace existing assets
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[var(--color-accent)]">
                <Upload size={14} />
                Add images
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={(e) => setStatementAssets(Array.from(e.target.files ?? []))}
                />
              </label>
              {statementAssets.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {statementAssets.map((f, i) => (
                    <Chip key={i} tone="neutral">
                      {f.name} ({formatBytes(f.size)})
                      <button type="button" onClick={() => setStatementAssets((a) => a.filter((_, j) => j !== i))}>
                        <X size={12} />
                      </button>
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Tags — chip selector */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-4">Tags</h3>
          {/* Selected tags as removable chips */}
          {draft.selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {draft.selectedTags.map((slug) => {
                const tag = tags.find((t) => t.slug === slug);
                return (
                  <Chip key={slug} tone="accent">
                    {tag?.name ?? slug}
                    <button type="button" onClick={() => set("selectedTags", draft.selectedTags.filter((s) => s !== slug))}>
                      <X size={12} />
                    </button>
                  </Chip>
                );
              })}
            </div>
          )}
          {/* Filter input */}
          <Input
            placeholder="Filter tags…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="mb-3 h-8 text-[12px]"
          />
          {/* Available tag buttons */}
          {tagsQ.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags
                .filter((t) => t.name.toLowerCase().includes(tagFilter.toLowerCase()))
                .map((t) => {
                  const selected = draft.selectedTags.includes(t.slug);
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      className={`px-2.5 py-1 text-[11.5px] rounded-[var(--radius-pill)] transition-colors ${selected ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-bg-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)]"}`}
                      onClick={() =>
                        set(
                          "selectedTags",
                          selected
                            ? draft.selectedTags.filter((s) => s !== t.slug)
                            : [...draft.selectedTags, t.slug],
                        )
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
            </div>
          )}
        </Card>

        {/* Testset — read-only status */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-4">Testset</h3>
          {mode === "create" ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Upload testsets after creating the problem.</p>
          ) : testsetReady ? (
            <div className="space-y-2">
              <p className="text-[13px] text-[var(--color-text-primary)]">
                {initialData.testsets.length} testset{initialData.testsets.length > 1 ? "s" : ""} configured
              </p>
              <Link
                to={`/dashboard/problems/${initialData.id}/testsets`}
                className="text-[13px] text-[var(--color-accent)] underline"
              >
                Manage testsets →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[13px] text-[var(--color-text-secondary)]">No testset uploaded.</p>
              <Link
                to={`/dashboard/problems/${initialData.id}/testsets`}
                className="text-[13px] text-[var(--color-accent)] underline"
              >
                Upload testsets →
              </Link>
            </div>
          )}
        </Card>

        {/* Checker — collapsible */}
        <Card>
          {!checkerExpanded && draft.checkerTypeCode === "diff" ? (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--color-text-primary)]">Checker: diff (default)</span>
              <button
                type="button"
                className="text-[12px] text-[var(--color-accent)]"
                onClick={() => setCheckerExpanded(true)}
              >
                Configure
              </button>
            </div>
          ) : (
            <>
              <h3 className="text-[14px] font-semibold mb-4">Checker</h3>
              <div className="space-y-4">
                <Field label="Checker type" id="checkerType">
                  <Select
                    id="checkerType"
                    value={draft.checkerTypeCode}
                    onChange={(e) => {
                      set("checkerTypeCode", e.target.value);
                      if (e.target.value === "custom") setCheckerExpanded(true);
                    }}
                  >
                    <option value="diff">diff</option>
                    <option value="custom">custom</option>
                  </Select>
                </Field>
                {draft.checkerTypeCode === "custom" && (
                  <>
                    <Field label="Runtime profile" id="checkerRuntime">
                      {runtimesQ.isLoading ? (
                        <Skeleton className="h-10 w-full" />
                      ) : (
                        <Select
                          id="checkerRuntime"
                          value={draft.checkerRuntimeProfileKey}
                          onChange={(e) => set("checkerRuntimeProfileKey", e.target.value)}
                        >
                          <option value="">Select runtime…</option>
                          {runtimes.map((r) => (
                            <option key={r.profile_key} value={r.profile_key}>
                              {r.runtime_name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Entrypoint" id="checkerEntrypoint">
                      <Input
                        id="checkerEntrypoint"
                        value={draft.checkerEntrypoint}
                        onChange={(e) => set("checkerEntrypoint", e.target.value)}
                      />
                    </Field>
                    <div>
                      <Label>Checker source</Label>
                      {canReuseChecker && initialData.activeChecker?.source_object && (
                        <p className="text-[12px] text-[var(--color-text-secondary)] mb-1">
                          Current: {initialData.activeChecker.source_object.original_filename ?? "uploaded"}
                        </p>
                      )}
                      <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[var(--color-accent)]">
                        <Upload size={14} />
                        {checkerSource ? checkerSource.name : "Choose file"}
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => setCheckerSource(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>
                  </>
                )}
                <Field label="Note" id="checkerNote">
                  <Input
                    id="checkerNote"
                    value={draft.checkerNote}
                    onChange={(e) => set("checkerNote", e.target.value)}
                    placeholder="Optional note"
                  />
                </Field>
              </div>
            </>
          )}
        </Card>

        {/* Submit buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy || !dirty}
            className="px-4 py-2 text-[13px] font-medium rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-sunken)] disabled:opacity-50"
            onClick={() => handleSubmit(draftIntent)}
          >
            {busy && intent === draftIntent ? submittingLabel : draftButtonLabel}
          </button>
          <button
            type="button"
            disabled={busy || !canSubmitForReview}
            className="px-4 py-2 text-[13px] font-medium rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
            onClick={() => handleSubmit("request_review")}
          >
            {busy && intent === "request_review" ? submittingLabel : "Submit for review"}
          </button>
          {autosavedAt && (
            <span className="text-[11px] text-[var(--color-text-tertiary)] ml-auto">
              Autosaved {new Date(autosavedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Upload progress */}
        {progress && (
          <div className="text-[12px] text-[var(--color-text-secondary)]">
            Uploading… {Math.round((progress.loaded / (progress.total || 1)) * 100)}%
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-5">
        {/* Readiness checklist */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-3">Readiness</h3>
          <ul className="space-y-2 text-[13px]">
            <li className="flex items-center gap-2">
              {basicInfoReady ? <CheckCircle2 size={16} className="text-[var(--color-ok-fg)]" /> : <Circle size={16} className="text-[var(--color-text-tertiary)]" />}
              Basic info
            </li>
            <li className="flex items-center gap-2">
              {statementReady ? <CheckCircle2 size={16} className="text-[var(--color-ok-fg)]" /> : <Circle size={16} className="text-[var(--color-text-tertiary)]" />}
              Statement
            </li>
            <li className="flex items-center gap-2">
              {testsetReady ? <CheckCircle2 size={16} className="text-[var(--color-ok-fg)]" /> : <Circle size={16} className="text-[var(--color-text-tertiary)]" />}
              Testset
            </li>
            <li className="flex items-center gap-2">
              {checkerReady ? <CheckCircle2 size={16} className="text-[var(--color-ok-fg)]" /> : <Circle size={16} className="text-[var(--color-text-tertiary)]" />}
              Checker
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
