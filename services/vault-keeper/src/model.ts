/** The Δ-model (docs/delta-vault.md): the stock price s and the event probability p come from
 * outside; the vault learns only the conditional gap δ̂ from its own fills. Branch fair prices
 * satisfy s = p·Y + (1−p)·N:
 *
 *   Y = s·(1 + (1−p)·δ̂)   N = s·(1 − p·δ̂)
 *
 * δ̂ is stateless: the anchor moved against the vault's YES-minus-NO stock imbalance, measured as
 * a share of its stock inventory, so deposits and withdrawals (which scale both) never move it.
 * Every function here is pure; prices are raw quote per raw base x 1e18. */
import { makerFeeEdge, quote, U128_MAX, WAD } from "@conditional-stocks/evm-client";
import { abs, BPS, ceil, max, min, PROB } from "@conditional-stocks/operator";
import type { LadderDriver, MarketModel } from "./config.ts";

export const PPM = 1_000_000n;

export interface Quote {
  branch: 0 | 1;
  /** 0 bid, 1 ask. */
  side: 0 | 1;
  level: number;
  price: bigint;
  /** Raw base units. */
  quantity: bigint;
  /** 0 plain credit, 1 the branch's claims. */
  funding: 0 | 1;
  /** The resting order kept as this quote; absent for a quote to place. */
  key?: bigint;
}
/** A resting order of the vault's that a ladder may keep as one of its quotes. */
export interface Resting {
  key: bigint;
  branch: 0 | 1;
  side: 0 | 1;
  price: bigint;
  /** Remaining raw base units. */
  quantity: bigint;
  funding: 0 | 1;
}
/** Best foreign bid and ask per branch. */
export type Book = [{ bid?: bigint; ask?: bigint }, { bid?: bigint; ask?: bigint }];
/** What quotes may reserve: plain credit and each branch's claims (YES, NO). */
export interface Funds {
  quote: bigint;
  base: bigint;
  quoteClaims: [bigint, bigint];
  baseClaims: [bigint, bigint];
}
export interface Terms {
  tick: bigint;
  step: bigint;
  maxSteps: bigint;
  minNotional: bigint;
  maxOrder: bigint;
}

/** Φ⁻¹(p), the standard normal quantile (Acklam's rational approximation, relative error under
 * 1.2e-9). */
export function inverseNormal(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error("A probability strictly between 0 and 1");
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ] as const;
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ] as const;
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ] as const;
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416,
  ] as const;
  const tail = (q: number) =>
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5,
    r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** A ladder market's δ₀ in bps: the stock's expected price if the driver closes above the strike
 * minus if it closes below, as a share of spot. With the driver's move to the fixing normal
 * (daily volatility σ, τ days left) and the strike where the event's probability p puts it,
 * that gap is β·σ·√τ·φ(Φ⁻¹(p)) / (p(1−p)): at even odds 1.6·β·σ·√τ, shrinking to 0 at the
 * fixing. `p` is x1e6 and `now` unix seconds; `conditionalGap` bounds the result. */
export function ladderAnchorBps(driver: LadderDriver, p: bigint, now: bigint): number {
  const days = (driver.fixing - Number(now)) / 86_400,
    probability = Number(p) / Number(PROB);
  if (!(days > 0) || !(probability > 0 && probability < 1)) return 0;
  const z = inverseNormal(probability),
    density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const gap =
    (driver.beta * (driver.dailyVolBps / 10_000) * Math.sqrt(days) * density) /
    (probability * (1 - probability));
  return Math.round(gap * 10_000);
}

/** A market's δ₀ in bps: its ladder driver's at `p` and `now`, else its configured anchor. */
export const anchorBps = (model: MarketModel, p: bigint, now: bigint) =>
  model.driver ? ladderAnchorBps(model.driver, p, now) : model.anchorBps;

/** δ̂ in ppm of spot: `anchorBps` moved by `impactBps` per 1% of inventory the vault is long YES
 * (negative) or long NO (positive), scaled by `widen` (x1e4) and bounded by `maxGapBps`. */
export function conditionalGap(input: {
  anchorBps: number;
  impactBps: number;
  maxGapBps: number;
  imbalance: bigint;
  inventory: bigint;
  widen: bigint;
}): bigint {
  const bound = BigInt(input.maxGapBps) * 100n;
  let gap = BigInt(input.anchorBps) * 100n;
  if (input.inventory > 0n)
    gap -= (BigInt(input.impactBps) * input.imbalance * input.widen) / input.inventory;
  return max(-bound, min(bound, gap));
}

/** Fair YES and NO branch prices around `spot` for probability `p` (x1e6) and gap (ppm). */
export function fairPrices(spot: bigint, p: bigint, gapPpm: bigint): [bigint, bigint] {
  if (spot <= 0n || spot > U128_MAX || p <= 0n || p >= PROB || abs(gapPpm) >= PPM)
    throw new Error("Invalid fair-price input");
  const yes = spot + (spot * gapPpm * (PROB - p)) / (PPM * PROB),
    no = spot - (spot * gapPpm * p) / (PPM * PROB);
  if (yes <= 0n || no <= 0n || yes > U128_MAX || no > U128_MAX)
    throw new Error("Fair price out of bounds");
  return [yes, no];
}

/** The YES probability (x1e6) other traders' books imply, from s = p·Y + (1−p)·N with Y and N
 * the foreign mid-prices of each branch, or null when either branch lacks a two-sided book or the
 * branches are too close together (`minGapBps` of spot) to tell p apart. */
export function impliedProbability(book: Book, spot: bigint, minGapBps = 50): bigint | null {
  const mid = (side: { bid?: bigint; ask?: bigint }) =>
    side.bid !== undefined && side.ask !== undefined && side.bid < side.ask
      ? (side.bid + side.ask) / 2n
      : null;
  const yes = mid(book[0]),
    no = mid(book[1]);
  if (yes === null || no === null || abs(yes - no) * BPS < spot * BigInt(minGapBps)) return null;
  const p = ((spot - no) * PROB) / (yes - no);
  return max(0n, min(PROB, p));
}

/** Spread multiplier (x1e4) ramping from 1x to `factor`x over the last `window` seconds before
 * quoting stops: informed flow concentrates near resolution. */
export function widening(secondsLeft: bigint, window: number, factor: number): bigint {
  if (window <= 0 || secondsLeft >= BigInt(window)) return BPS;
  const left = secondsLeft < 0n ? 0n : secondsLeft;
  return (
    BPS + ((BigInt(Math.round(factor * 10_000)) - BPS) * (BigInt(window) - left)) / BigInt(window)
  );
}

/** Half-spread in bps of the branch price. A probability error dp moves both branch prices by
 * s·δ̂·dp, so the event market's spread widens quotes in proportion to |δ̂|. */
export function halfSpread(input: {
  minBps: number;
  makerBps: number;
  takerBps: number;
  /** The market's maker rebate, in bps of the taker fee. */
  rebateBps: number;
  adverseSelectionBps: number;
  movementBps: bigint;
  probabilitySpread: bigint;
  gapPpm: bigint;
  widen: bigint;
}): bigint {
  // Sellers receive quote net of fees (1+f is insufficient at large fee rates); the maker
  // rebate comes back on every fill, so it narrows the quotes, never below the minimum.
  const feeEdge = makerFeeEdge(input);
  const uncertainty = ceil(input.probabilitySpread * abs(input.gapPpm), PROB * 100n);
  const base = max(
    BigInt(input.minBps),
    feeEdge + BigInt(input.adverseSelectionBps) + input.movementBps * 2n + uncertainty,
  );
  return ceil(base * input.widen, BPS);
}

/** Probability-weighted quote value of the vault's holdings at fair branch prices. `marks` gives
 * each market's probability and gap; plain stock is worth spot in every world. */
export function markedValue(
  holdings: {
    quote: bigint;
    base: bigint;
    markets: {
      market: number;
      claims: { yesQuote: bigint; noQuote: bigint; yesBase: bigint; noBase: bigint };
    }[];
  },
  spot: bigint,
  marks: (market: number) => { probability: bigint; gapPpm: bigint },
): bigint {
  let value = holdings.quote + quote(holdings.base, spot);
  for (const m of holdings.markets) {
    const { probability: p, gapPpm } = marks(m.market);
    const [yes, no] = fairPrices(spot, p, gapPpm);
    const c = m.claims;
    value +=
      ((c.yesQuote + quote(c.yesBase, yes)) * p + (c.noQuote + quote(c.noBase, no)) * (PROB - p)) /
      PROB;
  }
  return value;
}

/** The four quote ladders of one market. Every quote rests passively inside the vault's oracle
 * band (less a margin for oracle updates in flight), never crosses a foreign order, fits the
 * exchange and vault size limits, and is funded: bids by quote, asks by stock, each from the
 * branch's claims first (which also nets the vault's unpaired claims) and plain credit after.
 * The imbalance room and the resting-notional budget bound the ladders together, so the vault's
 * worst-case YES-minus-NO stock stays within its cap if every quote filled.
 * A resting quote stays as its level's quote while priced within `repriceBps` of the level, at
 * least 3/4 of the level's size and within every limit as it rests (the limits then count what
 * it holds), so small moves cost no transaction: sizes are budgets over prices, and a price up
 * a fraction of a bp can take a step off the level's size. */
export function ladders(input: {
  terms: Terms;
  fair: [bigint, bigint];
  /** Bps of the branch price. */
  halfSpread: bigint;
  levels: number;
  levelSpacingBps: number;
  maxHalfSpreadBps: number;
  oracle: bigint;
  bandBps: number;
  bandMarginBps: number;
  /** Quote notional per ladder. */
  budget: bigint;
  maxOrder: bigint;
  maxResting: bigint;
  imbalance: bigint;
  maxImbalance: bigint;
  funds: Funds;
  best: Book;
  /** The vault's resting quotes in the market that may stay (current and not expiring). */
  resting?: Resting[];
  repriceBps?: number;
}): Quote[] {
  const t = input.terms;
  if (t.tick <= 0n || t.step <= 0n || input.oracle <= 0n || input.levels < 1)
    throw new Error("Invalid ladder input");
  const band = (input.oracle * BigInt(Math.max(0, input.bandBps - input.bandMarginBps))) / BPS;
  const orderCap = min(input.maxOrder, t.maxOrder);
  const budget = min(input.budget, input.maxResting / 4n);
  // Room for YES bids and NO asks (they raise YES-minus-NO stock) and for YES asks and NO bids.
  const raise = max(0n, input.maxImbalance - input.imbalance) / 2n,
    lower = max(0n, input.maxImbalance + input.imbalance) / 2n;
  const out: Quote[] = [];
  for (const branch of [0, 1] as const)
    for (const side of [0, 1] as const) {
      const raises = (side === 0) === (branch === 0);
      let room = raises ? raise : lower,
        remainingBudget = budget,
        // Claims belong to one branch; plain credit is shared, half per branch.
        claims = side === 0 ? input.funds.quoteClaims[branch] : input.funds.baseClaims[branch],
        credit = (side === 0 ? input.funds.quote : input.funds.base) / 2n,
        previous: bigint | undefined;
      const top = input.best[branch];
      // Passive, inside the band and not repeating the previous level's price.
      const passive = (price: bigint) =>
        price > 0n &&
        price <= U128_MAX &&
        price !== previous &&
        abs(price - input.oracle) <= band &&
        (side === 0
          ? top.ask === undefined || price < top.ask
          : top.bid === undefined || price > top.bid);
      // The ladder's resting quotes, best price first, each paired with the next quote it takes.
      const resting = (input.resting ?? [])
        .filter((r) => r.branch === branch && r.side === side)
        .sort((a, b) => (a.price === b.price ? 0 : a.price > b.price === (side === 0) ? -1 : 1));
      let taken = 0;
      for (let level = 0; level < input.levels && room > 0n && remainingBudget > 0n; level++) {
        const edge = input.halfSpread + BigInt(input.levelSpacingBps * level);
        if (edge > BigInt(input.maxHalfSpreadBps) || edge >= BPS) break;
        const center = input.fair[branch];
        const price =
          side === 0
            ? ((center * (BPS - edge)) / BPS / t.tick) * t.tick
            : ceil(ceil(center * (BPS + edge), BPS), t.tick) * t.tick;
        if (!passive(price)) continue;
        const levelBudget = remainingBudget / BigInt(input.levels - level);
        const fundable = (reserve: bigint) => (side === 0 ? (reserve * WAD) / price : reserve);
        let quantity = min(
          (levelBudget * WAD) / price,
          (orderCap * WAD) / price,
          t.step * t.maxSteps,
          room,
        );
        const fromClaims = fundable(claims),
          fromCredit = fundable(credit);
        const funding: 0 | 1 = fromClaims >= quantity || fromClaims > fromCredit ? 1 : 0;
        quantity = (min(quantity, funding === 1 ? fromClaims : fromCredit) / t.step) * t.step;
        let q: Quote = { branch, side, level, price, quantity, funding };
        const r = resting[taken];
        if (
          r !== undefined &&
          r.funding === funding &&
          abs(r.price - price) * BPS < price * BigInt(input.repriceBps ?? 0) &&
          (quantity - r.quantity) * 4n < quantity &&
          r.quantity <= min(room, t.step * t.maxSteps) &&
          quote(r.quantity, r.price) >= t.minNotional &&
          passive(r.price)
        ) {
          const cost = quote(r.quantity, r.price, true);
          if (
            cost <= min(orderCap, levelBudget) &&
            (side === 0 ? cost : r.quantity) <= (funding === 1 ? claims : credit)
          )
            q = { ...q, price: r.price, quantity: r.quantity, key: r.key };
        }
        const cost = quote(q.quantity, q.price, true);
        if (q.quantity <= 0n || quote(q.quantity, q.price) < t.minNotional || cost > orderCap)
          continue;
        const reserved = side === 0 ? cost : q.quantity;
        if (funding === 1) claims -= reserved;
        else credit -= reserved;
        room -= q.quantity;
        remainingBudget -= min(remainingBudget, cost);
        previous = q.price;
        taken++;
        out.push(q);
      }
    }
  return out;
}
