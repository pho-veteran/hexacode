import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-[var(--color-bg-elevated)] hairline rounded-[var(--radius-lg)]",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("my-4 border-t border-[var(--color-border-hair)]", className)} />;
}
