import { cn } from "@/lib/utils";

type Variant = "public" | "auth";

export function GradientCanvas({
  variant = "public",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("gradient-canvas", className)}>
      {variant === "public" ? (
        <>
          <span
            className="blob"
            style={{
              top: "-10%",
              right: "-5%",
              width: "640px",
              height: "640px",
              background:
                "radial-gradient(circle at 30% 30%, var(--color-grad-orange), transparent 62%)",
              opacity: 0.5,
            }}
          />
          <span
            className="blob"
            style={{
              top: "20%",
              right: "10%",
              width: "420px",
              height: "420px",
              background:
                "radial-gradient(circle at 50% 50%, var(--color-grad-peach), transparent 60%)",
              opacity: 0.4,
              animationDelay: "-6s",
            }}
          />
          <span
            className="blob"
            style={{
              top: "30%",
              left: "-8%",
              width: "520px",
              height: "520px",
              background:
                "radial-gradient(circle at 60% 40%, var(--color-grad-cyan), transparent 65%)",
              opacity: 0.45,
              animationDelay: "-12s",
            }}
          />
          <span
            className="blob"
            style={{
              bottom: "-20%",
              left: "10%",
              width: "480px",
              height: "480px",
              background:
                "radial-gradient(circle at 50% 50%, var(--color-grad-pink), transparent 65%)",
              opacity: 0.35,
              animationDelay: "-3s",
            }}
          />
        </>
      ) : (
        <>
          <span
            className="blob"
            style={{
              top: "-20%",
              right: "-20%",
              width: "560px",
              height: "560px",
              background:
                "radial-gradient(circle, var(--color-grad-orange), transparent 60%)",
              opacity: 0.5,
            }}
          />
          <span
            className="blob"
            style={{
              bottom: "-25%",
              left: "-20%",
              width: "520px",
              height: "520px",
              background: "radial-gradient(circle, var(--color-grad-sky), transparent 60%)",
              opacity: 0.45,
              animationDelay: "-9s",
            }}
          />
        </>
      )}
    </div>
  );
}

export function GrainOverlay() {
  return <div aria-hidden className="grain-layer" />;
}
