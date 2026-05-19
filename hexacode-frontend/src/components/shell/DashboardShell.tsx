import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ChevronsLeft,
  ChevronsRight,
  Files,
  HardDrive,
  LayoutDashboard,
  Menu,
  Tags,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Feedback";
import { Tooltip } from "@/components/ui/Tooltip";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Brand } from "./Brand";
import { AccessDenied } from "./AccessDenied";
import { AuthRequired } from "./AuthRequired";
import { SessionExpiringBanner } from "./SessionExpiringBanner";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import type { PermissionCode } from "@/lib/api";
import { useAuth, getSessionUsername } from "@/lib/auth";

type NavGroup = "content" | "people" | "system";

const LINKS: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  permissions: PermissionCode[];
  group: NavGroup;
}[] = [
  {
    to: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
    group: "content",
    permissions: [
      "problem.read_own_dashboard",
      "problem.read_review_queue",
      "tag.read_dashboard",
      "user.read_directory",
      "ops.read_dashboard",
      "ops.manage_storage_orphans",
    ],
  },
  {
    to: "/dashboard/problems",
    label: "Problems",
    icon: Files,
    group: "content",
    permissions: ["problem.read_own_dashboard", "problem.read_review_queue"],
  },
  {
    to: "/dashboard/tags",
    label: "Tags",
    icon: Tags,
    group: "content",
    permissions: ["tag.read_dashboard"],
  },
  {
    to: "/dashboard/users",
    label: "Users",
    icon: Users,
    group: "people",
    permissions: ["user.read_directory"],
  },
  {
    to: "/dashboard/operations",
    label: "Operations",
    icon: Wrench,
    group: "system",
    permissions: ["ops.read_dashboard"],
  },
  {
    to: "/dashboard/storage",
    label: "Storage",
    icon: HardDrive,
    group: "system",
    permissions: ["ops.manage_storage_orphans"],
  },
];

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  problems: "Problems",
  tags: "Tags",
  users: "Users",
  operations: "Operations",
  storage: "Storage",
  new: "New",
  edit: "Edit",
};

function useBreadcrumbs(pathname: string) {
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
  return segments.map((seg, i) => {
    const to = "/" + segments.slice(0, i + 1).join("/");
    const label = SEGMENT_LABELS[seg] ?? seg;
    return { label, to: i < segments.length - 1 ? to : undefined };
  });
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export function DashboardShell() {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(isMobile);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const auth = useAuth();
  const user = getSessionUsername(auth.session);
  const visibleLinks = LINKS.filter((link) => auth.hasAnyPermission(link.permissions));
  const breadcrumbItems = useBreadcrumbs(loc.pathname);

  // Auto-collapse on mobile
  useEffect(() => {
    if (isMobile) setCollapsed(true);
  }, [isMobile]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), []);

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

  // Group visible links
  const groups: NavGroup[] = ["content", "people", "system"];
  const groupedLinks = groups
    .map((g) => visibleLinks.filter((l) => l.group === g))
    .filter((arr) => arr.length > 0);

  const sidebarVisible = isMobile ? mobileOpen : true;

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] flex">
      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      {sidebarVisible && (
        <aside
          className={cn(
            "flex flex-col border-r border-[var(--color-border-hair)] bg-[var(--color-bg-base)] transition-[width] duration-150",
            collapsed ? "w-[64px]" : "w-[240px]",
            isMobile
              ? "fixed top-0 left-0 h-screen z-40"
              : "sticky top-0 h-screen flex-none",
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
            {isMobile ? (
              <button
                type="button"
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] rounded-md p-1"
                onClick={() => setMobileOpen(false)}
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] rounded-md p-1"
                onClick={() => setCollapsed((v) => !v)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              </button>
            )}
          </div>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {groupedLinks.map((groupLinks, gi) => (
              <div key={gi}>
                {gi > 0 && (
                  <hr className="my-2 border-[var(--color-border-hair)]" />
                )}
                {groupLinks.map((l) => {
                  const Icon = l.icon;
                  const linkEl = (
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

                  if (collapsed) {
                    return (
                      <Tooltip key={l.to} content={l.label} side="right">
                        {linkEl}
                      </Tooltip>
                    );
                  }
                  return linkEl;
                })}
              </div>
            ))}
          </nav>

          {/* User card */}
          {!collapsed ? (
            <div className="p-3">
              <Card className="p-3 text-[12px]">
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
            </div>
          ) : null}
        </aside>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-14 flex items-center justify-between px-6 border-b border-[var(--color-border-hair)] bg-[var(--color-bg-base)] sticky top-0 z-20">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            {isMobile && (
              <button
                type="button"
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] rounded-md p-1"
                onClick={toggleMobile}
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <Link to="/" className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              ← Back to site
            </Link>
            <Breadcrumbs items={breadcrumbItems} />
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
        <ChatWidget area="dashboard" />
      </div>
    </div>
  );
}
