import * as DropdownPrim from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode } from "react";

export const DropdownMenu = DropdownPrim.Root;
export const DropdownMenuTrigger = DropdownPrim.Trigger;

export function DropdownMenuContent({
  children,
  className,
  ...props
}: DropdownPrim.DropdownMenuContentProps) {
  return (
    <DropdownPrim.Portal>
      <DropdownPrim.Content
        sideOffset={4}
        className={cn(
          "z-50 min-w-[160px] rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] hairline p-1 shadow-float animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownPrim.Content>
    </DropdownPrim.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  destructive,
  icon: Icon,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <DropdownPrim.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-[13px] outline-none transition-colors select-none",
        "hover:bg-[var(--color-bg-muted)] focus:bg-[var(--color-bg-muted)]",
        "disabled:opacity-50 disabled:pointer-events-none",
        destructive ? "text-[var(--color-err-fg)]" : "text-[var(--color-text-primary)]",
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </DropdownPrim.Item>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownPrim.Separator className="my-1 h-px bg-[var(--color-border-hair)]" />;
}
