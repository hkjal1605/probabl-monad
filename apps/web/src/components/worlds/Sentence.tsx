import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { calendarDay, midSentence, strikeText } from "@/lib/worlds/format";

/** A world as one sentence: the connecting words quiet, the parts that define it as chips.
 * Every card, page, ticket and position says a world the same way. */
export function Sentence({
  size = "display",
  className,
  children,
}: {
  size?: "display" | "large" | "card";
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-muted-foreground [overflow-wrap:anywhere]",
        size === "display" &&
          "text-[26px] leading-[1.38] font-medium tracking-[-0.015em] sm:text-[36px] sm:leading-[1.32]",
        size === "large" && "text-xl leading-[1.45] font-medium tracking-[-0.01em] sm:text-2xl",
        size === "card" && "text-base leading-[1.55] font-medium",
        className,
      )}
    >
      {children}
    </p>
  );
}

export type ChipTone = "event" | "no" | "stock" | "value";
const tones: Record<ChipTone, string> = {
  event: "bg-secondary text-foreground",
  no: "bg-secondary text-foreground",
  stock: "bg-brand-soft text-brand-strong",
  value: "bg-accent text-foreground",
};

/** One defining part of a sentence; it wraps across lines like text. */
export function Chip({
  tone = "event",
  interactive = false,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: ChipTone; interactive?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-[0.32em] px-[0.28em] py-[0.04em] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]",
        tones[tone],
        interactive &&
          "cursor-pointer underline decoration-[0.06em] decoration-dashed decoration-current/30 underline-offset-[0.18em] transition-colors outline-none hover:decoration-current/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:ring-2 data-popup-open:ring-ring/60",
        className,
      )}
      {...props}
    >
      {tone === "no" && (
        <span className="mr-[0.25em] rounded-[0.2em] bg-danger-soft px-[0.2em] text-[0.62em] align-[0.18em] font-semibold tracking-wide text-danger">
          NO
        </span>
      )}
      {children}
    </span>
  );
}

/** How a world's events are joined: "A", "A and B", "A, B and C". */
export function joinParts<T>(items: T[], render: (item: T, i: number) => ReactNode) {
  const out: ReactNode[] = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(i === items.length - 1 ? " and " : ", ");
    out.push(render(item, i));
  });
  return out;
}

export interface SentenceWorld {
  legs: { label: string; wantYes: boolean }[];
  stock: { symbol: string; direction: "above" | "below"; strike: string; date: string } | null;
}

/** A world's sentence from its parts, read-only. */
export function WorldSentence({
  world,
  size = "display",
  className,
}: {
  world: SentenceWorld;
  size?: "display" | "large" | "card";
  className?: string | undefined;
}) {
  const { legs, stock } = world;
  const events = joinParts(legs, (l, i) => (
    <Chip key={i} tone={l.wantYes ? "event" : "no"}>
      {midSentence(l.label)}
    </Chip>
  ));
  return (
    <Sentence size={size} className={className}>
      {stock ? (
        <>
          If {events}, <StockWords stock={stock} />
        </>
      ) : (
        <>
          {events}{" "}
          {legs.length === 1 ? "happens" : legs.length === 2 ? "both happen" : "all happen"}
        </>
      )}
    </Sentence>
  );
}

/** "NVDA closes above $240 on Fri, Dec 19". */
export function StockWords({ stock }: { stock: NonNullable<SentenceWorld["stock"]> }) {
  return (
    <>
      <Chip tone="stock">{stock.symbol}</Chip> closes{" "}
      <Chip tone="value">
        {stock.direction === "above" ? (
          <ArrowUpRight className="mr-[0.08em] inline size-[0.8em] align-[-0.06em]" />
        ) : (
          <ArrowDownRight className="mr-[0.08em] inline size-[0.8em] align-[-0.06em]" />
        )}
        {stock.direction}
      </Chip>{" "}
      <Chip tone="value">{strikeText(stock.strike)}</Chip> on{" "}
      <Chip tone="value">{calendarDay(stock.date)}</Chip>
    </>
  );
}
