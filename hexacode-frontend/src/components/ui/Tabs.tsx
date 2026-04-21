import * as TabsPrim from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Tabs({
  value,
  onValueChange,
  items,
  children,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: ReactNode; disabled?: boolean }[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrim.Root
      value={value}
      onValueChange={onValueChange}
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      <TabsPrim.List className="flex items-center gap-1 border-b border-[var(--color-border-hair)]">
        {items.map((it) => (
          <TabsPrim.Trigger
            key={it.value}
            value={it.value}
            disabled={it.disabled}
            className={cn(
              "relative px-3 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors",
              "data-[state=active]:text-[var(--color-text-primary)]",
              "after:absolute after:left-3 after:right-3 after:-bottom-px after:h-0.5 after:bg-transparent",
              "data-[state=active]:after:bg-[var(--color-accent)]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {it.label}
          </TabsPrim.Trigger>
        ))}
      </TabsPrim.List>
      {children}
    </TabsPrim.Root>
  );
}

export const TabContent = TabsPrim.Content;
