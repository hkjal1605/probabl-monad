import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ago,
  inThousand,
  money,
  moneyRaw,
  multiple,
  nyDay,
  shortWallet,
  until,
  venueResult,
} from "@/lib/worlds/format";
import { outcomeAtoms } from "@/lib/worlds/offer";
import type { FeedWorld } from "@/lib/worlds/types";
import { VenueMark, WalletDot } from "./primitives";
import { WorldSentence } from "./Sentence";

/** What a stake of $20 pays in a world's All-in, from its indicated ask. */
function allInFor20(world: FeedWorld) {
  const key = world.opinion?.direction ? `bet:${world.opinion.direction}:1` : "bet:world";
  const ask = world.products.find((p) => p.key === key)?.ask;
  return ask ? 20 / (ask / 1_000_000) : null;
}
/** P(an All-in of this world pays), from the marks. */
function winChance(world: FeedWorld) {
  if (!world.marks) return null;
  const outcome = world.opinion?.direction
    ? { kind: world.opinion.direction, strike: 1 }
    : { kind: "world" };
  return outcomeAtoms(outcome, world.marks.length).reduce((s, a) => s + (world.marks![a] ?? 0), 0);
}

/** A world someone holds a position in, as the public feed shows it: its sentence, its chance
 * and payout at equal weight, who is in, and what to do next. */
export function WorldCard({ world, className }: { world: FeedWorld; className?: string }) {
  const o = world.opinion;
  const sentence = {
    legs: world.legs.map((l) => ({ label: l.label ?? "An event", wantYes: l.wantYes })),
    stock:
      o?.symbol && o.direction && o.strike && o.fixingDate
        ? { symbol: o.symbol, direction: o.direction, strike: o.strike, date: o.fixingDate }
        : null,
  };
  const payout = allInFor20(world);
  const chance = winChance(world);
  const decided = world.decided;
  const latest = world.latest[0];
  return (
    <Link
      href={`/worlds/${world.book}`}
      className={cn(
        "group flex flex-col gap-4 rounded-2xl bg-card p-4 ring-1 ring-border transition-colors outline-none hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5",
        decided && "opacity-75",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          {world.creator && <WalletDot address={world.creator} className="size-4" />}
          <span className="truncate">
            {world.creator ? `${shortWallet(world.creator)} opened` : "Opened"}{" "}
            {ago(world.createdAt)}
          </span>
        </span>
        <span className="shrink-0 tabular-nums">
          {decided
            ? "Settled"
            : world.tradable
              ? `Trades ${until(Number(world.cutoff)) === "now" ? "until now" : `for ${until(Number(world.cutoff))}`}`
              : "Not trading"}
        </span>
      </div>
      <WorldSentence world={sentence} size="card" className="text-foreground/80" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {world.legs.map((l) => (
          <span
            key={l.eventKey}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <VenueMark source={l.source} />
            <span className="tabular-nums">
              {l.outcome !== null
                ? `${l.outcome === "passed" ? "✓" : "✗"} ${venueResult(l.state)}`
                : l.chance !== null
                  ? `${l.wantYes ? "YES" : "NO"} ${Math.round(l.chance / 10_000)}%`
                  : "—"}
            </span>
          </span>
        ))}
        {world.fixingTime && (
          <span className="text-xs text-muted-foreground">
            · {world.opinion?.symbol ?? "the stock"} read {nyDay(Number(world.fixingTime))}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 border-t pt-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">Chance</span>
          <span className="text-base font-medium tabular-nums">
            {chance === null ? "—" : inThousand(chance)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">$20 All-in pays</span>
          <span className="text-base font-medium tabular-nums text-positive">
            {payout === null ? "—" : `${money(payout)} · ${multiple(payout, 20)}`}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">In</span>
          <span className="text-base font-medium tabular-nums">
            {world.traders} {world.traders === 1 ? "trader" : "traders"}
          </span>
        </div>
      </div>
      {latest && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <WalletDot address={latest.taker} className="size-4" />
          <span className="truncate">
            {shortWallet(latest.taker)} {latest.sell ? "cashed out" : `took ${latest.product}`} for{" "}
            {moneyRaw(latest.price)} · {ago(latest.time)}
          </span>
          <span className="ml-auto shrink-0 tabular-nums">
            {moneyRaw(world.staked, { cents: false })} in total
          </span>
        </div>
      )}
    </Link>
  );
}
