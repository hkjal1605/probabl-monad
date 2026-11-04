import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { midSentence, percent, perThousand } from "@/lib/worlds/format";
import type { Venue } from "@/lib/worlds/types";
import { VenueMark } from "./primitives";

export interface ChainLeg {
  label: string;
  wantYes: boolean;
  source: Venue | null;
  /** The leg's own chance of going the world's way, x 1e6 (null once decided). */
  chance: number | null;
  /** Decided already the world's way. */
  passed?: boolean;
}

/** How likely a world is, walked on one base of 1,000: each event in turn, then the stock. In
 * Tversky and Kahneman's studies this sequence cut misjudged joint chances from 65% to 11%. */
export function ChanceChain({
  legs,
  chain,
  naive,
  stock,
  className,
}: {
  legs: ChainLeg[];
  /** P(legs 0..k all go the world's way) per open leg, x 1e6. */
  chain: number[];
  naive: number[];
  /** The stock step: its words, and P(world and the stock's side), x 1e6. */
  stock: { words: string; chance: number; world: number } | null;
  className?: string | undefined;
}) {
  const open = legs.filter((l) => !l.passed);
  const rows: { id: string; count: number; text: ReactNode; note: ReactNode; tone: string }[] = [];
  open.forEach((leg, k) => {
    const value = chain[k] ?? null;
    if (value === null) return;
    const previous = k === 0 ? 1_000_000 : (chain[k - 1] ?? 1_000_000);
    rows.push({
      id: `leg-${leg.label}`,
      count: value,
      text: (
        <>
          {k === 0 ? "have " : "also have "}
          {!leg.wantYes && <span className="font-semibold text-danger">no </span>}
          <span className="text-foreground">{midSentence(leg.label)}</span>
        </>
      ),
      note:
        k === 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <VenueMark source={leg.source} /> {percent((leg.chance ?? value) / 1e6)}
          </span>
        ) : (
          <>
            {percent(value / Math.max(1, previous))} given the above
            {leg.chance !== null && <> · {percent(leg.chance / 1e6)} alone</>}
          </>
        ),
      tone: "bg-foreground/70",
    });
  });
  if (stock) {
    const world = stock.world || (chain.at(-1) ?? 0);
    rows.push({
      id: "stock",
      count: stock.chance,
      text: (
        <>
          also see <span className="text-foreground">{stock.words}</span>
        </>
      ),
      note: <>{percent(stock.chance / Math.max(1, world))} in these worlds</>,
      tone: "bg-primary",
    });
  }
  const passed = legs.filter((l) => l.passed);
  const last = chain.at(-1) ?? 0,
    unrelated = naive.at(-1) ?? 0;
  const together = open.length > 1 && last > unrelated * 1.12;
  const apart = open.length > 1 && last < unrelated * 0.88;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ol className="flex flex-col gap-2.5">
        <Row count={1_000_000} text="worlds" note={null} tone="bg-muted-foreground/30" first />
        {rows.map((r) => (
          <Row key={r.id} count={r.count} text={r.text} note={r.note} tone={r.tone} />
        ))}
      </ol>
      {passed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Already decided the world's way: {passed.map((l) => midSentence(l.label)).join(", ")}.
        </p>
      )}
      {open.length > 1 && (
        <p className="text-xs leading-5 text-muted-foreground">
          If the events were unrelated:{" "}
          <span className="tabular-nums">{naive.map((n) => perThousand(n)).join(" → ")}</span>
          {together && ". These tend to happen together, so this world is likelier than that."}
          {apart && ". These tend to exclude each other, so this world is less likely than that."}
        </p>
      )}
    </div>
  );
}

function Row({
  count,
  text,
  note,
  tone,
  first = false,
}: {
  count: number;
  text: ReactNode;
  note: ReactNode;
  tone: string;
  first?: boolean;
}) {
  const width = Math.max(0.6, (count / 1_000_000) * 100);
  return (
    <li className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-start gap-3">
      <span
        className={cn(
          "pt-0.5 text-right text-lg font-medium leading-5 tabular-nums",
          first && "text-muted-foreground",
        )}
      >
        {first ? "1,000" : perThousand(count)}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm leading-5 text-muted-foreground">{text}</span>
          {note && <span className="text-xs text-muted-foreground">{note}</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
        </div>
      </div>
    </li>
  );
}
