import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="flex items-center gap-1 text-[12px]">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-[var(--color-text-tertiary)]" />}
            {isLast || !item.to ? (
              <span className="font-medium text-[var(--color-text-primary)]">{item.label}</span>
            ) : (
              <Link to={item.to} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
