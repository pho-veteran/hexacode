import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorBanner, Banner } from "@/components/ui/Feedback";
import {
  useAuth,
  readPendingNewPasswordChallenge,
  completeNewPasswordChallenge,
  formatUserAttributeLabel,
  type PendingNewPasswordChallenge,
} from "@/lib/auth";

const DEFAULT_REDIRECT = "/dashboard/problems/new";

export function NewPasswordRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirectTo") || DEFAULT_REDIRECT;

  const [pending, setPending] = useState<PendingNewPasswordChallenge | null>(null);
  const [ready, setReady] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPending(readPendingNewPasswordChallenge());
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!pending) {
    return (
      <div>
        <div className="text-eyebrow">Challenge</div>
        <h1 className="mt-1 text-[26px] font-semibold">No pending password challenge</h1>
        <Banner tone="warn">
          Start from sign-in. If your account requires a new password, it will be requested.
        </Banner>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const session = await completeNewPasswordChallenge(auth.env, {
        newPassword,
        attributeValues: attrs,
      });
      auth.setSession(session);
      navigate(redirectTo, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="text-eyebrow">Required</div>
      <h1 className="mt-1 text-[26px] font-semibold">Set a new password</h1>
      <p className="mt-2 text-[13.5px] text-[var(--color-text-secondary)]">
        Your account requires a new password before you can finish signing in.
      </p>
      {error ? (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="Username">
          <Input value={pending.username} disabled />
        </Field>
        <Field label="New password" id="np-new"><Input id="np-new" required type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
        <Field label="Confirm new password" id="np-conf"><Input id="np-conf" required type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></Field>
        {pending.requiredAttributes.map((a) => (
          <Field key={a} label={formatUserAttributeLabel(a)} id={`np-${a}`}>
            <Input
              id={`np-${a}`}
              required
              type={a === "email" ? "email" : a === "phone_number" ? "tel" : "text"}
              value={attrs[a] ?? ""}
              onChange={(e) => setAttrs((s) => ({ ...s, [a]: e.target.value }))}
            />
          </Field>
        ))}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Saving…" : "Set password and continue"}
        </Button>
      </form>
    </div>
  );
}
