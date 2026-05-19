import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  debounceMs = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}) {
  const [internal, setInternal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setInternal(value); }, [value]);

  function handleChange(v: string) {
    setInternal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), debounceMs);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="absolute left-3 h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
      <input
        type="text"
        value={internal}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-full bg-[var(--color-bg-elevated)] hairline py-2 pl-8 pr-8 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-[var(--color-accent)] transition-colors"
      />
      {internal ? (
        <button
          type="button"
          onClick={() => handleChange("")}
          className="absolute right-2.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
