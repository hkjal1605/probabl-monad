import { quote, U96_MAX, U128_MAX, WAD } from "@conditional-stocks/evm-client";
import type { MarketState } from "@conditional-stocks/evm-client/ledger";
import type { Reference } from "@conditional-stocks/operator";
import { abs, BPS, ceil, max, min, PROB, type Settings } from "./config.ts";

export type { Reference };

export interface Quote {
  branch: 0 | 1;
  side: 0 | 1;
  level: number;
  /** Quote raw per base raw x 1e18. */
  price: bigint;
  /** Raw base units. */
  quantity: bigint;
}
/** Claims per branch (YES, NO), including the maker's own order reservations. */
export interface Inventory {
  quote: [bigint, bigint];
  base: [bigint, bigint];
}
/** Best foreign bid/ask per branch. */
export type Book = [{ bid?: bigint; ask?: bigint }, { bid?: bigint; ask?: bigint }];

export function fairPrices(spot: bigint, p: bigint, gapBps: number): [bigint, bigint] {
  if (
    spot <= 0n ||
    spot > U128_MAX ||
    p <= 0n ||
    p >= PROB ||
    !Number.isInteger(gapBps) ||
    Math.abs(gapBps) > 7500
  )
    throw new Error("Invalid fair-price input");
  const gap = (spot * BigInt(gapBps)) / BPS;
  // Sy = S + (1-p)D; Sn = S - pD. Rounding error is below one raw X18 unit.
  const yes = spot + ((PROB - p) * gap) / PROB,
    no = spot - (p * gap) / PROB;
  if (yes <= 0n || no <= 0n || yes > U128_MAX || no > U128_MAX)
    throw new Error("Fair price out of bounds");
  return [yes, no];
}
/** Marked inventory in quote raw units. */
export function equity(inv: Inventory, reference: Reference, gapBps: number): bigint {
  const [yes, no] = fairPrices(reference.spot, reference.probability, gapBps),
    p = reference.probability;
  return (
    (inv.quote[0] * p +
      inv.quote[1] * (PROB - p) +
      quote(inv.base[0], yes) * p +
      quote(inv.base[1], no) * (PROB - p)) /
    PROB
  );
}
export function quotes(input: {
  market: MarketState;
  reference: Reference;
  gapBps: number;
  inventory: Inventory;
  /** Reference branch position in raw base units. */
  targetBase: bigint;
  orderQuote: bigint;
  makerBps: number;
  movementBps: bigint;
  settings: Settings;
  best: Book;
}): Quote[] {
  const {
    market: m,
    reference: r,
    settings: s,
    inventory: inv,
    targetBase: target,
    orderQuote: notional,
  } = input;
  if (
    m.tick <= 0n ||
    m.step <= 0n ||
    target <= 0n ||
    [...inv.quote, ...inv.base].some((v) => v < 0n || v > U96_MAX) ||
    notional <= 0n ||
    !Number.isInteger(input.makerBps) ||
    input.makerBps < 0 ||
    input.makerBps > 1000
  )
    throw new Error("Invalid quote inputs");
  const fair = fairPrices(r.spot, r.probability, input.gapBps);
  const uncertainty = ceil(r.spread * BigInt(Math.abs(input.gapBps)), PROB);
  // Sellers receive quote net of fees: 1+f is insufficient at large fee rates.
  const feeEdge = ceil(BigInt(input.makerBps) * BPS, BPS - BigInt(input.makerBps));
  const half = max(
    BigInt(s.halfSpreadBps),
    feeEdge + BigInt(s.adverseSelectionBps) + input.movementBps * 2n + uncertainty,
  );
  if (half > BigInt(s.maxHalfSpreadBps)) return [];
  const budget = min(
    notional,
    m.maxOrder * BigInt(s.quoteLevels),
    m.maxWallet / 4n,
    m.maxMarket / 4n,
  );
  const maxQuantity = m.step * m.maxSteps;
  const output: Quote[] = [];
  const ladder = (o: {
    branch: 0 | 1;
    side: 0 | 1;
    /** Raw base units still allowed on this ladder (bids: buying room). */
    room: bigint;
    /** Bids: quote claims. Asks: base claims. */
    funds: bigint;
    skew: bigint;
    crosses: (price: bigint) => boolean;
  }) => {
    const center = fair[o.branch];
    let remainingRoom = o.room,
      remainingFunds = o.funds,
      remainingBudget = budget,
      previousPrice: bigint | undefined;
    for (let level = 0; level < s.quoteLevels; level++) {
      const edge = half + BigInt(s.levelSpacingBps * level);
      if (edge > BigInt(s.maxHalfSpreadBps)) break;
      const price =
          o.side === 0
            ? ((center * (BPS - edge)) / BPS / m.tick) * m.tick
            : ceil(ceil(center * (BPS + edge), BPS), m.tick) * m.tick,
        levelsLeft = s.quoteLevels - level,
        // Slightly larger outer levels make displayed depth realistic without multiplying the
        // configured per-side budget; the narrow weighting keeps the innermost level above
        // common minimum notionals.
        weight = BigInt(2 * s.quoteLevels + 5 + level),
        remainingWeight = BigInt(
          (levelsLeft * (2 * (2 * s.quoteLevels + 5 + level) + levelsLeft - 1)) / 2,
        ),
        levelBudget = (remainingBudget * weight) / remainingWeight;
      // Tick rounding must not turn two ladder levels into the same book price, and a deeper
      // level may remain passive even when an inner level would cross.
      if (price <= 0n || price > U128_MAX || price === previousPrice || o.crosses(price)) continue;
      let amount =
        (min((levelBudget * WAD) / price, (m.maxOrder * WAD) / price, maxQuantity, remainingRoom) *
          o.skew) /
        BPS;
      amount =
        (min(amount, o.side === 0 ? (remainingFunds * WAD) / price : remainingFunds) / m.step) *
        m.step;
      const cost = quote(amount, price, true);
      if (
        amount <= 0n ||
        quote(amount, price) < m.minNotional ||
        cost > m.maxOrder ||
        cost > levelBudget
      )
        continue;
      const reserved = o.side === 0 ? cost : amount;
      if (reserved > remainingFunds) continue;
      output.push({ branch: o.branch, side: o.side, level, price, quantity: amount });
      previousPrice = price;
      remainingRoom -= amount;
      remainingBudget -= cost;
      remainingFunds -= reserved;
    }
  };
  for (const branch of [0, 1] as const) {
    const top = input.best[branch],
      held = inv.base[branch],
      room = max(0n, 2n * target - held);
    ladder({
      branch,
      side: 0,
      room,
      funds: inv.quote[branch],
      skew: min(BPS, (room * BPS) / target),
      crosses: (price) => top.ask !== undefined && price >= top.ask,
    });
    if (held > 0n)
      ladder({
        branch,
        side: 1,
        room: held,
        funds: held,
        skew: min(BPS, (held * BPS) / target),
        crosses: (price) => top.bid !== undefined && price <= top.bid,
      });
  }
  return output;
}
export function needsReplace(
  old: { price: bigint; remaining: bigint; expiry: bigint },
  desired: Quote,
  now: bigint,
  s: Settings,
) {
  return (
    old.expiry <= now + BigInt(Math.ceil(s.pollMs / 1000) * 2) ||
    abs(old.price - desired.price) * BPS >= desired.price * BigInt(s.repriceBps) ||
    abs(old.remaining - desired.quantity) * 4n >= max(old.remaining, desired.quantity)
  );
}
