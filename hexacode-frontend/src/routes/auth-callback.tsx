import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";

export function AuthCallbackRoute() {
  return (
    <Card>
      <div className="text-eyebrow">Legacy</div>
      <h1 className="mt-1 text-[22px] font-semibold">Hosted UI callback</h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
        Hexacode now signs in using an in-app Cognito form. This page exists only for
        backward compatibility with hosted-UI redirects.
      </p>
      <div className="mt-4 flex gap-2 text-[13px]">
        <Link to="/login" className="underline">
          Go to sign in
        </Link>
        <Link to="/problems" className="underline text-[var(--color-text-secondary)]">
          Browse problems
        </Link>
      </div>
    </Card>
  );
}
