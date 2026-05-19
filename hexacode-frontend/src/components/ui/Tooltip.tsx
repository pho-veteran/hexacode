import * as TooltipPrim from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function Tooltip({
  content,
  children,
  side = "right",
  delayDuration = 300,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}) {
  return (
    <TooltipPrim.Provider delayDuration={delayDuration}>
      <TooltipPrim.Root>
        <TooltipPrim.Trigger asChild>{children}</TooltipPrim.Trigger>
        <TooltipPrim.Portal>
          <TooltipPrim.Content
            side={side}
            sideOffset={6}
            className="z-50 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] hairline px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)] shadow-float animate-in fade-in-0 zoom-in-95"
          >
            {content}
            <TooltipPrim.Arrow className="fill-[var(--color-bg-elevated)]" />
          </TooltipPrim.Content>
        </TooltipPrim.Portal>
      </TooltipPrim.Root>
    </TooltipPrim.Provider>
  );
}
