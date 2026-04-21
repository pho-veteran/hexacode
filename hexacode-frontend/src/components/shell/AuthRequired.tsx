import { Link, useLocation } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function AuthRequired({
  title = "Sign in required",
  description = "You need to sign in to access this surface. Your work and filters stay on this page.",
}: {
  title?: string;
  description?: string;
}) {
  const loc = useLocation();
  const redirectTo = encodeURIComponent(loc.pathname + loc.search);
  return (
    <div className="mx-auto max-w-md py-12 relative z-10">
      <Card className="text-center">
        <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-bg-muted)] text-[var(--color-text-secondary)]">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <h2 className="text-[18px] font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{description}</p>
        <Link
          to={`/login?redirectTo=${redirectTo}`}
          className="mt-4 inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-5 text-[14px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
        >
          Sign in
        </Link>
      </Card>
    </div>
  );
}
