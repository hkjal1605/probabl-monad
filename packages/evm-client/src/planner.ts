import {
  MAX_FEE_BPS,
  MAX_MAKERS,
  type OrderWire,
  packMakers,
  packPlan,
  parseOrder,
  type QuoteFill,
  quote,
  U32_MAX,
  U96_MAX,
  unpackOrder,
  unsigned,
} from "./protocol.ts";

/** A live resting order the planner may match (liveness is the caller's filter). */
export interface Candidate {
  order: OrderWire;
  /** Order key (decimal string). */
  key: string;
  sequence: bigint;
  remaining: bigint;
}

export interface AtomicPlan {
  /** Branch sequence observed by the planner; every maker is older. */
  nextSequence: string;
  /** The market's fee rates (display only; signed caps bind on chain). */
  makerFeeBps: number;
  takerFeeBps: number;
  /** Maker order keys and their sequences, best price first, FIFO within a price. */
  makers: string[];
  sequences: string[];
  /** Planned fill per maker and each maker's remaining at planning (review only: on chain,
   * makers fill greedily in order, each capped by what remains). */
  quantities: string[];
  expectedRemaining: string[];
  /** Least total fill: one step for immediate-or-cancel takers with makers, else zero. */
  minFill: string;
  deadline: string;
  filledQuantity: string;
  remainingQuantity: string;
  executionQuote: string;
  /** Signed RFQ quotes the placement fills first, each up to its `fill` (`placeWithQuotes`);
   * the makers above then fill what remains. */
  quotes?: QuoteFill[];
}

/** Best-price, FIFO-within-price planner over the confirmed book. */
export function planOrder(input: {
  order: OrderWire;
  candidates: Candidate[];
  now: bigint;
  step: bigint;
  nextSequence: bigint;
  makerFeeBps: number;
  takerFeeBps: number;
  maxMakers?: number;
}): AtomicPlan {
  const taker = parseOrder(input.order);
  const maxMakers = input.maxMakers ?? MAX_MAKERS;
  if (!Number.isInteger(maxMakers) || maxMakers < 0 || maxMakers > MAX_MAKERS)
    throw new Error("Invalid maker cap");
  if (
    input.step <= 0n ||
    BigInt(taker.quantity) % input.step !== 0n ||
    BigInt(taker.expiry) <= input.now ||
    input.nextSequence < 0n ||
    input.nextSequence >= U32_MAX
  )
    throw new Error("Invalid order or book sequence");
  for (const rate of [input.makerFeeBps, input.takerFeeBps])
    if (!Number.isInteger(rate) || rate < 0 || rate > MAX_FEE_BPS)
      throw new Error("Invalid fee rate");
  const limit = BigInt(taker.limitPriceRawX18);
  const seen = new Set<string>();
  const eligible = input.candidates
    .filter((c) => {
      const o = parseOrder(c.order);
      if (
        seen.has(c.key) ||
        o.marketId !== taker.marketId ||
        o.branch !== taker.branch ||
        o.side === taker.side ||
        o.tif !== 0 ||
        c.remaining <= 0n ||
        c.remaining > BigInt(o.quantity) ||
        c.remaining % input.step !== 0n ||
        c.sequence < 0n ||
        c.sequence >= input.nextSequence
      )
        throw new Error("Invalid canonical candidate");
      seen.add(c.key);
      const price = BigInt(o.limitPriceRawX18);
      return (
        BigInt(o.expiry) > input.now &&
        o.maxFeeBps >= input.makerFeeBps &&
        (taker.side === 0 ? price <= limit : price >= limit)
      );
    })
    .sort((a, b) => {
      const ap = BigInt(a.order.limitPriceRawX18),
        bp = BigInt(b.order.limitPriceRawX18);
      if (ap !== bp) return (ap < bp ? -1 : 1) * (taker.side === 0 ? 1 : -1);
      return a.sequence < b.sequence ? -1 : 1;
    });
  let remaining = BigInt(taker.quantity),
    execution = 0n;
  let deadline = input.now + 60n < BigInt(taker.expiry) ? input.now + 60n : BigInt(taker.expiry);
  const makers: string[] = [],
    sequences: string[] = [],
    quantities: string[] = [],
    expectedRemaining: string[] = [];
  for (const c of eligible) {
    if (remaining === 0n) break;
    if (makers.length === maxMakers) {
      // Immediate-or-cancel fills what one transaction carries and releases the rest; a
      // resting remainder would rest crossed.
      if (taker.tif === 1) break;
      throw new Error(`Order crosses more than ${maxMakers} makers; reduce quantity`);
    }
    const amount = remaining < c.remaining ? remaining : c.remaining;
    const payment = quote(amount, BigInt(c.order.limitPriceRawX18));
    if (payment === 0n) throw new Error("Fill rounds to zero quote");
    makers.push(c.key);
    sequences.push(c.sequence.toString());
    quantities.push(amount.toString());
    expectedRemaining.push(c.remaining.toString());
    remaining -= amount;
    execution += payment;
    if (BigInt(c.order.expiry) < deadline) deadline = BigInt(c.order.expiry);
  }
  if (makers.length && taker.maxFeeBps < input.takerFeeBps)
    throw new Error("Order fee cap is below the taker rate");
  // The contract accepts it, but a maker capped below the rate is skipped by every fill.
  if (taker.tif === 0 && remaining > 0n && taker.maxFeeBps < input.makerFeeBps)
    throw new Error("Order fee cap is below the maker rate, so its resting remainder never fills");
  return {
    nextSequence: input.nextSequence.toString(),
    makerFeeBps: input.makerFeeBps,
    takerFeeBps: input.takerFeeBps,
    makers,
    sequences,
    quantities,
    expectedRemaining,
    minFill: (taker.tif === 1 && makers.length ? input.step : 0n).toString(),
    deadline: deadline.toString(),
    filledQuantity: (BigInt(taker.quantity) - remaining).toString(),
    remainingQuantity: remaining.toString(),
    executionQuote: execution.toString(),
  };
}

/** Structural check of an untrusted (API-supplied) plan against the reviewed order. Prices and
 * liveness are rechecked on chain; this binds totals shown to the user to the plan signed. */
export function parseAtomicPlan(value: unknown, order: OrderWire): AtomicPlan {
  if (!value || typeof value !== "object") throw new Error("Missing execution plan");
  const p = value as AtomicPlan;
  const o = parseOrder(order);
  if (
    !Array.isArray(p.makers) ||
    !Array.isArray(p.sequences) ||
    !Array.isArray(p.quantities) ||
    !Array.isArray(p.expectedRemaining) ||
    p.makers.length > MAX_MAKERS ||
    [p.sequences, p.quantities, p.expectedRemaining].some((list) => list.length !== p.makers.length)
  )
    throw new Error("Invalid execution plan");
  const next = unsigned(p.nextSequence, U32_MAX);
  let remaining = BigInt(o.quantity);
  const seen = new Set<string>();
  for (const [i, key] of p.makers.entries()) {
    const seq = unsigned(p.sequences[i], U32_MAX),
      quantity = unsigned(p.quantities[i]),
      expected = unsigned(p.expectedRemaining[i]),
      parsed = BigInt(unsigned(key));
    if (
      seen.has(key) ||
      seq >= next ||
      (parsed & U32_MAX) !== seq ||
      Number(parsed >> 40n) !== Number(o.marketId) ||
      Number((parsed >> 32n) & 1n) !== o.branch ||
      quantity === 0n ||
      quantity > expected ||
      quantity > remaining
    )
      throw new Error("Invalid maker leg");
    seen.add(key);
    remaining -= quantity;
  }
  if (p.quotes !== undefined) {
    if (!Array.isArray(p.quotes) || p.quotes.length > MAX_MAKERS)
      throw new Error("Invalid execution plan");
    for (const q of p.quotes) {
      const terms = unpackOrder(unsigned(q?.terms, (1n << 256n) - 1n));
      const fill = unsigned(q.fill, U96_MAX);
      unsigned(q.nonce, (1n << 256n) - 1n);
      if (
        terms.market !== Number(o.marketId) ||
        terms.branch !== o.branch ||
        terms.side === o.side ||
        fill === 0n ||
        fill > terms.quantity ||
        fill > remaining ||
        ![q.r, q.vs].every((word) => typeof word === "string" && /^0x[0-9a-fA-F]{64}$/.test(word))
      )
        throw new Error("Invalid quote leg");
      remaining -= fill;
    }
  }
  for (const rate of [p.makerFeeBps, p.takerFeeBps])
    if (!Number.isInteger(rate) || rate < 0 || rate > MAX_FEE_BPS)
      throw new Error("Invalid fee guard");
  if ((p.makers.length || p.quotes?.length) && p.takerFeeBps > o.maxFeeBps)
    throw new Error("Taker fee exceeds cap");
  const minFill = unsigned(p.minFill);
  if (
    unsigned(p.deadline) > BigInt(o.expiry) ||
    remaining !== unsigned(p.remainingQuantity) ||
    BigInt(o.quantity) - remaining !== unsigned(p.filledQuantity) ||
    minFill > BigInt(o.quantity) - remaining
  )
    throw new Error("Plan totals or expiry differ");
  unsigned(p.executionQuote);
  return p;
}

/** The plan and maker words of `place`/`placeFor`. */
export const planWords = (plan: AtomicPlan) => ({
  plan: packPlan(BigInt(plan.nextSequence), BigInt(plan.deadline), BigInt(plan.minFill)),
  makers: packMakers(plan.sequences.map(BigInt)),
});
