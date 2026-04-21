import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorBanner, Banner } from "@/components/ui/Feedback";
import { useAuth, confirmPasswordReset, requestPasswordReset } from "@/lib/auth";

const DEFAULT_REDIRECT = "/dashboard/problems/new";

type Stage = "request" | "confirm" | "done";

export function ForgotPasswordRoute() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirectTo") || DEFAULT_REDIRECT;

  const [stage, setStage] = useState<Stage>("request");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setSubmitting(true);
    try {
      const r = await requestPasswordReset(auth.env, username);
      const where = r.destination ?? "your account";
      setStatus(`Cognito sent a reset code to ${where}${r.medium ? ` via ${r.medium.toLowerCase()}` : ""}.`);
      setStage("confirm");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(auth.env, { username, code, newPassword });
      setStage("done");
      setStatus("Password reset complete. You can now sign in.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="text-eyebrow">Reset</div>
      <h1 className="mt-1 text-[26px] font-semibold">Forgot password</h1>
      <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">
        Cognito will send a reset code to the account's registered email.
      </p>
      {!auth.isConfigured ? (
        <div className="mt-4">
          <ErrorBanner title="Cognito not configured" />
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

      {stage === "request" ? (
        <form onSubmit={request} className="mt-6 space-y-4">
          <Field label="Username or email" id="fp-username">
            <Input
              id="fp-username"
              required
              disabled={!auth.isConfigured}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={submitting || !auth.isConfigured} className="w-full">
            {submitting ? "Sending…" : "Send reset code"}
          </Button>
        </form>
      ) : null}

      {stage === "confirm" ? (
        <form onSubmit={confirm} className="mt-6 space-y-4">
          <Field label="Username" id="fp-user"><Input id="fp-user" required value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label="Reset code" id="fp-code"><Input id="fp-code" required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="New password" id="fp-new"><Input id="fp-new" required type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
          <Field label="Confirm new password" id="fp-confirm"><Input id="fp-confirm" required type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></Field>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Updating…" : "Reset password"}
          </Button>
        </form>
      ) : null}

      {stage === "done" ? (
        <div className="mt-6">
          <Link
            to={`/login?redirectTo=${encodeURIComponent(redirectTo)}&username=${encodeURIComponent(username)}`}
            className="inline-flex h-10 items-center rounded-full bg-[var(--color-accent)] px-5 text-[14px] font-medium text-[var(--color-accent-fg)] hover:brightness-95"
          >
            Continue to sign in
          </Link>
        </div>
      ) : null}
    </div>
  );
}
