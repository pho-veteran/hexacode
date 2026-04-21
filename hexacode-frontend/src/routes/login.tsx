import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Feedback";
import { useAuth, getSessionUsername } from "@/lib/auth";

const DEFAULT_REDIRECT = "/dashboard/problems/new";

export function LoginRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirectTo") || DEFAULT_REDIRECT;

  const [username, setUsername] = useState(params.get("username") ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUsername(params.get("username") ?? "");
  }, [params]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await auth.login({ username, password });
      if (r.status === "authenticated") {
        navigate(redirectTo, { replace: true });
      } else {
        navigate(`/new-password?redirectTo=${encodeURIComponent(redirectTo)}`, { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (auth.session) {
    const name = getSessionUsername(auth.session);
    return (
      <div>
        <div className="text-eyebrow">Signed in</div>
        <h1 className="mt-1 text-[26px] font-semibold">You're already signed in</h1>
        <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">
          Active session for <span className="font-medium text-[var(--color-text-primary)]">{name ?? "—"}</span>.
        </p>
        <div className="mt-5 flex gap-2">
          <Link
            to={redirectTo}
            className="inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-5 text-[14px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
          >
            Continue
          </Link>
          <button
            type="button"
            onClick={() => auth.logout()}
            className="inline-flex h-10 items-center rounded-full hairline bg-[var(--color-bg-elevated)] px-5 text-[14px] font-medium hover:bg-[var(--color-bg-muted)]"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-eyebrow">Welcome back</div>
      <h1 className="mt-1 text-[26px] font-semibold">Sign in</h1>
      <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">
        Use your Cognito credentials. Sessions carry across tabs.
      </p>
      {!auth.isConfigured ? (
        <div className="mt-4">
          <ErrorBanner
            title="Cognito not configured"
            message="Set PUBLIC_COGNITO_CLIENT_ID and PUBLIC_COGNITO_REGION to enable sign-in."
          />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="Username" id="username">
          <Input
            id="username"
            required
            disabled={!auth.isConfigured}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password" id="password">
          <Input
            id="password"
            required
            type="password"
            disabled={!auth.isConfigured}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={submitting || !auth.isConfigured} className="w-full">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-[var(--color-text-secondary)]">
        <Link to={`/forgot-password?redirectTo=${encodeURIComponent(redirectTo)}`} className="hover:text-[var(--color-text-primary)]">
          Forgot password?
        </Link>
        <span className="text-[var(--color-text-tertiary)]">·</span>
        <Link to={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`} className="hover:text-[var(--color-text-primary)]">
          Create an account
        </Link>
      </div>
    </div>
  );
}
