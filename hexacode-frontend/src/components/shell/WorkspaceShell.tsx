import { Outlet } from "react-router-dom";
import { SessionExpiringBanner } from "./SessionExpiringBanner";

export function WorkspaceShell() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] flex flex-col">
      <SessionExpiringBanner />
      <Outlet />
    </div>
  );
}
