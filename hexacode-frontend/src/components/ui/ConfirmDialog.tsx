import { Dialog } from "./Dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {children ? <div className="mb-4">{children}</div> : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="rounded-[var(--radius-md)] hairline px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={cn(
            "rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors disabled:opacity-60",
            variant === "danger"
              ? "bg-[var(--color-err-fg)] hover:bg-[var(--color-err-fg)]/90"
              : "bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/90",
          )}
        >
          {loading ? "…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
