/** The Δ-vault's price and size for one RFQ (docs/rfq.md): the Δ-model's fair price for exactly
 * this size, plus the half-spread, within every limit the vault enforces on chain.
 *
 * - Fair price. The stock price s and probability p come from outside; the vault learns only the
 *   conditional gap δ̂, which moves against its YES-minus-NO stock imbalance I. A fill of q shares
 *   walks I by q, and the price walks with it linearly, so the fill's average price is the price
 *   at the walk's midpoint: δ̂(I ± q/2), with Y = s(1 + (1−p)δ̂) and N = s(1 − pδ̂). A large order
 *   pays its own impact; offsetting flow is priced better, which pulls I back to zero.
 * - Spread. The book's half-spread (fee edge, adverse selection, recent movement, the event market's
 *   spread times |δ̂|, widening before the cutoff) plus `edgeBps` for the firm quote's lifetime.
 * - Size. At most what the imbalance cap leaves once every resting order and outstanding quote is
 *   counted as filled, the per-quote notional cap, and what the vault can deliver from one
 *   funding source (branch claims first, which net its position; then credit above the
 *   withdrawal reserve).
 * - Bounds. The price stays a margin inside the vault's band around its oracle (which the vault
 *   checks again at the fill) and within the taker's limit; the quote expires within the vault's
 *   lifetime limit and before its cutoff buffer. */
import { quote as notional } from "@conditional-stocks/evm-client";
import type { MarketState } from "@conditional-stocks/evm-client/ledger";
import { abs, BPS, ceil, max, min, type Reference } from "@conditional-stocks/operator";
import type { MarketModel, Settings } from "./config.ts";
import { conditionalGap, type Funds, fairPrices, halfSpread, widening } from "./model.ts";

const WAD = 10n ** 18n;

/** The market order a request is for. */
export interface RfqOrder {
  branch: 0 | 1;
  /** The taker's side: 0 buys from the vault, 1 sells to it. */
  side: 0 | 1;
  quantity: bigint;
  /** The taker's worst price. */
  limit: bigint;
}
/** The vault's position in the market, outstanding quotes included. */
export interface VaultPosition {
  /** YES-minus-NO stock held (claims and claim-funded escrow). */
  imbalance: bigint;
  /** ...with every resting order and outstanding quote that raises (lowers) it filled. */
  high: bigint;
  low: bigint;
  /** ...with every outstanding quote filled: what the next fill prices from. */
  expected: bigint;
  /** Stock the vault holds for the market (plain plus the branch average of its claims). */
  inventory: bigint;
  /** What a quote may spend: credit above the withdrawal reserve, and branch claims. */
  funds: Funds;
}
export interface PricingInput {
  order: RfqOrder;
  market: Pick<MarketState, "tick" | "step" | "maxSteps" | "makerBps" | "takerBps" | "rebateBps">;
  risk: { bandBps: number; cutoffBuffer: number; maxImbalance: bigint };
  /** The vault market's cutoff (unix seconds). */
  cutoff: number;
  limits: { maxTtl: number; maxFeeBps: number };
  /** The vault's oracle price (exchange units). */
  oracle: bigint;
  model: MarketModel;
  settings: Settings;
  reference: Reference;
  /** Recent movement of the reference, bps (the rounds' exponential average). */
  movementBps: bigint;
  position: VaultPosition;
  /** The most a quote may be worth: the vault's order cap and the model's per-quote budget. */
  maxNotional: bigint;
  /** Now on this host (unix seconds and ms) and at the latest block seen. */
  now: bigint;
  nowMs: number;
  chainTime: bigint;
  /** The API's least quote lifetime. */
  minQuoteSeconds: number;
  /** Testnets only: reference prices may be stale (outside market hours). */
  allowStaleSpot: boolean;
}
export type Pricing =
  | { decline: string }
  | {
      price: bigint;
      quantity: bigint;
      fundingKind: 0 | 1;
      expiry: bigint;
      gapPpm: bigint;
      halfSpreadBps: bigint;
      fair: bigint;
    };

/** YES bids and NO asks raise YES-minus-NO stock; YES asks and NO bids lower it. */
export const raisesImbalance = (o: Pick<RfqOrder, "branch" | "side">) =>
  (o.side === 0) === (o.branch === 1);

export function priceRfq(i: PricingInput): Pricing {
  const { order: o, market: m, settings: set, reference: r, position: pos } = i;
  const decline = (reason: string) => ({ decline: reason });
  const stopAt = BigInt(i.cutoff - i.risk.cutoffBuffer);
  const expiry = min(
    i.now + BigInt(set.rfq.quoteTtlSeconds),
    i.chainTime + BigInt(i.limits.maxTtl),
    stopAt,
  );
  if (expiry < i.now + BigInt(i.minQuoteSeconds)) return decline("Quoting window closed");
  if (m.makerBps > i.limits.maxFeeBps) return decline("Market maker fee exceeds the vault cap");
  if (i.nowMs - r.observedAt > set.rfq.maxReferenceAgeMs || r.observedAt > i.nowMs + 5_000)
    return decline("Reference is stale");
  if (!i.allowStaleSpot && Math.abs(r.spotAt - r.probabilityAt) > set.maxSkewMs)
    return decline("Stock price and probability were observed too far apart");
  if (abs(r.spot - i.oracle) * BPS > i.oracle * BigInt(set.maxOracleDeviationBps))
    return decline("Reference price and the vault oracle disagree");

  const sells = o.side === 0,
    raises = raisesImbalance(o),
    step = m.step,
    floor = (q: bigint) => (q / step) * step;
  const cap = i.risk.maxImbalance;
  // An imbalance already beyond the cap (after a cap cut) may shrink but not grow, as on chain.
  const room = raises
    ? max(0n, max(cap, pos.imbalance) - pos.high)
    : max(0n, pos.low - min(-cap, pos.imbalance));
  const claims = sells ? pos.funds.baseClaims[o.branch] : pos.funds.quoteClaims[o.branch];
  const credit = sells ? pos.funds.base : pos.funds.quote;
  const deliverable = max(claims, credit);
  const widen = widening(stopAt - i.now, set.wideningSeconds, set.wideningFactor);
  const band = (i.oracle * BigInt(Math.max(0, i.risk.bandBps - set.bandMarginBps))) / BPS;

  /** The fill's average price for `q` shares: the price at the midpoint of its walk. */
  const priceAt = (q: bigint) => {
    const half = q / 2n;
    const gapPpm = conditionalGap({
      anchorBps: i.model.anchorBps,
      impactBps: i.model.impactBps,
      maxGapBps: i.model.maxGapBps,
      imbalance: pos.expected + (raises ? half : -half),
      inventory: pos.inventory,
      widen,
    });
    const fair = fairPrices(r.spot, r.probability, gapPpm)[o.branch];
    const halfSpreadBps =
      halfSpread({
        minBps: set.halfSpreadBps,
        makerBps: m.makerBps,
        takerBps: m.takerBps,
        rebateBps: m.rebateBps,
        adverseSelectionBps: set.adverseSelectionBps,
        movementBps: i.movementBps,
        probabilitySpread: r.spread,
        gapPpm,
        widen,
      }) + BigInt(set.rfq.edgeBps);
    if (halfSpreadBps > BigInt(set.maxHalfSpreadBps) || halfSpreadBps >= BPS)
      return decline("The spread would pass the vault's limit");
    const price = sells
      ? ceil(ceil(fair * (BPS + halfSpreadBps), BPS), m.tick) * m.tick
      : ((fair * (BPS - halfSpreadBps)) / BPS / m.tick) * m.tick;
    if (price <= 0n || abs(price - i.oracle) > band)
      return decline("The price would leave the vault's band");
    if (sells ? price > o.limit : price < o.limit)
      return decline("The vault's price is beyond the order's limit");
    return { price, gapPpm, halfSpreadBps, fair };
  };

  let quantity = floor(min(o.quantity, room, step * m.maxSteps, sells ? deliverable : o.quantity));
  // The size sets the price and the price the notional caps: settle both (a smaller size only
  // improves the price, so this converges within a few passes).
  for (let pass = 0; pass < 6; pass++) {
    if (quantity < step) return decline("No capacity for this order within the vault's limits");
    const priced = priceAt(quantity);
    if ("decline" in priced) return priced;
    const cost = notional(quantity, priced.price, true);
    let next = quantity;
    if (cost > i.maxNotional) next = min(next, (i.maxNotional * WAD) / priced.price);
    if (!sells && cost > deliverable) next = min(next, (deliverable * WAD) / priced.price);
    next = floor(next);
    if (next === quantity) {
      const spent = sells ? quantity : cost;
      return { ...priced, quantity, expiry, fundingKind: claims >= spent ? 1 : 0 };
    }
    quantity = next;
  }
  return decline("No stable size within the vault's limits");
}
