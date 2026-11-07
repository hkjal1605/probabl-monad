import { cn } from "@/lib/utils";
import { ago, moneyRaw, shortWallet } from "@/lib/worlds/format";
import type { Holder, WorldFill } from "@/lib/worlds/types";
import { WalletDot } from "./primitives";

const sideOf = (h: Holder) => {
  const o = h.outcomes.find((x) => x.outcome)?.outcome;
  return o?.kind === "above" ? "above" : o?.kind === "below" ? "below" : null;
};

/** Everyone in a world and what they hold: positions are public, as fills are on chain. */
export function HolderList({
  holders,
  you,
  direction,
  decided = false,
}: {
  holders: Holder[];
  you: string | null;
  /** A settled world shows what each holder got. */
  decided?: boolean;
  /** The world's own side (its opener's); holders on the other side are marked. */
  direction: "above" | "below" | null;
}) {
  if (!holders.length)
    return <p className="text-sm text-muted-foreground">No one holds a position yet.</p>;
  return (
    <ul className="flex flex-col">
      {holders.map((h) => {
        const side = sideOf(h);
        const other = direction && side && side !== direction;
        const mine = you?.toLowerCase() === h.owner.toLowerCase();
        return (
          <li key={h.owner} className="flex items-center gap-3 border-b py-3 last:border-b-0">
            <WalletDot address={h.owner} className="size-7" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm">
                {mine ? "You" : shortWallet(h.owner)}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                    h.product === "Money-back"
                      ? "bg-info-soft text-info"
                      : "bg-brand-soft text-brand-strong",
                  )}
                >
                  {h.product}
                </span>
                {other && (
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    other side · {side}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">since {ago(h.since)}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5 text-right">
              <span className="text-sm font-medium tabular-nums">{moneyRaw(h.paid)}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {decided
                  ? `got ${moneyRaw(h.value ?? "0", { cents: false })}`
                  : `pays ${moneyRaw(h.maxPayout, { cents: false })}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A world's trades, newest first. */
export function ActivityList({ fills, vaults }: { fills: WorldFill[]; vaults: string[] }) {
  const takers = fills.filter((f) => !vaults.includes(f.taker.toLowerCase()));
  if (!takers.length) return <p className="text-sm text-muted-foreground">No trades yet.</p>;
  return (
    <ul className="flex flex-col">
      {takers.slice(0, 20).map((f) => (
        <li
          key={`${f.transactionHash}:${f.taker}:${f.time}`}
          className="flex items-center gap-3 py-2 text-sm"
        >
          <WalletDot address={f.taker} className="size-4" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="text-foreground">{shortWallet(f.taker)}</span>{" "}
            {f.sell
              ? "cashed out for"
              : `took ${BigInt(f.refund) > 0n ? "Money-back" : "All-in"} for`}{" "}
            <span className="text-foreground tabular-nums">{moneyRaw(f.price)}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{ago(f.time)}</span>
        </li>
      ))}
    </ul>
  );
}
