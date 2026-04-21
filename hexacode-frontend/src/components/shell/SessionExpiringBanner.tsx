import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Banner } from "@/components/ui/Feedback";

const FIVE_MIN = 5 * 60 * 1000;

export function SessionExpiringBanner() {
  const auth = useAuth();
  const loc = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (auth.status !== "authenticated" || !auth.session || dismissed) return null;

  const remaining = auth.session.expiresAt - Date.now();
  if (remaining > FIVE_MIN || remaining <= 0) return null;
  void tick;

  const minsLeft = Math.max(0, Math.ceil(remaining / 60_000));
  return (
    <div className="mx-auto max-w-[1160px] px-6 pt-3">
      <Banner tone="warn" onDismiss={() => setDismissed(true)}>
        Your session ends in {minsLeft}m.{" "}
        <Link
          to={`/login?redirectTo=${encodeURIComponent(loc.pathname + loc.search)}`}
          className="font-semibold underline underline-offset-2"
        >
          Sign in again
        </Link>{" "}
        to keep working.
      </Banner>
    </div>
  );
}
