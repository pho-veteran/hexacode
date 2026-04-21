import { cn } from "@/lib/utils";
import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius-md)] bg-[var(--color-bg-muted)]",
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin", className)} />;
}

export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
  icon,
  className,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-center py-12 px-6 rounded-[var(--radius-lg)] hairline bg-[var(--color-bg-muted)]",
        className,
      )}
    >
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-elevated)] hairline text-[var(--color-text-secondary)]">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
      {description ? (
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)] max-w-sm mx-auto">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-err-bg)] bg-[var(--color-err-bg)] px-4 py-3 text-[var(--color-err-fg)]",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
      <div className="flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        {message ? <p className="mt-0.5 text-[13px] opacity-90">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" shape="rect" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Banner({
  children,
  tone = "info",
  title,
  onDismiss,
  className,
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "err" | "ok";
  title?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const toneCls =
    tone === "warn"
      ? "bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]"
      : tone === "err"
        ? "bg-[var(--color-err-bg)] text-[var(--color-err-fg)]"
        : tone === "ok"
          ? "bg-[var(--color-ok-bg)] text-[var(--color-ok-fg)]"
          : "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]";
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 px-4 py-2 text-[13px] rounded-[var(--radius-md)]",
        toneCls,
        className,
      )}
    >
      <div>
        {title ? <div className="font-semibold">{title}</div> : null}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-[12px] opacity-80 hover:opacity-100 underline underline-offset-2"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export type AsyncState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
};

export function AsyncBoundary<T>({
  state,
  skeleton,
  empty,
  isEmpty,
  onRetry,
  children,
}: {
  state: AsyncState<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.isLoading && !state.data)
    return <>{skeleton ?? <Skeleton className="h-24 w-full" />}</>;
  if (state.isError)
    return (
      <ErrorBanner
        message={(state.error as Error | undefined)?.message ?? "Request failed."}
        onRetry={onRetry}
      />
    );
  if (!state.data) return <>{skeleton ?? <Skeleton className="h-24 w-full" />}</>;
  if (isEmpty && isEmpty(state.data)) return <>{empty ?? <EmptyState />}</>;
  return <>{children(state.data)}</>;
}
