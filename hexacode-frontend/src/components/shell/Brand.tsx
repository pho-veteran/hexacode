import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export function Brand({
  to = "/",
  className,
  size = "md",
}: {
  to?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "text-[15px]", md: "text-[18px]", lg: "text-[22px]" }[size];
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-baseline font-semibold tracking-tight text-[var(--color-text-primary)]",
        sizes,
        className,
      )}
    >
      <span>Hexa</span>
      <span className="text-[var(--color-accent)]">code</span>
    </Link>
  );
}
