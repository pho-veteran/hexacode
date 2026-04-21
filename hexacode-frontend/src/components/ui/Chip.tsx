import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Tone = "ok" | "warn" | "err" | "info" | "neutral" | "accent";

const toneStyles: Record<Tone, string> = {
  ok: "bg-[var(--color-ok-bg)] text-[var(--color-ok-fg)]",
  warn: "bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]",
  err: "bg-[var(--color-err-bg)] text-[var(--color-err-fg)]",
  info: "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
  neutral: "bg-[var(--color-neutral-bg)] text-[var(--color-neutral-fg)]",
  accent: "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]",
};

export function Chip({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-0.5 text-[11.5px] font-medium leading-5",
        toneStyles[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80 animate-pulse" /> : null}
      {children}
    </span>
  );
}

export const Badge = Chip;

export function DifficultyChip({ value }: { value?: string | null }) {
  if (!value) return <Chip tone="neutral">—</Chip>;
  const v = value.toLowerCase();
  const tone: Tone = v === "easy" ? "ok" : v === "medium" ? "warn" : v === "hard" ? "err" : "neutral";
  return (
    <Chip tone={tone} className="capitalize">
      {v}
    </Chip>
  );
}

export function StatusChip({ value }: { value?: string | null }) {
  if (!value) return null;
  const v = value.toLowerCase();
  const tone: Tone =
    v === "published"
      ? "ok"
      : v === "approved"
      ? "info"
      : v === "pending_review"
      ? "warn"
      : v === "rejected" || v === "failed"
      ? "err"
      : "neutral";
  return (
    <Chip tone={tone} className="capitalize">
      {v.replace(/_/g, " ")}
    </Chip>
  );
}

export function VisibilityChip({ value }: { value?: string | null }) {
  if (!value) return null;
  const v = value.toLowerCase();
  return (
    <Chip tone={v === "public" ? "info" : "neutral"} className="capitalize">
      {v}
    </Chip>
  );
}

const verdictMap: Record<string, { tone: Tone; label: string }> = {
  ac: { tone: "ok", label: "Accepted" },
  wa: { tone: "err", label: "Wrong Answer" },
  tle: { tone: "warn", label: "Time Limit" },
  mle: { tone: "warn", label: "Memory Limit" },
  ce: { tone: "warn", label: "Compile Error" },
  rte: { tone: "err", label: "Runtime Error" },
  ie: { tone: "err", label: "Internal Error" },
  pd: { tone: "neutral", label: "Pending" },
};

export function VerdictChip({
  verdict,
  status,
}: {
  verdict?: string | null;
  status?: string | null;
}) {
  if (!verdict) {
    const s = (status ?? "").toLowerCase();
    if (s === "queued" || s === "running") {
      return (
        <Chip tone="neutral" dot>
          {s}
        </Chip>
      );
    }
    if (s === "done") return <Chip tone="info">Done</Chip>;
    if (s === "failed") return <Chip tone="err">Failed</Chip>;
    if (s === "cancelled") return <Chip tone="neutral">Cancelled</Chip>;
    return <Chip tone="neutral">—</Chip>;
  }
  const key = verdict.toLowerCase();
  const m = verdictMap[key];
  if (!m) return <Chip tone="neutral">{verdict}</Chip>;
  return (
    <Chip tone={m.tone} className="uppercase tracking-wide">
      {verdict.toUpperCase()} · <span className="normal-case tracking-normal">{m.label}</span>
    </Chip>
  );
}
