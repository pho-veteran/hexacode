import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-[background,border,color,transform] duration-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:brightness-95 active:brightness-90",
        secondary:
          "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] hairline hover:bg-[var(--color-bg-muted)]",
        ghost:
          "bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)]",
        danger:
          "bg-[var(--color-err-bg)] text-[var(--color-err-fg)] hairline hover:brightness-95",
        link: "bg-transparent text-[var(--color-info-fg)] underline-offset-4 hover:underline px-0 py-0 h-auto",
      },
      shape: {
        pill: "rounded-[var(--radius-pill)]",
        rect: "rounded-[var(--radius-md)]",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-[14px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      shape: "pill",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, shape, size, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(button({ variant, shape, size }), className)}
      {...rest}
    />
  );
});
