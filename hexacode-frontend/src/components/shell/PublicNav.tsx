import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth, getSessionUsername } from "@/lib/auth";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, User, LayoutDashboard } from "lucide-react";

const navItem = ({ isActive }: { isActive: boolean }) =>
  cn(
    "px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors",
    isActive
      ? "bg-[var(--color-bg-muted)] text-[var(--color-text-primary)]"
      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
  );

export function PublicNav() {
  const auth = useAuth();
  const loc = useLocation();
  const name = getSessionUsername(auth.session);

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[color-mix(in_srgb,var(--color-bg-base)_82%,transparent)] border-b border-[var(--color-border-hair)]">
      <div className="mx-auto max-w-[1160px] px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Brand to="/" />
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/problems" className={navItem}>
              Problems
            </NavLink>
            <NavLink to="/submissions" className={navItem}>
              Submissions
            </NavLink>
            {auth.status === "authenticated" && auth.canAccessDashboard ? (
              <NavLink to="/dashboard" className={navItem}>
                Dashboard
              </NavLink>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {auth.status === "loading" ? (
            <span className="text-[12px] text-[var(--color-text-tertiary)]">Checking session…</span>
          ) : auth.status === "authenticated" ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="inline-flex items-center gap-2 rounded-full hairline bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[13px] hover:bg-[var(--color-bg-muted)]">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] text-[10px] font-semibold text-[var(--color-accent-fg)]">
                    {(name ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-[160px] truncate">{name ?? "Account"}</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="min-w-56 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] hairline shadow-float p-1.5 z-50"
                >
                  {auth.canAccessDashboard ? (
                    <DropdownMenu.Item asChild>
                      <Link
                        to="/dashboard"
                        className="flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-sm)] text-[13px] hover:bg-[var(--color-bg-muted)] outline-none"
                      >
                        <LayoutDashboard className="h-4 w-4" /> Dashboard
                      </Link>
                    </DropdownMenu.Item>
                  ) : null}
                  <DropdownMenu.Item asChild>
                    <Link
                      to="/submissions"
                      className="flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-sm)] text-[13px] hover:bg-[var(--color-bg-muted)] outline-none"
                    >
                      <User className="h-4 w-4" /> My submissions
                    </Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border-hair)]" />
                  <DropdownMenu.Item
                    onSelect={() => auth.logout()}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-sm)] text-[13px] text-[var(--color-err-fg)] hover:bg-[var(--color-err-bg)] outline-none cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <Link
              to={`/login?redirectTo=${encodeURIComponent(loc.pathname + loc.search)}`}
              className="inline-flex h-8 items-center rounded-full bg-[var(--color-accent)] px-3 text-[13px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
