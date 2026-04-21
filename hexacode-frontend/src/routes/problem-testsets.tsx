import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Trash2, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteDashboardTestcase,
  deleteDashboardTestset,
  downloadAuthenticatedFile,
  getDashboardProblem,
  getDashboardProblemFileUrl,
  updateDashboardTestcase,
  type ProblemTestcase,
} from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input, Textarea } from "@/components/ui/Input";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";
import { formatBytes } from "@/lib/utils";

export function ProblemTestsetsRoute() {
  const { problemId = "" } = useParams();
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["dashboard-problem", problemId],
    queryFn: () => getDashboardProblem(problemId),
    enabled: !!problemId && auth.status === "authenticated",
  });

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-96" />;
  if (!auth.hasPermission("testset.manage_own")) {
    return (
      <AccessDenied
        title="Testset management unavailable"
        message="This account does not have permission to manage extracted testsets."
        backTo="/dashboard/problems"
        backLabel="Back to problems"
      />
    );
  }
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError)
    return <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  if (!q.data) return null;

  const p = q.data;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-eyebrow">Testsets</div>
          <h1 className="mt-1 text-h1">{p.title}</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Inspect extracted cases, edit weights, and delete rows. Upload new archives from the{" "}
            <Link to={`/dashboard/problems/${problemId}/edit`} className="underline">
              edit page
            </Link>
            .
          </p>
        </div>
      </header>

      {p.testsets.length === 0 ? (
        <EmptyState
          title="No testsets yet"
          description="Upload a zip archive from the edit page to extract testcases."
          action={
            <Link
              to={`/dashboard/problems/${problemId}/edit`}
              className="inline-flex h-9 items-center rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)]"
            >
              Go to edit
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {p.testsets.map((ts) => (
            <TestsetCard
              key={ts.id}
              problemId={problemId}
              testsetId={ts.id}
              title={ts.title ?? ts.testset_type_code}
              typeCode={ts.testset_type_code}
              extractedCount={ts.extracted_case_count}
              testcases={ts.testcases}
              archiveName={ts.archive_object?.original_filename ?? ts.archive_object?.object_key ?? null}
              archiveObjectId={ts.archive_object?.id ?? null}
              onRefresh={() => qc.invalidateQueries({ queryKey: ["dashboard-problem", problemId] })}
              accessToken={auth.accessToken}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TestsetCard({
  problemId,
  testsetId,
  title,
  typeCode,
  extractedCount,
  testcases,
  archiveName,
  archiveObjectId,
  onRefresh,
  accessToken,
}: {
  problemId: string;
  testsetId: string;
  title: string;
  typeCode: string;
  extractedCount: number;
  testcases: ProblemTestcase[];
  archiveName: string | null;
  archiveObjectId: string | null;
  onRefresh: () => void;
  accessToken: string | null;
}) {
  const mutDelete = useMutation({
    mutationFn: () => deleteDashboardTestset(problemId, testsetId),
    onSuccess: async () => {
      toast.success("Testset deleted");
      onRefresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const downloadArchive = async () => {
    if (!accessToken || !archiveObjectId) return;
    try {
      await downloadAuthenticatedFile(
        getDashboardProblemFileUrl(problemId, archiveObjectId),
        accessToken,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card>
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-h3">{title}</h2>
            <Chip tone="neutral">{typeCode}</Chip>
            <Chip tone="info">{extractedCount} cases</Chip>
          </div>
          {archiveName ? (
            <div className="text-[11.5px] text-[var(--color-text-tertiary)]">
              Archive: {archiveName}
            </div>
          ) : null}
        </div>
        <div className="flex gap-1">
          {archiveObjectId && accessToken ? (
            <button
              onClick={downloadArchive}
              className="inline-flex items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1 text-[12px] hover:bg-[var(--color-bg-muted)]"
            >
              <Download className="h-3 w-3" /> Archive
            </button>
          ) : null}
          <button
            onClick={() => {
              if (!window.confirm(`Delete testset "${title}"? This also removes extracted cases.`)) return;
              mutDelete.mutate();
            }}
            disabled={mutDelete.isPending}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-err-bg)] px-3 py-1 text-[12px] text-[var(--color-err-fg)] hover:brightness-95 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Delete testset
          </button>
        </div>
      </header>

      {testcases.length === 0 ? (
        <EmptyState title="No testcases extracted" />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Weight</TH>
                <TH>Sample</TH>
                <TH>Input</TH>
                <TH>Expected</TH>
                <TH>Note</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {testcases.map((tc) => (
                <TestcaseRow
                  key={tc.id}
                  problemId={problemId}
                  testsetId={testsetId}
                  tc={tc}
                  onRefresh={onRefresh}
                  accessToken={accessToken}
                />
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function TestcaseRow({
  problemId,
  testsetId,
  tc,
  onRefresh,
  accessToken,
}: {
  problemId: string;
  testsetId: string;
  tc: ProblemTestcase;
  onRefresh: () => void;
  accessToken: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(String(tc.weight));
  const [isSample, setIsSample] = useState(tc.is_sample);
  const [note, setNote] = useState(tc.note ?? "");

  const mutSave = useMutation({
    mutationFn: () =>
      updateDashboardTestcase(problemId, testsetId, tc.id, {
        weight: Number(weight) || 0,
        is_sample: isSample,
        note: note || null,
      }),
    onSuccess: () => {
      toast.success("Testcase updated");
      setEditing(false);
      onRefresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const mutDelete = useMutation({
    mutationFn: () => deleteDashboardTestcase(problemId, testsetId, tc.id),
    onSuccess: () => {
      toast.success("Testcase deleted");
      onRefresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const download = async (objectId: string | undefined) => {
    if (!objectId || !accessToken) return;
    try {
      await downloadAuthenticatedFile(getDashboardProblemFileUrl(problemId, objectId), accessToken);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const inp = tc.input_object;
  const out = tc.expected_output_object;

  return (
    <TR>
      <TD className="tabular-nums">#{tc.ordinal}</TD>
      <TD>
        {editing ? (
          <Input value={weight} onChange={(e) => setWeight(e.target.value)} className="h-8 w-20" />
        ) : (
          <span className="tabular-nums">{tc.weight}</span>
        )}
      </TD>
      <TD>
        {editing ? (
          <input type="checkbox" checked={isSample} onChange={(e) => setIsSample(e.target.checked)} />
        ) : tc.is_sample ? (
          <Chip tone="ok">sample</Chip>
        ) : (
          <Chip tone="neutral">hidden</Chip>
        )}
      </TD>
      <TD className="text-[11px]">
        {inp ? (
          <button
            onClick={() => download(inp.id)}
            className="inline-flex items-center gap-1 text-[var(--color-info-fg)] hover:underline"
            title={inp.original_filename ?? inp.object_key}
          >
            <Download className="h-3 w-3" />
            {formatBytes(inp.size_bytes)}
          </button>
        ) : (
          "—"
        )}
      </TD>
      <TD className="text-[11px]">
        {out ? (
          <button
            onClick={() => download(out.id)}
            className="inline-flex items-center gap-1 text-[var(--color-info-fg)] hover:underline"
            title={out.original_filename ?? out.object_key}
          >
            <Download className="h-3 w-3" />
            {formatBytes(out.size_bytes)}
          </button>
        ) : (
          "—"
        )}
      </TD>
      <TD>
        {editing ? (
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} className="min-h-8 py-1" />
        ) : (
          <span className="text-[12px] text-[var(--color-text-secondary)]">{tc.note ?? "—"}</span>
        )}
      </TD>
      <TD>
        <div className="flex gap-1">
          {editing ? (
            <>
              <IconBtn title="Save" onClick={() => mutSave.mutate()}>
                <Save className="h-3 w-3" />
              </IconBtn>
              <IconBtn
                title="Cancel"
                onClick={() => {
                  setEditing(false);
                  setWeight(String(tc.weight));
                  setIsSample(tc.is_sample);
                  setNote(tc.note ?? "");
                }}
              >
                <X className="h-3 w-3" />
              </IconBtn>
            </>
          ) : (
            <IconBtn title="Edit" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" />
            </IconBtn>
          )}
          <IconBtn
            title="Delete"
            destructive
            onClick={() => {
              if (!window.confirm(`Delete testcase #${tc.ordinal}?`)) return;
              mutDelete.mutate();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </IconBtn>
        </div>
      </TD>
    </TR>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  destructive,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  destructive?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={
        "inline-flex h-7 w-7 items-center justify-center rounded-full " +
        (destructive
          ? "bg-[var(--color-err-bg)] text-[var(--color-err-fg)] hover:brightness-95"
          : "hairline bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-muted)]")
      }
    >
      {children}
    </button>
  );
}
