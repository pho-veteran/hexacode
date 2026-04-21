import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="hairline rounded-[var(--radius-lg)] overflow-hidden bg-[var(--color-bg-elevated)]">
      <table className={cn("w-full text-[13px]", className)}>{children}</table>
    </div>
  );
}
export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-[var(--color-bg-muted)]">{children}</thead>;
}
export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}
export function TR({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-t border-[var(--color-border-hair)] first:border-t-0 hover:bg-[color-mix(in_srgb,var(--color-bg-muted)_60%,transparent)]",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}
export function TH({
  children,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "text-left font-medium text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-tertiary)] px-3.5 py-2.5",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}
export function TD({
  children,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-3.5 py-2.5 align-middle", className)} {...rest}>
      {children}
    </td>
  );
}
