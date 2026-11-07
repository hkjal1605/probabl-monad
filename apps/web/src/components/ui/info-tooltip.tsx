"use client";

import { type ReactElement, type ReactNode, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TOUCH = "(hover: none)";
const subscribe = (change: () => void) => {
  const query = window.matchMedia(TOUCH);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

/** Non-button help text remains focusable for keyboard and touch users. A touch screen has no
 * hover, so there a tap opens it (and a tap elsewhere closes it). */
export function InfoTooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const touch = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(TOUCH).matches,
    () => false,
  );
  if (!content) return children;
  if (touch)
    return (
      <Popover>
        <PopoverTrigger
          render={children}
          nativeButton={false}
          aria-description={typeof content === "string" ? content : undefined}
        />
        <PopoverContent
          side="top"
          align="center"
          className="w-auto max-w-[min(18rem,calc(100vw-2rem))] px-3 py-2 text-xs leading-4"
        >
          {content}
        </PopoverContent>
      </Popover>
    );
  return (
    <Tooltip>
      <TooltipTrigger
        render={children}
        tabIndex={0}
        aria-description={typeof content === "string" ? content : undefined}
      />
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
