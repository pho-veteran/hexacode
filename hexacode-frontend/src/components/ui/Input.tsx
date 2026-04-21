import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full bg-[var(--color-bg-elevated)] hairline rounded-[var(--radius-md)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-[var(--color-accent)] focus-visible:border-[var(--color-border-soft)] transition-[border,background] duration-150 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(base, "h-10", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(base, "min-h-24", className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "w-full bg-[var(--color-bg-elevated)] hairline rounded-[var(--radius-md)] px-3 text-[14px] text-[var(--color-text-primary)] focus-visible:outline-[var(--color-accent)] focus-visible:border-[var(--color-border-soft)] transition-[border,background] duration-150 disabled:opacity-60 h-10 pr-8 leading-none",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export function Label({
  children,
  htmlFor,
  hint,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "flex items-center justify-between gap-2 text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5",
        className,
      )}
    >
      <span>{children}</span>
      {hint ? <span className="text-[11px] text-[var(--color-text-tertiary)]">{hint}</span> : null}
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  id,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {label ? (
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-[var(--color-err-fg)]">{error}</p>
      ) : null}
    </div>
  );
}
