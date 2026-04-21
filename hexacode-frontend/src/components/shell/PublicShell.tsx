import { Outlet } from "react-router-dom";
import { PublicNav } from "./PublicNav";
import { GradientCanvas, GrainOverlay } from "./Ambient";
import { SessionExpiringBanner } from "./SessionExpiringBanner";

export function PublicShell() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <GradientCanvas variant="public" />
      <GrainOverlay />
      <div className="relative z-10 min-h-screen flex flex-col">
        <PublicNav />
        <SessionExpiringBanner />
        <main className="flex-1 mx-auto w-full max-w-[1160px] px-6 py-8 md:py-12">
          <Outlet />
        </main>
        <footer className="relative z-10 border-t border-[var(--color-border-hair)] mt-16">
          <div className="mx-auto max-w-[1160px] px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-[12px] text-[var(--color-text-tertiary)]">
            <div>© {new Date().getFullYear()} Hexacode. Quiet surfaces, serious judging.</div>
            <div className="flex items-center gap-4">
              <a href="/problems" className="hover:text-[var(--color-text-primary)]">
                Problems
              </a>
              <a href="/submissions" className="hover:text-[var(--color-text-primary)]">
                Submissions
              </a>
              <a href="/dashboard" className="hover:text-[var(--color-text-primary)]">
                Dashboard
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
