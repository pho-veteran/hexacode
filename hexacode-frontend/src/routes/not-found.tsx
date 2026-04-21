import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";

export function NotFoundRoute() {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-[var(--color-bg-base)]">
      <Card className="max-w-md text-center">
        <div className="text-eyebrow">404</div>
        <h1 className="mt-1 text-[24px] font-semibold">Page not found</h1>
        <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
          The page you requested has moved or never existed.
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-5 text-[14px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
        >
          Back home
        </Link>
      </Card>
    </div>
  );
}
