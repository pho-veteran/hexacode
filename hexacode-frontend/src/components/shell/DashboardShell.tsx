import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ChevronsLeft,
  ChevronsRight,
  Files,
  HardDrive,
  LayoutDashboard,
  PlusCircle,
  Tags,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Feedback";
import { Brand } from "./Brand";
import { AccessDenied } from "./AccessDenied";
import { AuthRequired } from "./AuthRequired";
import { SessionExpiringBanner } from "./SessionExpiringBanner";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import type { PermissionCode } from "@/lib/api";
import { useAuth, getSessionUsername } from "@/lib/auth";

const LINKS = [
  {
    to: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
    permissions: [
      "problem.read_own_dashboard",
      "problem.read_review_queue",
      "tag.read_dashboard",
      "user.read_directory",
      "ops.read_dashboard",
      "ops.manage_storage_orphans",
    ] as PermissionCode[],
  },
  {
    to: "/dashboard/problems",
    label: "Problems",
    icon: Files,
    permissions: ["problem.read_own_dashboard", "problem.read_review_queue"] as PermissionCode[],
  },
  {
    to: "/dashboard/problems/new",
    label: "New problem",
    icon: PlusCircle,
    permissions: ["problem.create"] as PermissionCode[],
  },
  {
    to: "/dashboard/tags",
    label: "Tags",
    icon: Tags,
    permissions: ["tag.read_dashboard"] as PermissionCode[],
  },
  {
    to: "/dashboard/users",
    label: "Users",
    icon: Users,
    permissions: ["user.read_directory"] as PermissionCode[],
  },
  {
    to: "/dashboard/operations",
    label: "Operations",
    icon: Wrench,
    permissions: ["ops.read_dashboard"] as PermissionCode[],
  },
  {
    to: "/dashboard/storage",
    label: "Storage",
    icon: HardDrive,
    permissions: ["ops.manage_storage_orphans"] as PermissionCode[],
  },
];

export function DashboardShell() {
  const [collapsed, setCollapsed] = useState(false);
  const loc = useLocation();
  const auth = useAuth();
  const user = getSessionUsername(auth.session);
  const visibleLinks = LINKS.filter((link) => auth.hasAnyPermission(link.permissions));

  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-14 w-full" />
          <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
            <Skeleton className="h-[70vh] w-full" />
            <Skeleton className="h-[70vh] w-full" />
          </div>
        </div>
      </div>
    );
  }
  if (!auth.canAccessDashboard) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] p-6">
        <AccessDenied
          title="Dashboard access unavailable"
          message="This account can use the judge, but it does not have staff dashboard permissions."
          backTo="/problems"
          backLabel="Browse problems"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] flex">
      <aside
        className={cn(
          "sticky top-0 h-screen flex-none border-r border-[var(--color-border-hair)] transition-[width] duration-150 bg-[var(--color-bg-base)]",
          collapsed ? "w-[64px]" : "w-[240px]",
        )}
      >
        <div className="h-14 flex items-center justify-between px-3 border-b border-[var(--color-border-hair)]">
          {!collapsed ? (
            <Brand size="sm" to="/dashboard" />
          ) : (
            <Link
              to="/dashboard"
              aria-label="Hexacode home"
              className="mx-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent)] text-[12px] font-bold text-[var(--color-accent-fg)]"
            >
              Hx
            </Link>
          )}
          <button
            type="button"
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] rounded-md p-1"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
        <nav className="p-2 space-y-0.5">
          {visibleLinks.map((l) => {
            const Icon = l.icon;
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.exact}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-[13px] transition-colors",
                    "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)]",
                    isActive &&
                      "text-[var(--color-text-primary)] border-r-2 border-[var(--color-accent)] bg-[var(--color-bg-muted)]",
                    collapsed && "justify-center px-0",
                  )
                }
              >
                <Icon className="h-4 w-4 flex-none" />
                {!collapsed && <span>{l.label}</span>}
              </NavLink>
            );
          })}
        </nav>
        {!collapsed ? (
          <Card className="absolute bottom-3 left-3 right-3 p-3 text-[12px]">
            <div className="text-eyebrow">Signed in</div>
            <div className="mt-1 truncate font-medium text-[var(--color-text-primary)]">
              {user ?? "—"}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {auth.roles.map((role) => (
                <Chip key={role} tone={role === "admin" ? "accent" : "neutral"} className="capitalize">
                  {role}
                </Chip>
              ))}
            </div>
            <button
              type="button"
              onClick={() => auth.logout()}
              className="mt-3 text-[12px] text-[var(--color-err-fg)] hover:underline"
            >
              Sign out
            </button>
          </Card>
        ) : null}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-14 flex items-center justify-between px-6 border-b border-[var(--color-border-hair)] bg-[var(--color-bg-base)] sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              ← Back to site
            </Link>
            <span className="text-[12px] text-[var(--color-text-tertiary)]">{loc.pathname}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[12px] text-[var(--color-text-tertiary)] truncate max-w-[280px]">
              {user ? `Signed in as ${user}` : "Anonymous"}
            </div>
            <ThemeToggle />
          </div>
        </div>
        <SessionExpiringBanner />
        <main className="flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
