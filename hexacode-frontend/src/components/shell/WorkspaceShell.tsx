import { Outlet } from "react-router-dom";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { SessionExpiringBanner } from "./SessionExpiringBanner";

export function WorkspaceShell() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] flex flex-col">
      <SessionExpiringBanner />
      <Outlet />
      <ChatWidget area="workspace" />
    </div>
  );
}
