import { Link, Outlet, useLocation } from "react-router-dom";
import { Brand } from "./Brand";
import { GradientCanvas, GrainOverlay } from "./Ambient";

function AuthSidePanel() {
  return (
    <div className="relative hidden lg:flex min-h-screen flex-col justify-between overflow-hidden p-10 text-[var(--color-text-primary)]">
      <GradientCanvas variant="auth" />
      <GrainOverlay />
      <div className="relative z-10">
        <Brand size="lg" to="/" />
      </div>
      <div className="relative z-10 max-w-md">
        <div className="text-eyebrow">Hexacode</div>
        <h2 className="mt-2 text-[28px] font-semibold leading-tight">
          Practice, judge, and publish — on one quiet surface.
        </h2>
        <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
          Cognito-backed sign-in. No reload on success. Your session carries across tabs.
        </p>
      </div>
      <div className="relative z-10 text-[12px] text-[var(--color-text-tertiary)]">
        Backend: Hexacode gateway · Auth: AWS Cognito · Judge: worker pool
      </div>
    </div>
  );
}

function AuthRouteLinks() {
  const loc = useLocation();
  const qs = new URLSearchParams(loc.search);
  qs.delete("username");
  const preserved = qs.toString();
  const q = preserved ? `?${preserved}` : "";

  const link = (to: string, label: string) => (
    <Link
      to={`${to}${q}`}
      className={
        loc.pathname === to
          ? "font-semibold text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      }
    >
      {label}
    </Link>
  );

  return (
    <nav className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
      {link("/login", "Sign in")}
      {link("/signup", "Create account")}
      {link("/forgot-password", "Forgot password")}
      {link("/new-password", "New password")}
    </nav>
  );
}

export function AuthShell() {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(480px,45%)] bg-[var(--color-bg-base)]">
      <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden mb-6">
            <Brand to="/" />
          </div>
          <Outlet />
          <AuthRouteLinks />
        </div>
      </div>
      <AuthSidePanel />
    </div>
  );
}
