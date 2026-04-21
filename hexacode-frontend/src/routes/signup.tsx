import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorBanner, Banner } from "@/components/ui/Feedback";
import { useAuth } from "@/lib/auth";
import { confirmSignUp, resendSignUpCode, signUpWithPassword, getSessionUsername } from "@/lib/auth";

const DEFAULT_REDIRECT = "/dashboard/problems/new";

type Stage = "signup" | "confirm" | "done";

function describeCodeDelivery(d: { destination?: string; medium?: string }) {
  const where = d.destination ?? "your account";
  const how = d.medium ? ` via ${d.medium.toLowerCase()}` : "";
  return `Cognito sent a confirmation code to ${where}${how}. Enter it to finish signing up.`;
}

export function SignupRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirectTo") || DEFAULT_REDIRECT;

  const [stage, setStage] = useState<Stage>("signup");
  const [signup, setSignup] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [confirm, setConfirm] = useState({ username: "", code: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  if (auth.session) {
    return (
      <div>
        <div className="text-eyebrow">Already signed in</div>
        <h1 className="mt-1 text-[26px] font-semibold">You have an active session</h1>
        <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">
          Signed in as {getSessionUsername(auth.session) ?? "—"}.
        </p>
        <div className="mt-4 flex gap-2">
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

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    if (signup.password !== signup.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await signUpWithPassword(auth.env, {
        username: signup.username,
        email: signup.email,
        password: signup.password,
      });
      if (r.userConfirmed) {
        setStatus("The Cognito user was created and confirmed. You can sign in now.");
        setStage("done");
      } else {
        setConfirm({ username: r.username, code: "" });
        setStatus(describeCodeDelivery(r.codeDelivery));
        setStage("confirm");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setSubmitting(true);
    try {
      await confirmSignUp(auth.env, confirm);
      setStage("done");
      setStatus("Your account is confirmed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!confirm.username) return;
    setResending(true);
    setError(null);
    try {
      const r = await resendSignUpCode(auth.env, confirm.username);
      setStatus(describeCodeDelivery(r));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div>
      <div className="text-eyebrow">Create account</div>
      <h1 className="mt-1 text-[26px] font-semibold">Sign up</h1>
      <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">
        Three steps: details → confirmation code → done.
      </p>
      {!auth.isConfigured ? (
        <div className="mt-4">
          <ErrorBanner title="Cognito not configured" message="Sign-up is disabled until Cognito is configured." />
        </div>
      ) : null}
      {status ? (
        <div className="mt-4">
          <Banner>{status}</Banner>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      {stage === "signup" ? (
        <form onSubmit={submitSignup} className="mt-6 space-y-4">
          <Field label="Username" id="su-username">
            <Input
              id="su-username"
              required
              disabled={!auth.isConfigured}
              value={signup.username}
              onChange={(e) => setSignup((s) => ({ ...s, username: e.target.value }))}
            />
          </Field>
          <Field label="Email" id="su-email">
            <Input
              id="su-email"
              required
              type="email"
              disabled={!auth.isConfigured}
              value={signup.email}
              onChange={(e) => setSignup((s) => ({ ...s, email: e.target.value }))}
            />
          </Field>
          <Field label="Password" id="su-password">
            <Input
              id="su-password"
              required
              type="password"
              disabled={!auth.isConfigured}
              value={signup.password}
              onChange={(e) => setSignup((s) => ({ ...s, password: e.target.value }))}
            />
          </Field>
          <Field label="Confirm password" id="su-confirm">
            <Input
              id="su-confirm"
              required
              type="password"
              disabled={!auth.isConfigured}
              value={signup.confirmPassword}
              onChange={(e) => setSignup((s) => ({ ...s, confirmPassword: e.target.value }))}
            />
          </Field>
          <Button type="submit" disabled={submitting || !auth.isConfigured} className="w-full">
            {submitting ? "Creating…" : "Create account"}
          </Button>
        </form>
      ) : null}

      {stage === "confirm" ? (
        <form onSubmit={submitConfirm} className="mt-6 space-y-4">
          <Field label="Username" id="cf-username">
            <Input
              id="cf-username"
              required
              value={confirm.username}
              onChange={(e) => setConfirm((s) => ({ ...s, username: e.target.value }))}
            />
          </Field>
          <Field label="Confirmation code" id="cf-code">
            <Input
              id="cf-code"
              required
              value={confirm.code}
              onChange={(e) => setConfirm((s) => ({ ...s, code: e.target.value }))}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Confirming…" : "Confirm code"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={resending}
              onClick={resend}
            >
              {resending ? "Sending…" : "Resend code"}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === "done" ? (
        <div className="mt-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/login?redirectTo=${encodeURIComponent(redirectTo)}&username=${encodeURIComponent(confirm.username || signup.username)}`}
              className="inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-5 text-[14px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
            >
              Continue to sign in
            </Link>
            <button
              type="button"
              onClick={() => navigate(redirectTo)}
              className="inline-flex h-10 items-center rounded-full hairline bg-[var(--color-bg-elevated)] px-5 text-[14px] font-medium hover:bg-[var(--color-bg-muted)]"
            >
              Skip to app
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
