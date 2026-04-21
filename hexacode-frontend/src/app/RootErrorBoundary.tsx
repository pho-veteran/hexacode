import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { PublicNav } from "@/components/shell/PublicNav";
import { ErrorBanner } from "@/components/ui/Feedback";

export function RootErrorBoundary() {
  const error = useRouteError();
  let title = "Something went wrong";
  let description = "Request failed.";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Page not found" : `Request failed (${error.status})`;
    description = error.statusText ?? description;
  } else if (error instanceof Error) {
    description = error.message;
  }
  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="mx-auto max-w-[720px] px-6 py-16">
        <ErrorBanner title={title} message={description} />
        <div className="mt-6 text-[13px] text-[var(--color-text-secondary)]">
          <Link to="/problems" className="underline">
            Go to problem catalog
          </Link>
        </div>
        {import.meta.env.DEV && error instanceof Error ? (
          <pre className="mt-6 overflow-auto rounded bg-[var(--color-bg-muted)] p-3 text-[11px] text-[var(--color-text-secondary)]">
            {error.stack}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
