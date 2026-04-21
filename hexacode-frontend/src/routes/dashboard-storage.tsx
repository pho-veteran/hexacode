import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import {
  cleanupDashboardStorageLifecycle,
  inspectDashboardStorageLifecycle,
} from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatRelative } from "@/lib/utils";

export function DashboardStorageRoute() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [limit, setLimit] = useState(100);
  const canManage = auth.hasPermission("ops.manage_storage_orphans");
  const q = useQuery({
    queryKey: ["storage-orphans", limit],
    queryFn: () => inspectDashboardStorageLifecycle(limit),
    enabled: auth.status === "authenticated" && canManage,
  });
  const mut = useMutation({
    mutationFn: () => cleanupDashboardStorageLifecycle({ limit }),
    onSuccess: async (r) => {
      toast.success(
        `Deleted ${r.deleted_count} / scanned ${r.scanned_count}. ~${r.remaining_estimate} remaining.`,
      );
      await qc.invalidateQueries({ queryKey: ["storage-orphans"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-64" />;
  if (!canManage) {
    return (
      <AccessDenied
        title="Storage maintenance unavailable"
        message="This account does not have permission to inspect or delete orphaned storage objects."
        backTo="/dashboard"
        backLabel="Back to dashboard"
      />
    );
  }

  const data = q.data;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-eyebrow">Storage</div>
          <h1 className="mt-1 text-h1">Orphaned objects</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Scan S3 for storage rows not referenced by any problem/submission artifact, then clean up.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Limit
            <input
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 100)))}
              className="ml-2 h-9 w-20 rounded-[var(--radius-md)] hairline bg-[var(--color-bg-elevated)] px-2 text-[13px]"
            />
          </label>
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="inline-flex h-9 items-center gap-1 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 text-[13px] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" /> Inspect
          </button>
          <button
            disabled={mut.isPending || !data?.total_count}
            onClick={() => {
              if (!window.confirm(`Permanently delete up to ${limit} orphaned objects?`)) return;
              mut.mutate();
            }}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-[var(--color-err-bg)] px-3 text-[13px] text-[var(--color-err-fg)] hover:brightness-95 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clean up
          </button>
        </div>
      </header>

      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : !data ? null : (
        <>
          <Card>
            <div className="flex items-center gap-4 flex-wrap text-[13px]">
              <span>
                <strong>{data.total_count}</strong> orphan estimate
              </span>
              <span className="text-[var(--color-text-tertiary)]">·</span>
              <span>Showing up to {data.limit}</span>
              <span className="text-[var(--color-text-tertiary)]">·</span>
              <span>
                Total size in view:{" "}
                <strong>{formatBytes(data.objects.reduce((a, o) => a + o.size_bytes, 0))}</strong>
              </span>
            </div>
          </Card>

          {data.objects.length === 0 ? (
            <EmptyState title="No orphans detected" />
          ) : (
            <Card className="p-0 overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Object key</TH>
                    <TH>Bucket</TH>
                    <TH>Role</TH>
                    <TH>Size</TH>
                    <TH>Problem</TH>
                    <TH>Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.objects.map((o) => (
                    <TR key={o.id}>
                      <TD className="font-mono text-[11.5px] max-w-[320px] truncate" title={o.object_key}>
                        {o.object_key}
                      </TD>
                      <TD>{o.bucket}</TD>
                      <TD>{o.role ? <Chip tone="neutral">{o.role}</Chip> : "—"}</TD>
                      <TD className="tabular-nums">{formatBytes(o.size_bytes)}</TD>
                      <TD className="text-[12px]">
                        {o.problem_id ? `${o.problem_id.slice(0, 8)}…` : "—"}
                      </TD>
                      <TD className="text-[11px] text-[var(--color-text-tertiary)]">
                        {formatRelative(o.created_at)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
