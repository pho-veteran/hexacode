import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardUsers,
  grantDashboardUserRole,
  revokeDashboardUserRole,
  transitionDashboardUser,
  type DashboardUser,
  type DashboardUsersParams,
  type RoleCode,
  type UserLifecycleAction,
} from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SearchInput } from "@/components/ui/SearchInput";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { toast } from "sonner";
import * as DialogPrim from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

const MANAGEABLE_ROLES: RoleCode[] = ["author", "reviewer", "moderator", "admin"];
const ROLE_TABS = [
  { label: "All", value: "" },
  { label: "Authors", value: "author" },
  { label: "Reviewers", value: "reviewer" },
  { label: "Moderators", value: "moderator" },
  { label: "Admins", value: "admin" },
] as const;
const PAGE_SIZE = 25;

type ConfirmState = {
  userId: string;
  username: string;
  role?: RoleCode;
  action: "grant" | "revoke" | "disable";
};

export function DashboardUsersRoute() {
  const auth = useAuth();
  const qc = useQueryClient();
  const canRead = auth.hasPermission("user.read_directory");
  const canEnable = auth.hasPermission("user.enable");
  const canDisable = auth.hasPermission("user.disable");
  const canGrant = auth.hasPermission("role.grant");
  const canRevoke = auth.hasPermission("role.revoke");
  const canManageAdminRole = auth.hasPermission("admin.full");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedUser, setSelectedUser] = useState<DashboardUser | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const params: DashboardUsersParams = {
    limit: PAGE_SIZE,
    offset,
    ...(search && { search }),
    ...(roleFilter && { role: roleFilter }),
  };

  const q = useQuery({
    queryKey: ["dashboard-users", params],
    queryFn: () => getDashboardUsers(params),
    enabled: auth.status === "authenticated" && canRead,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dashboard-users"] });

  const mut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: UserLifecycleAction }) =>
      transitionDashboardUser(id, action),
    onSuccess: async (_, vars) => {
      const u = q.data?.data.find((x) => x.id === vars.id);
      toast.success(`${vars.action === "disable" ? "Disabled" : "Enabled"} user ${u?.username ?? vars.id}`);
      await invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role, nextState }: { id: string; role: RoleCode; nextState: "grant" | "revoke" }) =>
      nextState === "grant" ? grantDashboardUserRole(id, role) : revokeDashboardUserRole(id, role),
    onSuccess: async (_, vars) => {
      const u = q.data?.data.find((x) => x.id === vars.id);
      const name = u?.username ?? vars.id;
      toast.success(
        vars.nextState === "grant"
          ? `Granted ${vars.role} role to ${name}`
          : `Revoked ${vars.role} role from ${name}`,
      );
      await invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function handleConfirm() {
    if (!confirm) return;
    if (confirm.action === "disable") {
      mut.mutate({ id: confirm.userId, action: "disable" });
    } else if (confirm.role) {
      roleMut.mutate({ id: confirm.userId, role: confirm.role, nextState: confirm.action });
    }
    setConfirm(null);
  }

  function requestRoleChange(u: DashboardUser, role: RoleCode, action: "grant" | "revoke") {
    setConfirm({ userId: u.id, username: u.username ?? u.cognito_sub, role, action });
  }

  function requestDisable(u: DashboardUser) {
    setConfirm({ userId: u.id, username: u.username ?? u.cognito_sub, action: "disable" });
  }

  const total = q.data?.meta.total ?? 0;
  const users = q.data?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-64" />;
  if (!canRead) {
    return (
      <AccessDenied
        title="User moderation unavailable"
        message="This account does not have permission to view the user directory."
        backTo="/dashboard"
        backLabel="Back to dashboard"
      />
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="text-eyebrow">Directory</div>
        <h1 className="mt-1 text-h1">Users</h1>
      </header>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setOffset(0); }}
          placeholder="Search by username…"
          className="w-full sm:max-w-xs"
        />
        <div className="flex gap-1 overflow-x-auto">
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setRoleFilter(tab.value); setOffset(0); }}
              className={
                "whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors " +
                (roleFilter === tab.value
                  ? "bg-[var(--color-accent)] text-white"
                  : "hairline bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]")
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Username</TH>
                <TH>Status</TH>
                <TH>Roles</TH>
                <TH>Problems</TH>
                <TH>Joined</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {users.map((u) => (
                <TR
                  key={u.id}
                  className="cursor-pointer hover:bg-[var(--color-bg-muted)]/50"
                  onClick={() => setSelectedUser(u)}
                >
                  <TD>
                    <span className="font-medium">{u.username ?? u.cognito_sub}</span>
                  </TD>
                  <TD>
                    <Chip tone={u.status_code === "active" ? "ok" : "neutral"}>
                      {u.status_code}
                    </Chip>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((role) => (
                        <Chip key={role} tone={role === "admin" ? "accent" : "neutral"} className="capitalize">
                          {role}
                        </Chip>
                      ))}
                      {u.roles.length === 0 && (
                        <span className="text-[11px] text-[var(--color-text-tertiary)]">—</span>
                      )}
                    </div>
                  </TD>
                  <TD className="tabular-nums">{u.problem_count}</TD>
                  <TD className="text-[11px] text-[var(--color-text-tertiary)]">
                    {formatRelative(u.created_at)}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                      {u.status_code === "active" && canDisable && (
                        <button
                          disabled={mut.isPending}
                          onClick={() => requestDisable(u)}
                          className="rounded-full bg-[var(--color-err-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-err-fg)] hover:brightness-95 disabled:opacity-50"
                        >
                          Disable
                        </button>
                      )}
                      {u.status_code !== "active" && canEnable && (
                        <button
                          disabled={mut.isPending}
                          onClick={() => mut.mutate({ id: u.id, action: "enable" })}
                          className="rounded-full hairline bg-[var(--color-bg-elevated)] px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
                        >
                          Enable
                        </button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[13px] text-[var(--color-text-secondary)]">
          <span>{total} user{total !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded p-1 hover:bg-[var(--color-bg-muted)] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded p-1 hover:bg-[var(--color-bg-muted)] disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* User Detail Panel */}
      <UserDetailPanel
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        canGrant={canGrant}
        canRevoke={canRevoke}
        canManageAdminRole={canManageAdminRole}
        onRoleChange={(u, role, action) => requestRoleChange(u, role, action)}
        rolePending={roleMut.isPending}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title={
          confirm?.action === "disable"
            ? "Disable user?"
            : confirm?.action === "grant" && confirm.role === "admin"
              ? "Grant administrator access?"
              : confirm?.action === "grant"
                ? `Grant ${confirm?.role} role?`
                : `Revoke ${confirm?.role} role?`
        }
        description={
          confirm?.action === "disable"
            ? `This will prevent ${confirm.username} from accessing the platform.`
            : confirm?.action === "grant" && confirm.role === "admin"
              ? "This gives full unrestricted access to all platform features."
              : confirm?.action === "grant"
                ? `Grant ${confirm?.role} role to ${confirm?.username}.`
                : `Revoke ${confirm?.role} role from ${confirm?.username}.`
        }
        confirmLabel={
          confirm?.action === "disable"
            ? "Disable"
            : confirm?.action === "grant"
              ? "Grant"
              : "Revoke"
        }
        variant={
          confirm?.action === "disable" || (confirm?.action === "grant" && confirm.role === "admin")
            ? "danger"
            : "default"
        }
        onConfirm={handleConfirm}
        loading={mut.isPending || roleMut.isPending}
      />
    </div>
  );
}

/* ---------- User Detail Slide-out Panel ---------- */

function UserDetailPanel({
  user,
  onClose,
  canGrant,
  canRevoke,
  canManageAdminRole,
  onRoleChange,
  rolePending,
}: {
  user: DashboardUser | null;
  onClose: () => void;
  canGrant: boolean;
  canRevoke: boolean;
  canManageAdminRole: boolean;
  onRoleChange: (u: DashboardUser, role: RoleCode, action: "grant" | "revoke") => void;
  rolePending: boolean;
}) {
  return (
    <DialogPrim.Root open={!!user} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogPrim.Portal>
        <DialogPrim.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrim.Content className="fixed right-0 top-0 z-50 h-full w-[min(100vw,420px)] bg-[var(--color-bg-elevated)] shadow-float p-6 overflow-y-auto data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between mb-6">
            <DialogPrim.Title className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              User Details
            </DialogPrim.Title>
            <DialogPrim.Close className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
              <X className="h-4 w-4" />
            </DialogPrim.Close>
          </div>

          {user && (
            <div className="space-y-6">
              {/* Info */}
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">Info</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="text-[var(--color-text-tertiary)]">Username</dt>
                  <dd className="font-medium">{user.username ?? "—"}</dd>
                  <dt className="text-[var(--color-text-tertiary)]">ID</dt>
                  <dd className="font-mono text-[11px] break-all">{user.id}</dd>
                  <dt className="text-[var(--color-text-tertiary)]">Cognito Sub</dt>
                  <dd className="font-mono text-[11px] break-all">{user.cognito_sub}</dd>
                  <dt className="text-[var(--color-text-tertiary)]">Status</dt>
                  <dd><Chip tone={user.status_code === "active" ? "ok" : "neutral"}>{user.status_code}</Chip></dd>
                  <dt className="text-[var(--color-text-tertiary)]">Joined</dt>
                  <dd>{formatRelative(user.created_at)}</dd>
                  <dt className="text-[var(--color-text-tertiary)]">Problems</dt>
                  <dd className="tabular-nums">{user.problem_count}</dd>
                  <dt className="text-[var(--color-text-tertiary)]">Submissions</dt>
                  <dd className="tabular-nums">{user.submission_count}</dd>
                </dl>
              </section>

              {/* Role Management */}
              {(canGrant || canRevoke) && (
                <section className="space-y-3">
                  <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">Roles</h3>
                  <div className="space-y-2">
                    {MANAGEABLE_ROLES.filter((r) => canManageAdminRole || r !== "admin").map((role) => {
                      const assigned = user.roles.includes(role);
                      const isAdmin = role === "admin";
                      return (
                        <div key={role} className="flex items-center justify-between rounded-[var(--radius-md)] hairline px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Chip tone={isAdmin ? "accent" : "neutral"} className="capitalize">{role}</Chip>
                            {assigned && <span className="text-[11px] text-[var(--color-text-tertiary)]">Active</span>}
                          </div>
                          {assigned ? (
                            canRevoke && (
                              <button
                                disabled={rolePending}
                                onClick={() => onRoleChange(user, role, "revoke")}
                                className="rounded-full bg-[var(--color-err-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-err-fg)] hover:brightness-95 disabled:opacity-50"
                              >
                                Revoke
                              </button>
                            )
                          ) : (
                            canGrant && (
                              <button
                                disabled={rolePending}
                                onClick={() => onRoleChange(user, role, "grant")}
                                className={
                                  "rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 " +
                                  (isAdmin
                                    ? "border border-[var(--color-err-fg)] text-[var(--color-err-fg)] hover:bg-[var(--color-err-bg)]"
                                    : "hairline bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-muted)]")
                                }
                              >
                                {isAdmin ? "Grant admin" : `Grant ${role}`}
                              </button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </DialogPrim.Content>
      </DialogPrim.Portal>
    </DialogPrim.Root>
  );
}
