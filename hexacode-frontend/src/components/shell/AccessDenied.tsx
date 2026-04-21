import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function AccessDenied({
  title = "Access denied",
  message = "Your account does not have permission to view this page.",
  backTo = "/",
  backLabel = "Back to site",
}: {
  title?: string;
  message?: string;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <Card className="mx-auto max-w-xl py-10 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-h2">{title}</h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">{message}</p>
      <div className="mt-5">
        <Link
          to={backTo}
          className="inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-4 text-[13px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
        >
          {backLabel}
        </Link>
      </div>
    </Card>
  );
}
