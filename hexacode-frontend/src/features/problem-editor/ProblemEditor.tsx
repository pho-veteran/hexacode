import { useEffect, useMemo, useState } from "react";
import { Link, unstable_usePrompt, useBeforeUnload } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
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

export type ProblemSubmitIntent = "manual" | "save_draft" | "request_review";

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

function parseTags(v: string) {
  return v
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .filter((e, i, a) => a.indexOf(e) === i);
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
  typeCode: string;
  visibilityCode: string;
  scoringCode: string;
  statusCode: string;
  timeLimitMs: string;
  memoryLimitKb: string;
  outputLimitKb: string;
  tagInput: string;
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
    typeCode: init.typeCode,
    visibilityCode: init.visibilityCode,
    scoringCode: init.scoringCode,
    statusCode: init.statusCode,
    timeLimitMs: init.timeLimitMs,
    memoryLimitKb: init.memoryLimitKb,
    outputLimitKb: init.outputLimitKb,
    tagInput: init.tagSlugs.join(", "),
    testsetTypeCode: init.testsets[0]?.testset_type_code ?? "primary",
    testsetTitle: init.testsets[0]?.title ?? "Primary testset",
    testsetNote: init.testsets[0]?.note ?? "",
    checkerTypeCode: init.activeChecker?.checker_type_code ?? "diff",
    checkerRuntimeProfileKey: init.activeChecker?.runtime_profile_key ?? "",
    checkerEntrypoint: init.activeChecker?.entrypoint ?? "checker.cpp",
    checkerNote: init.activeChecker?.note ?? "",
  };
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
  const [testsetArchive, setTestsetArchive] = useState<File | null>(null);
  const [checkerSource, setCheckerSource] = useState<File | null>(null);
  const [intent, setIntent] = useState<ProblemSubmitIntent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [recovered, setRecovered] = useState<{ draft: Draft; savedAt: string } | null>(null);

  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: getTags });
  const runtimesQ = useQuery({ queryKey: ["runtimes"], queryFn: getRuntimes });

  const initialStatementMode = modeFromSource(initialData.statementSource);
  const canReuseStatement = !!initialData.statementObject && draft.statementMode === initialStatementMode;
  const canReuseChecker =
    draft.checkerTypeCode === "custom" &&
    initialData.activeChecker?.checker_type_code === "custom" &&
    !!initialData.activeChecker?.source_object;

  const selectedTags = useMemo(() => parseTags(draft.tagInput), [draft.tagInput]);

  const baseStr = JSON.stringify(initial);
  const curStr = JSON.stringify(draft);
  const hasFiles = !!(statementFile || statementAssets.length || testsetArchive || checkerSource);
  const dirty = curStr !== baseStr || hasFiles;
  const busy = intent !== null;

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
    } catch {}
  }, [storageKey, baseStr]);

  useEffect(() => {
    if (!dirty) {
      localStorage.removeItem(storageKey);
      return;
    }
    const t = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft, savedAt, version: DRAFT_VERSION }),
      );
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

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

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
    if (!accessToken) {
      setErr("Sign in before saving.");
      return;
    }
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    let resolvedStatus = draft.statusCode;
    let resolvedVisibility = draft.visibilityCode;
    if (submitIntent === "save_draft") {
      resolvedStatus = "draft";
      resolvedVisibility = "private";
    } else if (submitIntent === "request_review") {
      resolvedStatus = "pending_review";
      resolvedVisibility = "private";
    }

    if (
      mode === "edit" &&
      testsetArchive &&
      initialData.testsets.length &&
      !window.confirm("Uploading a new testset archive replaces the current active testsets. Continue?")
    )
      return;

    const s = draft.slug.trim().toLowerCase();
    const fd = new FormData();
    fd.append("slug", s);
    fd.append("title", draft.title.trim());
    fd.append("summary_md", draft.summaryMd);
    fd.append("difficulty_code", draft.difficultyCode);
    fd.append("type_code", draft.typeCode);
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
    selectedTags.forEach((t) => fd.append("tag_slugs", t));
    statementAssets.forEach((f) => fd.append("statement_assets", f));
    if (testsetArchive) {
      fd.append("testset_type_code", draft.testsetTypeCode);
      fd.append("testset_title", draft.testsetTitle.trim());
      fd.append("testset_note", draft.testsetNote);
      fd.append("testset_archive", testsetArchive);
    }
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
      await onSubmit(fd, s, submitIntent, {
        onUploadProgress: (p) => setProgress(p),
      });
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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit("manual");
        }}
      >
        {recovered ? (
          <Banner tone="warn" title="Autosaved draft found">
            <p className="text-[12.5px]">
              A local draft from {new Date(recovered.savedAt).toLocaleString()} is available. Restoring overwrites the loaded values. Selected files are not preserved.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(recovered.draft);
                  setRecovered(null);
                }}
                className="rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(storageKey);
                  setRecovered(null);
                }}
                className="rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
              >
                Discard
              </button>
            </div>
          </Banner>
        ) : null}

        <Card>
          <SectionHead eyebrow="Metadata" title="Basic info" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Slug">
              <Input
                value={draft.slug}
                onChange={(e) => set("slug", e.target.value)}
                onBlur={(e) => set("slug", slugify(e.target.value))}
                placeholder="two-pointers-lab"
                required
              />
            </Field>
            <Field label="Title">
              <Input
                value={draft.title}
                onChange={(e) => {
                  set("title", e.target.value);
                  if (!draft.slug) set("slug", slugify(e.target.value));
                }}
                required
              />
            </Field>
          </div>
          <Field label="Summary" hint="Shown on problem cards.">
            <Textarea value={draft.summaryMd} onChange={(e) => set("summaryMd", e.target.value)} rows={3} />
          </Field>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label="Difficulty">
              <Select value={draft.difficultyCode} onChange={(e) => set("difficultyCode", e.target.value)}>
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </Select>
            </Field>
            <Field label="Type">
              <Select value={draft.typeCode} onChange={(e) => set("typeCode", e.target.value)}>
                <option value="traditional">traditional</option>
              </Select>
            </Field>
            <Field label="Visibility">
              <Select value={draft.visibilityCode} onChange={(e) => set("visibilityCode", e.target.value)}>
                <option value="private">private</option>
                <option value="public">public</option>
              </Select>
            </Field>
            <Field label="Scoring">
              <Select value={draft.scoringCode} onChange={(e) => set("scoringCode", e.target.value)}>
                <option value="icpc">icpc</option>
                <option value="ioi">ioi</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={draft.statusCode} onChange={(e) => set("statusCode", e.target.value)}>
                <option value="draft">draft</option>
                <option value="pending_review">pending_review</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <SectionHead
            eyebrow="Statement"
            title="Inline markdown or stored asset"
            description="Markdown can live inline in Postgres, or as a stored Markdown/PDF asset."
          />
          <Field label="Statement mode">
            <Select
              value={draft.statementMode}
              onChange={(e) => set("statementMode", e.target.value as StatementMode)}
            >
              <option value="inline">Inline markdown</option>
              <option value="markdown_file">Markdown file upload</option>
              <option value="pdf_file">PDF upload</option>
            </Select>
          </Field>
          {draft.statementMode === "inline" ? (
            <Field label="Statement markdown">
              <Textarea
                value={draft.statementMd}
                onChange={(e) => set("statementMd", e.target.value)}
                rows={18}
                className="font-mono text-[12.5px]"
              />
            </Field>
          ) : (
            <Field label={draft.statementMode === "pdf_file" ? "Statement PDF" : "Statement markdown file"} hint="Up to 2 MB.">
              <input
                type="file"
                accept={draft.statementMode === "pdf_file" ? ".pdf,application/pdf" : ".md,.markdown,text/markdown,text/plain"}
                onChange={(e) => setStatementFile(e.target.files?.[0] ?? null)}
                className="text-[13px]"
              />
              {statementFile ? (
                <FilePill name={statementFile.name} size={statementFile.size} onRemove={() => setStatementFile(null)} />
              ) : canReuseStatement && initialData.statementObject ? (
                <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                  Current: {initialData.statementObject.original_filename ?? initialData.statementObject.object_key}
                </div>
              ) : null}
            </Field>
          )}
          <Field label="Statement attachments" hint="Figures, PDFs, or assets referenced in the statement.">
            <input
              type="file"
              multiple
              onChange={(e) => setStatementAssets(Array.from(e.target.files ?? []))}
              className="text-[13px]"
            />
            {statementAssets.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {statementAssets.map((f, i) => (
                  <FilePill
                    key={i}
                    name={f.name}
                    size={f.size}
                    onRemove={() =>
                      setStatementAssets((arr) => arr.filter((_, idx) => idx !== i))
                    }
                  />
                ))}
              </div>
            ) : null}
            {mode === "edit" && initialData.statementAssets.length ? (
              <div className="mt-2 space-y-1">
                <div className="flex flex-wrap gap-1">
                  {initialData.statementAssets.map((a) => (
                    <Chip key={a.id} tone="neutral">
                      {a.object.original_filename ?? a.logical_name ?? a.object.object_key}
                    </Chip>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={draft.replaceStatementAssets}
                    onChange={(e) => set("replaceStatementAssets", e.target.checked)}
                  />
                  Replace existing assets with uploaded batch
                </label>
              </div>
            ) : null}
          </Field>
        </Card>

        <Card>
          <SectionHead eyebrow="Limits" title="Runtime envelope" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Time limit (ms)">
              <Input inputMode="numeric" value={draft.timeLimitMs} onChange={(e) => set("timeLimitMs", e.target.value)} />
            </Field>
            <Field label="Memory limit (KB)">
              <Input inputMode="numeric" value={draft.memoryLimitKb} onChange={(e) => set("memoryLimitKb", e.target.value)} />
            </Field>
            <Field label="Output limit (KB)">
              <Input inputMode="numeric" value={draft.outputLimitKb} onChange={(e) => set("outputLimitKb", e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <SectionHead eyebrow="Tags" title="Classification" />
          <Field label="Tag slugs" hint="Comma-separated list of tag slugs.">
            <Input
              value={draft.tagInput}
              onChange={(e) => set("tagInput", e.target.value)}
              placeholder="arrays, graphs"
            />
          </Field>
          {tagsQ.isLoading ? (
            <Skeleton className="h-8" />
          ) : tags.length ? (
            <div>
              <Label>Available</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.map((t) => {
                  const active = selectedTags.includes(t.slug);
                  return (
                    <button
                      type="button"
                      key={t.slug}
                      onClick={() => {
                        const exist = parseTags(draft.tagInput);
                        const next = active ? exist.filter((x) => x !== t.slug) : [...exist, t.slug];
                        set("tagInput", next.join(", "));
                      }}
                      className={
                        "rounded-full px-2.5 py-0.5 text-[11.5px] transition-colors hairline " +
                        (active
                          ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-transparent"
                          : "bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-muted)]")
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Card>

        <Card>
          <SectionHead
            eyebrow="Testset"
            title="Archive upload & extraction"
            description="Zip with matching 1.in / 1.out file pairs. A new archive replaces the current active testsets."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Testset type">
              <Select value={draft.testsetTypeCode} onChange={(e) => set("testsetTypeCode", e.target.value)}>
                <option value="primary">primary</option>
                <option value="samples">samples</option>
                <option value="hidden">hidden</option>
                <option value="custom">custom</option>
              </Select>
            </Field>
            <Field label="Title">
              <Input value={draft.testsetTitle} onChange={(e) => set("testsetTitle", e.target.value)} />
            </Field>
          </div>
          <Field label="Note">
            <Textarea value={draft.testsetNote} onChange={(e) => set("testsetNote", e.target.value)} rows={2} />
          </Field>
          <Field label="Zip archive">
            <input
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(e) => setTestsetArchive(e.target.files?.[0] ?? null)}
              className="text-[13px]"
            />
            {testsetArchive ? (
              <FilePill name={testsetArchive.name} size={testsetArchive.size} onRemove={() => setTestsetArchive(null)} />
            ) : null}
            {mode === "edit" && initialData.testsets.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {initialData.testsets.map((t) => (
                  <Chip key={t.id} tone="neutral">
                    {t.title ?? t.testset_type_code} · {t.extracted_case_count} cases
                  </Chip>
                ))}
              </div>
            ) : null}
          </Field>
        </Card>

        <Card>
          <SectionHead eyebrow="Checker" title="Diff or custom checker" />
          <Field label="Checker type">
            <Select value={draft.checkerTypeCode} onChange={(e) => set("checkerTypeCode", e.target.value)}>
              <option value="diff">diff</option>
              <option value="custom">custom</option>
            </Select>
          </Field>
          <Field label="Note">
            <Textarea value={draft.checkerNote} onChange={(e) => set("checkerNote", e.target.value)} rows={2} />
          </Field>
          {draft.checkerTypeCode === "custom" ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Checker runtime">
                  <Select
                    value={draft.checkerRuntimeProfileKey}
                    onChange={(e) => set("checkerRuntimeProfileKey", e.target.value)}
                  >
                    <option value="">Choose runtime</option>
                    {runtimes.map((r) => (
                      <option key={r.id} value={r.profile_key}>
                        {r.runtime_name} ({r.profile_key})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Entrypoint">
                  <Input
                    value={draft.checkerEntrypoint}
                    onChange={(e) => set("checkerEntrypoint", e.target.value)}
                    placeholder="checker.cpp"
                  />
                </Field>
              </div>
              <Field label="Checker source">
                <input
                  type="file"
                  onChange={(e) => setCheckerSource(e.target.files?.[0] ?? null)}
                  className="text-[13px]"
                />
                {checkerSource ? (
                  <FilePill name={checkerSource.name} size={checkerSource.size} onRemove={() => setCheckerSource(null)} />
                ) : canReuseChecker && initialData.activeChecker?.source_object ? (
                  <div className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    Current: {initialData.activeChecker.source_object.original_filename ?? initialData.activeChecker.source_object.object_key}
                  </div>
                ) : null}
              </Field>
            </>
          ) : null}
        </Card>

        {progress ? (
          <Banner tone="info" title={progress.percent != null ? `${progress.percent}% uploaded` : "Uploading…"}>
            {progress.total ? (
              <div>
                {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
              </div>
            ) : null}
            {progress.percent != null ? (
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
                <div className="h-full bg-[var(--color-accent)]" style={{ width: `${progress.percent}%` }} />
              </div>
            ) : null}
          </Banner>
        ) : null}

        {err ? <Banner tone="err" title={mode === "create" ? "Create failed" : "Save failed"}>{err}</Banner> : null}

        {!accessToken ? (
          <Banner tone="warn" title="Sign-in required">
            <Link
              to={`/login?redirectTo=${encodeURIComponent(loginRedirectPath)}`}
              className="text-[var(--color-info-fg)] underline"
            >
              Sign in
            </Link>{" "}
            to save problems.
          </Banner>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center gap-1 rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)] disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {busy && intent === "manual" ? submittingLabel : submitLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSubmit("save_draft")}
            className="inline-flex h-10 items-center rounded-full hairline bg-[var(--color-bg-elevated)] px-4 text-[13px] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
          >
            {busy && intent === "save_draft" ? "Saving draft…" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSubmit("request_review")}
            className="inline-flex h-10 items-center rounded-full hairline bg-[var(--color-bg-elevated)] px-4 text-[13px] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
          >
            {busy && intent === "request_review" ? "Submitting…" : "Request review"}
          </button>
          {mode === "edit" && initialData.id ? (
            <Link
              to={`/dashboard/problems/${initialData.id}/testsets`}
              className="inline-flex h-10 items-center rounded-full hairline bg-[var(--color-bg-elevated)] px-4 text-[13px] hover:bg-[var(--color-bg-muted)]"
            >
              Manage testsets
            </Link>
          ) : null}
        </div>
      </form>

      <aside className="space-y-3">
        <Card>
          <div className="text-eyebrow">Draft status</div>
          <div className="mt-2 space-y-1 text-[12.5px]">
            <div>
              <Chip tone={dirty ? "warn" : "ok"}>{dirty ? "Unsaved" : "Saved"}</Chip>
            </div>
            <div className="text-[12px] text-[var(--color-text-tertiary)]">
              Autosave {autosavedAt ? new Date(autosavedAt).toLocaleTimeString() : "idle"}
            </div>
            {hasFiles ? (
              <div className="text-[11.5px] text-[var(--color-text-tertiary)]">Files are not autosaved.</div>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(initial);
                setStatementFile(null);
                setStatementAssets([]);
                setTestsetArchive(null);
                setCheckerSource(null);
                setErr(null);
              }}
              className="rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(storageKey);
                setAutosavedAt(null);
              }}
              className="rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
            >
              Clear autosave
            </button>
          </div>
        </Card>

        <Card>
          <div className="text-eyebrow">Runtime catalog</div>
          <ul className="mt-2 space-y-1 text-[12.5px]">
            {runtimesQ.isLoading ? (
              <Skeleton className="h-16" />
            ) : (
              runtimes.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2">
                  <span>{r.runtime_name}</span>
                  <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">{r.profile_key}</span>
                </li>
              ))
            )}
          </ul>
        </Card>

        {mode === "edit" && initialData.id ? (
          <Card>
            <div className="text-eyebrow">Surfaces</div>
            <div className="mt-2 flex flex-col gap-1 text-[12.5px]">
              <Link to="/dashboard/problems" className="hover:underline">
                All problems
              </Link>
              <Link to={`/problems/${initialData.slug}`} className="hover:underline">
                Public detail
              </Link>
              <Link to={`/problems/${initialData.slug}/solve`} className="hover:underline">
                Solve workspace
              </Link>
            </div>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-3">
      <div className="text-eyebrow">{eyebrow}</div>
      <h2 className="text-h3">{title}</h2>
      {description ? (
        <p className="text-[12.5px] text-[var(--color-text-secondary)]">{description}</p>
      ) : null}
    </header>
  );
}

function FilePill({ name, size, onRemove }: { name: string; size: number; onRemove: () => void }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-muted)] hairline px-2 py-0.5 text-[11.5px]">
      {name} · {formatBytes(size)}
      <button
        type="button"
        onClick={onRemove}
        className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
