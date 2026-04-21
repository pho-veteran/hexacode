import * as DialogPrim from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrim.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrim.Portal>
        <DialogPrim.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrim.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] bg-[var(--color-bg-elevated)] hairline p-5 shadow-float",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              {title ? (
                <DialogPrim.Title className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                  {title}
                </DialogPrim.Title>
              ) : null}
              {description ? (
                <DialogPrim.Description className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  {description}
                </DialogPrim.Description>
              ) : null}
            </div>
            <DialogPrim.Close className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
              <X className="h-4 w-4" />
            </DialogPrim.Close>
          </div>
          <div className="mt-4">{children}</div>
        </DialogPrim.Content>
      </DialogPrim.Portal>
    </DialogPrim.Root>
  );
}
