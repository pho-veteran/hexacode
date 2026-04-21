import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Power, PowerOff, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createDashboardTag,
  deleteDashboardTag,
  getDashboardTags,
  transitionDashboardTag,
  updateDashboardTag,
  type DashboardTag,
} from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Dialog } from "@/components/ui/Dialog";
import { useAuth } from "@/lib/auth";
import { formatRelative, slugify } from "@/lib/utils";

export function DashboardTagsRoute() {
  const auth = useAuth();
  const qc = useQueryClient();
  const canRead = auth.hasPermission("tag.read_dashboard");
  const canCreate = auth.hasPermission("tag.create");
  const canUpdate = auth.hasPermission("tag.update");
  const canLifecycle = auth.hasPermission("tag.lifecycle");
  const canDelete = auth.hasPermission("tag.delete");
  const q = useQuery({
    queryKey: ["dashboard-tags"],
    queryFn: getDashboardTags,
    enabled: auth.status === "authenticated" && canRead,
  });
  const [editing, setEditing] = useState<DashboardTag | null>(null);
  const [creating, setCreating] = useState(false);

  const mutCreate = useMutation({
    mutationFn: createDashboardTag,
    onSuccess: async () => {
      toast.success("Tag created");
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ["dashboard-tags"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const mutUpdate = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      updateDashboardTag(id, payload),
    onSuccess: async () => {
      toast.success("Tag updated");
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["dashboard-tags"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const mutAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "deactivate" }) =>
      transitionDashboardTag(id, action),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["dashboard-tags"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const mutDelete = useMutation({
    mutationFn: deleteDashboardTag,
    onSuccess: async () => {
      toast.success("Tag deleted");
      await qc.invalidateQueries({ queryKey: ["dashboard-tags"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-64" />;
  if (!canRead) {
    return (
      <AccessDenied
        title="Tag dashboard unavailable"
        message="This account does not have permission to view dashboard taxonomy."
        backTo="/dashboard"
        backLabel="Back to dashboard"
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-eyebrow">Taxonomy</div>
          <h1 className="mt-1 text-h1">Tags</h1>
        </div>
        {canCreate ? (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center gap-1 rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
          >
            <PlusCircle className="h-4 w-4" /> New tag
          </button>
        ) : null}
      </header>

      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState title="No tags yet" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {q.data!.map((t) => (
            <Card key={t.id} className="py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold">{t.name}</div>
                    <Chip tone={t.is_active ? "ok" : "neutral"}>
                      {t.is_active ? "active" : "inactive"}
                    </Chip>
                    <Chip tone="neutral">{t.problem_count} problems</Chip>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">{t.slug}</span>
                  </div>
                  {t.description ? (
                    <p className="mt-1 text-[12.5px] text-[var(--color-text-secondary)] line-clamp-2">
                      {t.description}
                    </p>
                  ) : null}
                  <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                    Updated {formatRelative(t.updated_at)}
                  </div>
                </div>
                <div className="flex gap-1">
                  {canUpdate ? (
                    <IconBtn title="Edit" onClick={() => setEditing(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconBtn>
                  ) : null}
                  {canLifecycle ? (
                    t.is_active ? (
                      <IconBtn
                        title="Deactivate"
                        onClick={() => mutAction.mutate({ id: t.id, action: "deactivate" })}
                      >
                        <PowerOff className="h-3.5 w-3.5" />
                      </IconBtn>
                    ) : (
                      <IconBtn
                        title="Activate"
                        onClick={() => mutAction.mutate({ id: t.id, action: "activate" })}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </IconBtn>
                    )
                  ) : null}
                  {canDelete ? (
                    <IconBtn
                      title="Delete"
                      onClick={() => {
                        if (!window.confirm(`Delete "${t.name}"?`)) return;
                        mutDelete.mutate(t.id);
                      }}
                      destructive
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating ? (
        <TagDialog
          onClose={() => setCreating(false)}
          onSubmit={(payload) => mutCreate.mutate(payload)}
          submitting={mutCreate.isPending}
          title="New tag"
        />
      ) : null}
      {editing ? (
        <TagDialog
          initial={editing}
          title={`Edit tag — ${editing.name}`}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => mutUpdate.mutate({ id: editing.id, payload })}
          submitting={mutUpdate.isPending}
        />
      ) : null}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  destructive,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  title?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={
        "inline-flex h-8 w-8 items-center justify-center rounded-full hairline transition-colors " +
        (destructive
          ? "bg-[var(--color-err-bg)] text-[var(--color-err-fg)] hover:brightness-95"
          : "bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-muted)]")
      }
    >
      {children}
    </button>
  );
}

function TagDialog({
  initial,
  title,
  submitting,
  onClose,
  onSubmit,
}: {
  initial?: DashboardTag;
  title: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)} title={title}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            name: name.trim(),
            slug: slug.trim() || slugify(name),
            description: description?.trim() || null,
            color: color?.trim() || null,
            icon: icon?.trim() || null,
          });
        }}
      >
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
            autoFocus
          />
        </Field>
        <Field label="Slug" hint="Used in URLs and filters.">
          <Input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
          />
        </Field>
        <Field label="Description" hint="Optional short blurb.">
          <Textarea
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Color" hint="Hex or token name.">
            <Input value={color ?? ""} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <Field label="Icon" hint="Lucide icon key.">
            <Input value={icon ?? ""} onChange={(e) => setIcon(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-full hairline bg-[var(--color-bg-elevated)] px-3 text-[13px] hover:bg-[var(--color-bg-muted)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex h-9 items-center rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)] disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
