import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardUsers,
  grantDashboardUserRole,
  revokeDashboardUserRole,
  transitionDashboardUser,
  type RoleCode,
  type UserLifecycleAction,
} from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Skeleton, ErrorBanner, EmptyState } from "@/components/ui/Feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";
import { toast } from "sonner";

const MANAGEABLE_ROLES: RoleCode[] = ["author", "reviewer", "moderator", "admin"];

export function DashboardUsersRoute() {
  const auth = useAuth();
  const qc = useQueryClient();
  const canRead = auth.hasPermission("user.read_directory");
  const canEnable = auth.hasPermission("user.enable");
  const canDisable = auth.hasPermission("user.disable");
  const canGrant = auth.hasPermission("role.grant");
  const canRevoke = auth.hasPermission("role.revoke");
  const canManageAdminRole = auth.hasPermission("admin.full");
  const q = useQuery({
    queryKey: ["dashboard-users"],
    queryFn: getDashboardUsers,
    enabled: auth.status === "authenticated" && canRead,
  });
  const mut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: UserLifecycleAction }) =>
      transitionDashboardUser(id, action),
    onSuccess: async () => {
      toast.success("User updated");
      await qc.invalidateQueries({ queryKey: ["dashboard-users"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const roleMut = useMutation({
    mutationFn: ({
      id,
      role,
      nextState,
    }: {
      id: string;
      role: RoleCode;
      nextState: "grant" | "revoke";
    }) => (nextState === "grant" ? grantDashboardUserRole(id, role) : revokeDashboardUserRole(id, role)),
    onSuccess: async (_, vars) => {
      toast.success(vars.nextState === "grant" ? "Role granted" : "Role revoked");
      await qc.invalidateQueries({ queryKey: ["dashboard-users"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

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
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState title="No users" />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Status</TH>
                <TH>Roles</TH>
                <TH>Problems</TH>
                <TH>Submissions</TH>
                <TH>Joined</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {q.data!.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="font-medium">{u.username ?? u.cognito_sub}</div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)]">Cognito: {u.cognito_sub}</div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)]">{u.id}</div>
                  </TD>
                  <TD>
                    <Chip tone={u.status_code === "active" ? "ok" : "neutral"}>
                      {u.status_code}
                    </Chip>
                  </TD>
                  <TD className="min-w-[280px]">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((role) => (
                        <Chip key={role} tone={role === "admin" ? "accent" : "neutral"} className="capitalize">
                          {role}
                        </Chip>
                      ))}
                    </div>
                    {canGrant || canRevoke ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {MANAGEABLE_ROLES.filter((role) => canManageAdminRole || role !== "admin").map((role) => {
                          const assigned = u.roles.includes(role);
                          const disabled =
                            roleMut.isPending ||
                            (assigned ? !canRevoke : !canGrant);
                          return (
                            <button
                              key={role}
                              disabled={disabled}
                              onClick={() =>
                                roleMut.mutate({
                                  id: u.id,
                                  role,
                                  nextState: assigned ? "revoke" : "grant",
                                })
                              }
                              className={
                                "rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 " +
                                (assigned
                                  ? "bg-[var(--color-err-bg)] text-[var(--color-err-fg)]"
                                  : "hairline bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-muted)]")
                              }
                            >
                              {assigned ? `Remove ${role}` : `Add ${role}`}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </TD>
                  <TD className="tabular-nums">{u.problem_count}</TD>
                  <TD className="tabular-nums">{u.submission_count}</TD>
                  <TD className="text-[11px] text-[var(--color-text-tertiary)]">
                    {formatRelative(u.created_at)}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {u.status_code === "active" && canDisable ? (
                        <button
                          disabled={mut.isPending}
                          onClick={() => {
                            if (!window.confirm(`Disable user ${u.cognito_sub}?`)) return;
                            mut.mutate({ id: u.id, action: "disable" });
                          }}
                          className="rounded-full bg-[var(--color-err-bg)] px-2.5 py-1 text-[12px] text-[var(--color-err-fg)] hover:brightness-95 disabled:opacity-50"
                        >
                          Disable
                        </button>
                      ) : null}
                      {u.status_code !== "active" && canEnable ? (
                        <button
                          disabled={mut.isPending}
                          onClick={() => mut.mutate({ id: u.id, action: "enable" })}
                          className="rounded-full hairline bg-[var(--color-bg-elevated)] px-2.5 py-1 text-[12px] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
                        >
                          Enable
                        </button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
