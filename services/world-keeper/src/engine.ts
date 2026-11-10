/** The world vault's market maker (docs/version-2-plan.md §7–8, research spec).
 *
 * Models: every tradable book's model (`buildBookModel`) is rebuilt off the request path when
 * its inputs move (a leg's probability, the spot, the clock) and at least once a minute, and
 * cached. A quote reads only memory: the cached model, the replica, the live references and the
 * in-flight quotes — no RPC, no database, no model call — and is signed at once.
 *
 * Quotes: a buy of a bundle (or as many units as a stake buys), or a cash-out bid. The price is
 * `priceBundle`'s, with its guards, then every limit: the vault's own hook (mirrored exactly), its
 * caps on the state after every outstanding quote, and the keeper's soft limits (per fill, per
 * book at most quarter Kelly, per leg, per theme comonotone, utilization, per requester).
 * Housekeeping redeems decided books, merges full sets, and latches a halt on a drawdown. */
import type { WorldBookRecord } from "@conditional-stocks/db";
import {
  atomCount,
  BOOK_STATE,
  BOOK_STATUS,
  type BookDef,
  bookDefHash,
  bundlePays,
  contractQuoteNonce,
  packMakerData,
  payRange,
  standardProducts,
  underlyingId,
  WORLD_QUOTE_TYPES,
  type WorldQuote,
  worldQuoteDomain,
  worldQuoteMessage,
  worldVaultCalls,
} from "@conditional-stocks/evm-client";
import type { WorldTouched } from "@conditional-stocks/evm-client/world-ledger";
import {
  atomsOf,
  type BookState,
  bookStateAt,
  fillRecord,
  type VaultState,
  type WorldEvent,
  type WorldState,
  winningAtom,
  worldCreditOf,
} from "@conditional-stocks/evm-client/world-ledger";
import { vaultHookProblem } from "@conditional-stocks/evm-client/world-risk";
import type { ChainFollower } from "@conditional-stocks/indexer";
import type { Executor } from "@conditional-stocks/operator";
import { type Address, type Hex, zeroHash } from "viem";
import type { LocalAccount } from "viem/accounts";
import type { Settings } from "./config.ts";
import { buildInputs, type OpenLeg, type PricingData } from "./inputs.ts";
import { type BookModel, buildBookModel, bundleSensitivity } from "./model/book.ts";
import { fisherZ, fromZ, themePrior } from "./model/correlation.ts";
import { allPassProbability } from "./model/joint.ts";
import { guardQuote, priceBundle, type Quote, unitsForStake } from "./pricing.ts";
import type { LegReferences, SpotReferences } from "./references.ts";
import { type BookRisk, Requesters, RiskEngine } from "./risk.ts";
import type { KeeperState } from "./state.ts";

export const log = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ event, ...detail }, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

/** A world order as the RFQ stream sends it (`world.rfq`'s `order`). */
export interface WorldOrderRequest {
  taker: Address;
  book: number;
  mask: number;
  side: "buy" | "sell";
  units: bigint | null;
  refund: bigint;
  stake: bigint | null;
  conditional: boolean;
  limit: bigint;
}
export type Priced =
  | { decline: string }
  | {
      quote: WorldQuote;
      fair: number;
      markup: number;
      components: Quote["components"];
      capital: bigint;
      exposure: bigint;
      atoms: bigint[];
      cost: bigint;
    };

interface Cached {
  model: BookModel;
  legs: OpenLeg[];
  priorOnly: boolean;
  risk: BookRisk;
  key: string;
  builtAt: number;
  /** The spot the model was built at (feed units), for a priced book. */
  spot: number | null;
}

/** What a world page explains a book's price with, from its cached model (chances x 1e6):
 * each open leg's own chance, the chance chain in book order (scaled so its end is the
 * marks' P(W)) and the same chain were the legs unrelated, the stock's spot and its forward
 * inside the world, and the one-standard-deviation move to the fixing. */
export interface BookAnalytics {
  legs: { eventKey: Hex; chance: number }[];
  chain: number[];
  naive: number[];
  world: number;
  spot: number | null;
  forward: number | null;
  move: number | null;
}
const x6 = (p: number) => Math.min(1_000_000, Math.max(0, Math.round(p * 1e6)));
export function analyticsOf(c: Pick<Cached, "model" | "legs" | "spot">): BookAnalytics {
  const m = c.model;
  const n = m.chain.length;
  const ratio = m.world > 0 ? m.worldCenter / m.world : 1;
  return {
    legs: c.legs.map((l, i) => ({ eventKey: l.key, chance: x6(m.legInfo[i]!.q) })),
    chain: m.chain.map((p, k) => x6(p * ratio ** ((k + 1) / n))),
    naive: m.naive.map(x6),
    world: x6(m.worldCenter),
    spot: c.spot,
    forward: m.forward,
    move: m.variance === null ? null : Math.round(Math.sqrt(m.variance) * 1e6),
  };
}

/** A world not created yet, as the API describes one to price (`world.preview`): its legs as
 * the venue lists them with a reference probability each (used when the keeper does not follow
 * the leg), and for a priced world its feed, strikes and fixing, with a spot in feed units. */
export interface PreviewBook {
  legs: (WorldBookRecord["metadata"]["legs"][number] & {
    reference: { yes: number; halfSpread: number; observedAtMs: number } | null;
  })[];
  feed: Address;
  underlying: string | null;
  feedDecimals: number | null;
  fixingTime: number;
  cutoff: number;
  maxStaleness: number;
  strikes: bigint[];
  feeBps: number;
  spot: number | null;
}
/** Why `review` names a standing quote: it ran out unaccepted, or the price moved against it.
 * Either way the vault quotes the open request afresh. */
export const QUOTE_EXPIRED = "Expired";
export const PRICE_MOVED = "The price moved";
/** The book id a preview prices under: never a real book's (ids are sequential from 1). */
export const PREVIEW_BOOK = 2 ** 48;
/** How old a preview's reference probability may be. */
const PREVIEW_REFERENCE_MS = 15 * 60_000;

const MODEL_MAX_AGE_MS = 60_000;
const MODEL_MIN_INTERVAL_MS = 1_000;
const seconds = (ms = Date.now()) => BigInt(Math.floor(ms / 1000));

export class WorldKeeper {
  readonly risk: RiskEngine;
  readonly requesters = new Requesters();
  private readonly models = new Map<number, Cached>();
  /** Every book's last center, kept after it stops trading, for marks. */
  readonly centers = new Map<number, Float64Array>();
  /** In-flight quotes by `nonce`, to release them when the replica shows their fill. */
  private readonly byNonce = new Map<bigint, string>();
  /** Quotes standing on open requests, by request: the bundle signed, the margin it had over
   * the book's fair value, and the model it was last looked at against. */
  private readonly standing = new Map<
    string,
    { quote: WorldQuote; edge: number; model: BookModel | null }
  >();
  stopped = false;

  constructor(
    readonly options: {
      follower: ChainFollower<WorldState, WorldTouched, WorldEvent>;
      settings: Settings;
      chainId: number;
      legs: LegReferences;
      spot: SpotReferences;
      /** Book metadata by book id (registered legs' venue events). */
      metadata: () => ReadonlyMap<number, WorldBookRecord>;
      data: () => PricingData;
      state: KeeperState;
      save: () => void | Promise<void>;
      /** The keeper key; absent in dry-run. */
      account?: LocalAccount;
      executor?: Executor;
      now?: () => number;
    },
  ) {
    this.risk = new RiskEngine(options.settings.vault, options.settings.risk, (a, b) =>
      this.unionWorld(a, b),
    );
    this.requesters.restore(options.state.requesters);
  }

  get vault() {
    return this.options.settings.vault;
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private state(): { s: WorldState; v: VaultState } | null {
    const s = this.options.follower.confirmed;
    const v = s.vaults.get(this.vault);
    return v ? { s, v } : null;
  }
  /** The NAV limits are measured against: the vault's reference value. */
  nav(v: VaultState) {
    return v.refNav;
  }
  /** Every modelled book's risk view, for cross-book limits. */
  bookRisks(): Map<number, BookRisk> {
    const out = new Map<number, BookRisk>();
    for (const [id, c] of this.models) out.set(id, { ...c.risk, model: c.model });
    // Books the vault holds positions in but cannot model still count, unmodelled.
    const st = this.state();
    if (st)
      for (const id of st.v.positions.keys())
        if (!out.has(id)) {
          const b = st.s.books.get(id);
          const meta = this.options.metadata().get(id);
          if (b)
            out.set(id, {
              book: b,
              model: null,
              legs: b.def.legs.map((l, i) => ({
                key: l.eventKey,
                wantYes: l.wantYes,
                themes: meta?.metadata.legs[i]?.themes ?? [],
              })),
            });
        }
    return out;
  }

  // ---------------------------------------------------------------- models

  /** Rebuilds the models whose inputs moved (or aged); returns how many were rebuilt. */
  refresh(force = false) {
    const st = this.state();
    if (!st) return 0;
    const { s } = st;
    const nowMs = this.now();
    const metas = this.options.metadata();
    let rebuilt = 0;
    for (const b of s.books.values()) {
      if (bookStateAt(s, b, seconds(nowMs)) !== BOOK_STATE.trading) {
        if (this.models.delete(b.id)) this.risk.forget(b.id);
        continue;
      }
      const meta = metas.get(b.id);
      if (!meta) continue;
      const cached = this.models.get(b.id);
      if (!force && cached && nowMs - cached.builtAt < MODEL_MIN_INTERVAL_MS) continue;
      const built = buildInputs({
        s,
        book: b,
        meta,
        legsRef: this.options.legs,
        spotRef: this.options.spot,
        data: this.options.data(),
        settings: this.options.settings,
        nowMs,
      });
      if ("problem" in built) {
        if (this.models.delete(b.id)) this.risk.forget(b.id);
        continue;
      }
      // Inputs rounded to what moves a price: the model is rebuilt when one of them moves.
      const key = JSON.stringify([
        built.inputs.legs.map((l) => [l.yes.toFixed(4), l.halfSpread.toFixed(4)]),
        built.inputs.stock ? Math.round(Math.log(built.inputs.stock.spot) * 1e4) : null,
        built.inputs.logic,
      ]);
      if (!force && cached?.key === key && nowMs - cached.builtAt < MODEL_MAX_AGE_MS) continue;
      try {
        const model = buildBookModel(built.inputs);
        this.models.set(b.id, {
          model,
          legs: built.legs,
          priorOnly: built.priorOnly,
          risk: { ...built.risk, model },
          key,
          builtAt: nowMs,
          spot: built.inputs.stock?.spot ?? null,
        });
        this.centers.set(b.id, model.center);
        this.risk.forget(b.id);
        rebuilt++;
      } catch (error) {
        log("model-failed", { book: b.id, reason: (error as Error).message });
        this.models.delete(b.id);
      }
    }
    return rebuilt;
  }
  model(book: number) {
    return this.models.get(book)?.model;
  }
  /** Books modelled since this was last asked: a new world's first indications go out at
   * once, not on the next round (a member waits on them to trade a world they just opened). */
  private readonly announced = new Set<number>();
  unannounced() {
    let fresh = false;
    for (const id of this.models.keys())
      if (!this.announced.has(id)) {
        this.announced.add(id);
        fresh = true;
      }
    for (const id of this.announced) if (!this.models.has(id)) this.announced.delete(id);
    return fresh;
  }

  /** P(both books' worlds happen), from their open legs' union. */
  private unionWorld(a: BookRisk, b: BookRisk) {
    const ca = this.models.get(a.book.id),
      cb = this.models.get(b.book.id);
    if (!ca || !cb) return (a.model?.worldCenter ?? 0) * (b.model?.worldCenter ?? 0);
    const legs = new Map<Hex, { wantYes: boolean; q: number; themes: string[]; condition: Hex }>();
    for (const [c, m] of [
      [ca, ca.model],
      [cb, cb.model],
    ] as const)
      c.legs.forEach((l, i) => {
        const prior = legs.get(l.key);
        if (prior && prior.wantYes !== l.wantYes) legs.set(l.key, { ...prior, q: 0 });
        else
          legs.set(l.key, {
            wantYes: l.wantYes,
            q: m.legInfo[i]!.q,
            themes: l.themes,
            condition: l.condition,
          });
      });
    const list = [...legs.values()];
    if (list.some((l) => l.q === 0)) return 0;
    const data = this.options.data();
    const r = list.map((x, i) =>
      list.map((y, j) => {
        if (i === j) return 1;
        const key =
          x.condition < y.condition
            ? `${x.condition}:${y.condition}`
            : `${y.condition}:${x.condition}`;
        const fit = data.correlations.get(key);
        const prior = themePrior(x.themes, y.themes, this.options.settings.themes);
        const rho = fit
          ? fromZ(
              (fisherZ(prior.rho) / prior.se ** 2 + fisherZ(fit.rho) / fit.se ** 2) /
                (1 / prior.se ** 2 + 1 / fit.se ** 2),
            )
          : prior.rho;
        return (x.wantYes === y.wantYes ? 1 : -1) * rho;
      }),
    );
    return allPassProbability(
      list.map((l) => l.q),
      r,
    );
  }

  // ---------------------------------------------------------------- quotes

  /** κ per open leg: the base tilt, insider-prone events, the ramp before a scheduled
   * resolution, a recent jump, and the requester's excess markout. */
  private kappa(c: Cached, requester: Address | null, nowMs: number) {
    const p = this.options.settings.pricing,
      r = this.options.settings.references;
    const excess = requester
      ? Math.min(p.kappaRequesterCap, Math.max(0, this.requesters.excess(requester)))
      : 0;
    return c.legs.map((l) => {
      const until = l.resolvesAt * 1000 - nowMs;
      const scheduled = p.kappaScheduled * Math.max(0, 1 - until / 86_400_000);
      const jump = this.options.legs.lastJump(l.condition, r.jumpPoints, r.jumpSigma);
      const jumped = jump !== null && nowMs - jump < r.jumpWindowMs ? p.kappaJump : 0;
      return p.kappa0 + (l.insider ? p.kappaInsider : 0) + scheduled + jumped + excess;
    });
  }

  /** Prices `order` for the vault from memory, or declines it. A preview passes a book that
   * is not on chain yet (`preview`: the replica with it added, and its model). `open` prices
   * for an open request, whose quote lives long enough for its taker to choose it. */
  price(
    order: WorldOrderRequest,
    minQuoteSeconds: number,
    preview?: { s: WorldState; c: Cached },
    open = false,
  ): Priced {
    const set = this.options.settings;
    const decline = (reason: string) => ({ decline: reason }) as const;
    if (this.stopped) return decline("Stopping");
    if (this.options.state.halted) return decline("Drawdown latch set");
    if (!this.options.follower.health().healthy) return decline("Chain view unavailable");
    const st = this.state();
    if (!st) return decline("The vault is not followed");
    const v = st.v;
    const s = preview?.s ?? st.s;
    if (s.config.paused) return decline("The books are paused");
    if (v.paused) return decline("The vault is paused");
    if (!v.limits || !v.risk) return decline("The vault has no limits");
    if (order.taker === this.vault) return decline("The vault's own order");
    const b = s.books.get(order.book);
    if (!b) return decline("Unknown book");
    const nowMs = this.now(),
      now = seconds(nowMs);
    if (bookStateAt(s, b, now) !== BOOK_STATE.trading) return decline("The book is not trading");
    const c = preview?.c ?? this.models.get(b.id);
    if (!c) return decline("The book is not quoted");
    // No quote close to a leg's scheduled resolution; shorter lives near it.
    const soonest = Math.min(
      ...c.legs.map((l) => l.resolvesAt * 1000 - nowMs),
      Number.POSITIVE_INFINITY,
    );
    if (soonest < set.quotes.stopSeconds * 1000) return decline("A leg resolves soon");
    const near = soonest < set.quotes.nearSeconds * 1000;
    const q = set.quotes;
    const ttl = Math.min(
      open
        ? near
          ? q.nearOpenTtlSeconds
          : q.openTtlSeconds
        : near
          ? q.nearTtlSeconds
          : q.ttlSeconds,
      v.limits.maxTtl,
      b.def.cutoff - v.limits.cutoffBuffer - Number(now),
    );
    if (ttl < minQuoteSeconds) return decline("Too close to the cutoff");
    const ageS = Math.max(0, ...c.legs.map((l) => l.referenceAgeMs)) / 1000;
    const kappa = this.kappa(c, order.taker, nowMs);
    this.risk.expire(nowMs);
    const books = this.bookRisks();
    const nav = this.nav(v);
    const side = order.side === "buy" ? "ask" : "bid";
    const context = {
      s,
      v,
      b,
      c,
      kappa,
      staleSeconds: ttl + ageS,
      side,
      nav,
      books,
      nowMs,
    } as const;

    let units: bigint, refund: bigint;
    if (order.units !== null) {
      units = order.units;
      refund = order.refund;
    } else {
      if (!order.stake || side !== "ask") return decline("A stake buys");
      refund = order.conditional ? order.stake : 0n;
      const solved = this.solveStake(context, order, refund);
      if ("decline" in solved) return solved;
      units = solved.units;
      if (units <= 0n || units < order.limit)
        return decline("The stake buys fewer units than asked");
    }
    const priced = this.priceUnits(context, order, units, refund);
    if ("decline" in priced) return priced;
    let price = priced.price;
    if (order.stake !== null) {
      // A stake's quote is priced at the stake: the vault gives at least its ask's worth.
      if (price > order.stake) return decline("The stake does not cover the units");
      price = order.stake;
    } else if (side === "ask" ? price > order.limit : price < order.limit)
      return decline("Beyond the order's limit");
    // The requester's limits, scaled by its markout record.
    const factor = this.requesters.stakeFactor(order.taker);
    const mine = this.requesters.exposure(
      order.taker,
      nowMs,
      (book) => s.books.get(book)?.status === 1,
    );
    let pending = 0;
    for (const o of this.risk.outstanding.values())
      if (o.requester === order.taker) pending += Number(o.capital);
    const capital = Number(priced.capital);
    const navN = Number(nav);
    if (capital > 0) {
      if (mine.outstanding + pending + capital > set.risk.requesterOutstanding * navN * factor)
        return decline("Over this wallet's limit");
      if (
        mine.outstanding + pending + capital >
        set.risk.requesterBookShare * Number(v.risk.maxBookRisk)
      )
        return decline("Over this wallet's share of a book");
      if (mine.daily + pending + capital > set.risk.requesterDaily * navN * factor)
        return decline("Over this wallet's daily limit");
    }
    // Signed "at" the chain's time, a second back: the vault refuses a quote signed after the
    // block it fills in, and a node's head may trail this clock. Its lifetime counts from then.
    const head = s.timestamp > 0n ? s.timestamp : now;
    const signedAt =
      (head < now ? head : now) - 1n > now - 60n ? (head < now ? head : now) - 1n : now - 60n;
    const lifetime = now + BigInt(ttl);
    const expiry =
      lifetime < signedAt + BigInt(v.limits.maxTtl) ? lifetime : signedAt + BigInt(v.limits.maxTtl);
    if (expiry < now + BigInt(minQuoteSeconds))
      return decline("The chain's clock is too far behind");
    const quote: WorldQuote = {
      taker: order.taker,
      book: BigInt(b.id),
      mask: order.mask,
      units,
      refund,
      sell: order.side === "sell",
      price,
      expiry,
      makerData: packMakerData(v.quoteEpoch, signedAt),
      nonce: 0n,
    };
    // The vault's hook, mirrored exactly on the replica (the taker's funds are the API's check).
    const keeper = this.options.account?.address;
    if (keeper) {
      // As the chain would check it in the next block.
      const at = head > now ? head : now;
      const hook = vaultHookProblem(s, v, { ...quote, nonce: 1n }, keeper, at, { taker: false });
      if (hook) return decline(hook);
    }
    return { ...priced, quote };
  }

  /** The guarded price of a fixed bundle, with its capital and inventory from the risk engine
   * (two passes: the price moves the capital it locks). */
  private priceUnits(
    ctx: {
      s: WorldState;
      v: VaultState;
      b: WorldState["books"] extends Map<number, infer B> ? B : never;
      c: Cached;
      kappa: number[];
      staleSeconds: number;
      side: "ask" | "bid";
      nav: bigint;
      books: ReadonlyMap<number, BookRisk>;
      nowMs: number;
    },
    order: WorldOrderRequest,
    units: bigint,
    refund: bigint,
  ):
    | Exclude<Priced, { quote: WorldQuote }>
    | {
        price: bigint;
        fair: number;
        markup: number;
        components: Quote["components"];
        capital: bigint;
        exposure: bigint;
        atoms: bigint[];
        cost: bigint;
      } {
    const { s, v, b, c, side, nav, books } = ctx;
    const set = this.options.settings;
    const bundle = { mask: order.mask, units, refund };
    const holding = Array.from({ length: b.atoms }, (_, a) => Number(bundlePays(bundle, a)));
    const { minPay, maxPay } = payRange(bundle, b.atoms);
    let price = BigInt(Math.max(1, Math.round(bundleSensitivity(c.model, holding).value)));
    let last: Quote | null = null,
      assessed = null as ReturnType<RiskEngine["assess"]> | null;
    for (let pass = 0; pass < 2; pass++) {
      assessed = this.risk.assess(
        s,
        v,
        c.risk,
        { taker: order.taker, mask: order.mask, units, refund, sell: side === "bid", price },
        nav,
        books,
        ctx.nowMs,
      );
      if ("problem" in assessed) return { decline: assessed.problem };
      last = priceBundle({
        model: c.model,
        holding,
        side,
        kappa: ctx.kappa,
        staleSeconds: ctx.staleSeconds,
        priorOnly: c.priorOnly,
        risk: {
          deltaK: Number(assessed.riskAfter - assessed.riskBefore),
          utilization: assessed.utilization,
          nav: Number(nav),
          variance: assessed.variance,
          covariance: assessed.covariance,
          gammaScale: 1,
        },
        policy: set.pricing,
      });
      const refundValue = Number(refund) * c.model.center[0]!;
      const guarded = guardQuote(last, {
        side,
        maxPay: Number(maxPay),
        minPay: Number(minPay),
        policy: set.pricing,
        worldBetUnits: refund === 0n ? Number(units) : null,
        refundValue,
      });
      if ("decline" in guarded) return guarded;
      let value = guarded.price;
      // The fee the books charge on the price, as the vault's revenue: the quote improves by it,
      // never past the bracket around the center.
      if (set.pricing.feeCredit) {
        const fee = (value * b.def.feeBps) / 10_000;
        const risky = Math.max(0, last.center - refundValue) * set.pricing.minMarkup;
        value =
          side === "ask"
            ? Math.max(value - fee, last.center + risky)
            : Math.min(value + fee, last.center - risky);
      }
      price = side === "ask" ? BigInt(Math.ceil(value)) : BigInt(Math.floor(value));
    }
    if (!assessed || "problem" in assessed || !last) return { decline: "Unpriced" };
    // The vault's margin and size caps, on the final price.
    const l = v.limits!,
      k = v.risk!;
    const margin = ((maxPay - minPay) * BigInt(l.marginBps)) / 10_000n;
    if (side === "ask" ? price < minPay + margin : price > maxPay - margin) {
      if (side === "ask") price = minPay + margin;
      else return { decline: "Inside the vault's margin" };
    }
    if (maxPay > k.maxQuoteSize || price > k.maxQuotePrice)
      return { decline: "Over the vault's size caps" };
    if (price <= 0n) return { decline: "Unpriced" };
    // Quarter Kelly: a fill may add capital in proportion to its own edge (the book's total is
    // capped by the per-book limit). The edge is the vault's revenue (its spread, and the fee
    // when credited) over the premium net of any refund: what the taker stakes on the outcome.
    if (assessed.riskAfter > assessed.riskBefore && side === "ask") {
      const refundValue = Number(refund) * c.model.center[0]!;
      const fee = set.pricing.feeCredit ? (Number(price) * b.def.feeBps) / 10_000 : 0;
      const edge = Math.max(
        0,
        (Number(price) + fee - last.center) / Math.max(Number(price) - refundValue, 1),
      );
      if (Number(assessed.riskAfter - assessed.riskBefore) > set.risk.kelly * edge * Number(nav))
        return { decline: "Over the fill's Kelly limit" };
    }
    // A conditional payout's price inside the world.
    if (refund > 0n && order.mask) {
      const inWorld = c.model.center
        .slice(1)
        .reduce((a, x, i) => a + ((order.mask >> (i + 1)) & 1 ? x : 0), 0);
      const world = c.model.center.slice(1).reduce((a, x) => a + x, 0);
      const fairIn = world > 0 ? inWorld / world : 0;
      const priceIn =
        units > 0n && world > 0
          ? (Number(price) - Number(refund) * c.model.center[0]!) / (Number(units) * world)
          : 0;
      if (fairIn > 0 && priceIn / fairIn - 1 > set.pricing.maxConditionalMarkup)
        return { decline: "The conditional markup is too high" };
    }
    // Event-only worlds against their legs' venues: one leg is the venue's own market, so its
    // price is bounded by the venue's touch plus the cost of hedging there (2¢); a world of several
    // legs never sells above its cheapest leg's ask, which dominates it.
    if (
      b.def.feed === "0x0000000000000000000000000000000000000000" &&
      refund === 0n &&
      c.legs.length &&
      units > 0n
    ) {
      const hedge = 0.02,
        per = Number(price) / Number(units);
      const touch = Math.min(...c.model.legInfo.map((x) => x.q + x.halfSpread));
      if (c.legs.length === 1) {
        const info = c.model.legInfo[0]!;
        const fairPer = last.center / Number(units);
        if (side === "ask" && per > touch + hedge) {
          const capped = Math.max(touch + hedge, fairPer * (1 + set.pricing.minMarkup));
          price = BigInt(Math.ceil(capped * Number(units)));
        } else if (side === "bid" && per < info.q - info.halfSpread - hedge) {
          const floored = Math.min(
            info.q - info.halfSpread - hedge,
            fairPer * (1 - set.pricing.minMarkup),
          );
          price = BigInt(Math.floor(floored * Number(units)));
        }
      } else if (side === "ask" && per > touch + hedge)
        return { decline: "Cheaper on a single leg's venue" };
    }
    return {
      price,
      fair: last.center,
      markup: last.center > 0 ? Number(price) / last.center - 1 : 0,
      components: last.components,
      capital: assessed.riskAfter - assessed.riskBefore,
      exposure: assessed.exposure,
      atoms: assessed.atoms,
      cost: assessed.cost,
    };
  }

  /** The most units a stake buys: bisection on the price, its risk inputs scaled from one
   * assessment (capital and covariance linear, variance quadratic in the units). */
  private solveStake(
    ctx: Parameters<WorldKeeper["priceUnits"]>[0],
    order: WorldOrderRequest,
    refund: bigint,
  ): { units: bigint } | { decline: string } {
    const { s, v, b, c, side, nav, books } = ctx;
    const stake = Number(order.stake!);
    const unitHolding = Array.from({ length: b.atoms }, (_, a) =>
      a === 0 ? 0 : (order.mask >> a) & 1 ? 1 : 0,
    );
    const unitValue = bundleSensitivity(c.model, unitHolding).value;
    const refundValue = Number(refund) * c.model.center[0]!;
    const guess = Math.max(1, Math.floor((stake - refundValue) / Math.max(unitValue, 1e-9)));
    const probe = this.risk.assess(
      s,
      v,
      c.risk,
      {
        taker: order.taker,
        mask: order.mask,
        units: BigInt(guess),
        refund,
        sell: false,
        price: BigInt(Math.round(stake)),
      },
      nav,
      books,
      ctx.nowMs,
    );
    if ("problem" in probe) return { decline: probe.problem };
    const base = {
      deltaK: Number(probe.riskAfter - probe.riskBefore),
      variance: probe.variance,
      covariance: probe.covariance,
    };
    const priceOf = (n: number) => {
      const scale = n / guess;
      const holding = unitHolding.map((h, a) => (a === 0 ? Number(refund) : h * n));
      const q = priceBundle({
        model: c.model,
        holding,
        side,
        kappa: ctx.kappa,
        staleSeconds: ctx.staleSeconds,
        priorOnly: c.priorOnly,
        risk: {
          deltaK: base.deltaK * scale,
          utilization: probe.utilization,
          nav: Number(nav),
          variance: base.variance * scale * scale,
          covariance: base.covariance * scale,
          gammaScale: 1,
        },
        policy: this.options.settings.pricing,
      });
      const { minPay, maxPay } = payRange({ mask: order.mask, units: BigInt(n), refund }, b.atoms);
      const g = guardQuote(q, {
        side,
        maxPay: Number(maxPay),
        minPay: Number(minPay),
        policy: this.options.settings.pricing,
        worldBetUnits: refund === 0n ? n : null,
        refundValue,
      });
      return "decline" in g ? null : g.price;
    };
    let units = unitsForStake(
      stake - refundValue > 0 ? stake : 0,
      Math.max(unitValue, 1e-12),
      priceOf,
    );
    // The final, fully assessed price may sit a little above the scaled one: step down to fit.
    for (let attempt = 0; attempt < 4 && units > 0; attempt++) {
      const exact = this.priceUnits(ctx, order, BigInt(units), refund);
      if ("decline" in exact) return exact;
      if (Number(exact.price) <= stake) return { units: BigInt(units) };
      units = Math.floor(units * (stake / Number(exact.price)) * 0.999);
    }
    return { decline: "The stake cannot be priced" };
  }

  /** Signs a priced quote as the keeper (the nonce names the vault) and holds its capital
   * against the limits until it expires or is reported lost. A quote for an open request
   * (`open`) replaces the vault's earlier one on it and stays under `review` while it stands. */
  async sign(id: string, priced: Extract<Priced, { quote: WorldQuote }>, open = false) {
    const account = this.options.account;
    if (!account) throw new Error("Dry run: no keeper key");
    const counter = BigInt(this.options.state.counter) + 1n;
    this.options.state.counter = counter.toString();
    const quote = { ...priced.quote, nonce: contractQuoteNonce(this.vault, counter) };
    const replaced = this.standing.get(id);
    if (replaced) this.byNonce.delete(replaced.quote.nonce);
    if (open)
      this.standing.set(id, {
        quote,
        edge: this.edge(quote, priced.fair),
        model: this.models.get(Number(quote.book))?.model ?? null,
      });
    this.risk.hold({
      id,
      book: Number(quote.book),
      requester: quote.taker,
      atoms: priced.atoms,
      cost: priced.cost,
      exposure: priced.exposure,
      capital: priced.capital,
      expiresAtMs: Number(quote.expiry) * 1000,
    });
    this.byNonce.set(quote.nonce, id);
    try {
      const signature = await account.signTypedData({
        domain: worldQuoteDomain(
          this.options.chainId,
          this.options.follower.confirmed.deployment.books,
        ),
        types: WORLD_QUOTE_TYPES,
        primaryType: "WorldQuote",
        message: worldQuoteMessage(quote),
      });
      void this.options.save();
      return { quote, signature };
    } catch (error) {
      this.risk.release(id);
      this.byNonce.delete(quote.nonce);
      this.standing.delete(id);
      throw error;
    }
  }

  /** What a request came to: a lost or unfilled quote frees its capacity at once. */
  outcome(id: string, outcome: string) {
    this.standing.delete(id);
    if (outcome === "filled") this.options.follower.poke();
    else this.risk.release(id);
  }

  /** The vault's margin on a quote against the bundle's fair value `fair` (raw quote units):
   * what it is paid over it selling, or pays under it buying, with the books' fee when the
   * quote credits it. */
  private edge(quote: WorldQuote, fair: number) {
    const b = this.options.follower.confirmed.books.get(Number(quote.book));
    const fee =
      b && this.options.settings.pricing.feeCredit
        ? (Number(quote.price) * b.def.feeBps) / 10_000
        : 0;
    return (quote.sell ? fair - Number(quote.price) : Number(quote.price) - fair) + fee;
  }

  /** The open requests whose standing quote no longer stands, and why: it ran out unaccepted
   * (`QUOTE_EXPIRED`, already forgotten here); the vault could not quote at all now (stopping,
   * halted, paused, its chain view or the book's model gone); or the book's fair value moved
   * against the quote until less than `withdrawEdge` of its margin is left (`PRICE_MOVED`). A
   * quote's price is looked at again only when its book's model was rebuilt: unchanged inputs
   * leave its fair value where it was. */
  review(): { id: string; reason: string }[] {
    if (!this.standing.size) return [];
    const nowMs = this.now();
    this.risk.expire(nowMs);
    const st = this.state();
    const blind = this.stopped
      ? "Stopping"
      : this.options.state.halted
        ? "Drawdown latch set"
        : !this.options.follower.health().healthy
          ? "Chain view unavailable"
          : !st
            ? "The vault is not followed"
            : st.s.config.paused || st.v.paused
              ? "Paused"
              : null;
    const out: { id: string; reason: string }[] = [];
    for (const [id, held] of this.standing) {
      // Its hold ran out with it: the quote fills no more.
      if (!this.risk.outstanding.has(id)) {
        this.standing.delete(id);
        this.byNonce.delete(held.quote.nonce);
        out.push({ id, reason: QUOTE_EXPIRED });
        continue;
      }
      if (blind) {
        out.push({ id, reason: blind });
        continue;
      }
      const c = this.models.get(Number(held.quote.book));
      if (!c) {
        out.push({ id, reason: "The book is not quoted" });
        continue;
      }
      if (c.model === held.model) continue;
      held.model = c.model;
      const holding = Array.from({ length: c.model.atoms }, (_, a) =>
        Number(bundlePays(held.quote, a)),
      );
      const left = this.edge(held.quote, bundleSensitivity(c.model, holding).value);
      if (left < held.edge * this.options.settings.quotes.withdrawEdge)
        out.push({ id, reason: PRICE_MOVED });
    }
    return out;
  }

  /** Forgets a standing quote the vault withdrew and frees its capacity. */
  withdraw(id: string) {
    const held = this.standing.get(id);
    if (!held) return;
    this.standing.delete(id);
    this.byNonce.delete(held.quote.nonce);
    this.risk.release(id);
  }

  /** The API dropped every quote standing on an open request (the stream closed): none of them
   * fills any more. */
  dropStanding() {
    for (const id of [...this.standing.keys()]) this.withdraw(id);
  }
  get standingQuotes() {
    return this.standing.size;
  }

  /** A fill the replica applied: the vault's own release its in-flight hold (the replica now
   * holds it) and enter the requester's record. */
  onFills(events: WorldEvent[]) {
    for (const e of events) {
      if (e.name !== "WorldFill") continue;
      const f = fillRecord(e);
      if (f.maker !== this.vault) continue;
      const id = this.byNonce.get(f.nonce);
      if (id) {
        this.risk.release(id);
        this.byNonce.delete(f.nonce);
        this.standing.delete(id);
      }
      const model = this.models.get(f.book)?.model;
      const holding = model
        ? Array.from({ length: model.atoms }, (_, a) => Number(bundlePays(f, a)))
        : null;
      const fair = model && holding ? bundleSensitivity(model, holding).value : null;
      const unit = holding ? Math.max(...holding) : 0;
      if (fair !== null && unit > 0)
        this.requesters.record(f.taker, {
          at: Number(e.timestamp) * 1000,
          book: f.book,
          mask: f.mask,
          units: Number(f.units),
          refund: Number(f.refund),
          capital: f.sell ? 0 : Number(payRange(f, model!.atoms).maxPay - f.price),
          fair: fair / unit,
          buy: !f.sell,
        });
    }
  }

  // ---------------------------------------------------------------- indications

  /** Every modelled book's standard products at the standard ticket: the ask per unit a stake
   * buys at and the bid per unit for as many units (x 1e6), and the atom marks. */
  indications(minQuoteSeconds: number) {
    const st = this.state();
    if (!st) return [];
    const stakeUnits = BigInt(this.options.settings.quotes.indicationStake) * 10n ** 6n;
    const out: {
      book: number;
      marks: number[];
      products: { key: string; bid: number | null; ask: number | null }[];
      analytics: BookAnalytics;
    }[] = [];
    const zero = "0x0000000000000000000000000000000000000001" as Address;
    for (const [id, c] of this.models) {
      const b = st.s.books.get(id);
      if (!b) continue;
      const products = standardProducts(b.def).map((p) => {
        const conditional = p.kind === "conditional";
        const ask = this.price(
          {
            taker: zero,
            book: id,
            mask: p.mask,
            side: "buy",
            units: null,
            refund: 0n,
            stake: stakeUnits,
            conditional,
            limit: 0n,
          },
          minQuoteSeconds,
        );
        let askPer: number | null = null,
          bidPer: number | null = null;
        if ("quote" in ask) {
          const q = ask.quote;
          askPer = conditional
            ? Math.round(
                ((Number(q.price) - Number(q.refund) * c.model.center[0]!) /
                  (Number(q.units) * Math.max(1e-12, 1 - c.model.center[0]!))) *
                  1e6,
              )
            : Math.round((Number(q.price) / Number(q.units)) * 1e6);
          if (!conditional) {
            const bid = this.price(
              {
                taker: zero,
                book: id,
                mask: p.mask,
                side: "sell",
                units: q.units,
                refund: 0n,
                stake: null,
                conditional: false,
                limit: 0n,
              },
              minQuoteSeconds,
            );
            if ("quote" in bid)
              bidPer = Math.round((Number(bid.quote.price) / Number(q.units)) * 1e6);
          }
        }
        const clamp = (x: number | null) =>
          x === null ? null : Math.min(1_000_000, Math.max(1, x));
        const askC = clamp(askPer),
          bidC = clamp(bidPer);
        return {
          key: p.key,
          ask: askC,
          bid: bidC !== null && askC !== null && bidC > askC ? askC : bidC,
        };
      });
      // Marks: the center's atoms, summing to exactly a million.
      const raw = [...c.model.center].map((x) => Math.round(x * 1e6));
      const drift = 1_000_000 - raw.reduce((a, x) => a + x, 0);
      raw[raw.indexOf(Math.max(...raw))]! += drift;
      out.push({ book: id, marks: raw, products, analytics: analyticsOf(c) });
    }
    return out;
  }

  // ---------------------------------------------------------------- previews

  /** Prices a world that is not on chain yet, as its book would quote once created: the
   * model built from the legs' live probabilities (or the references given, for legs not
   * followed yet), and each standard product bought for `stakes` through the quote path of a
   * real book (every guard, cap and the vault's hook), against the replica with the book added.
   * Nothing is signed or held. Answers from memory, like a quote. */
  preview(
    p: PreviewBook,
    stakes: { allIn: bigint; moneyBack: bigint },
    minQuoteSeconds: number,
  ):
    | { decline: string }
    | {
        marks: number[];
        analytics: BookAnalytics;
        priorOnly: boolean;
        products: {
          key: string;
          stake: string;
          units: string | null;
          ask: number | null;
          decline: string | null;
        }[];
      } {
    const st = this.state();
    if (!st) return { decline: "The vault is not followed" };
    const nowMs = this.now();
    const s = st.s;
    const def: BookDef = {
      legs: p.legs.map((l) => ({ eventKey: l.eventKey.toLowerCase() as Hex, wantYes: l.wantYes })),
      feed: p.feed,
      underlying: p.underlying ? underlyingId(p.underlying) : zeroHash,
      fixingTime: p.fixingTime,
      maxStaleness: p.maxStaleness,
      strikes: p.strikes,
      cutoff: p.cutoff,
      feeBps: p.feeBps,
      metadataHash: zeroHash,
    };
    const book: BookState = {
      id: PREVIEW_BOOK,
      defHash: bookDefHash(def),
      def,
      metadataUri: "",
      atoms: atomCount(def),
      status: BOOK_STATUS.undecided,
      winner: 0,
      frozen: false,
      held: false,
      backing: 0n,
      fix: null,
      fixCommitment: null,
      fixEvidence: null,
      fixUri: null,
      fixedPrice: null,
      fills: 0,
      volume: 0n,
      fees: 0n,
      createdBlock: s.block,
      createdAt: s.timestamp,
      createdTx: zeroHash,
      decidedAt: null,
    };
    const meta: WorldBookRecord = {
      defHash: book.defHash,
      book: PREVIEW_BOOK,
      title: "",
      kind: "user",
      metadata: {
        legs: p.legs.map(({ reference: _, ...leg }) => leg),
        underlying: p.underlying,
        feedDecimals: p.feedDecimals,
        fixing: null,
        metadataUri: "",
        def: {},
      },
      packetHash: null,
      createdAt: new Date(nowMs),
    };
    // A followed leg prices from its live tick; another from the reference given, if recent.
    const references = new Map(p.legs.map((l) => [l.conditionId.toLowerCase(), l.reference]));
    const live = this.options.legs;
    const legsRef = {
      latest: (condition: Hex) => {
        const tick = live.latest(condition);
        if (tick && nowMs - tick.observedAtMs <= this.options.settings.references.maxReferenceAgeMs)
          return tick;
        const r = references.get(condition.toLowerCase());
        if (!r || nowMs - r.observedAtMs > PREVIEW_REFERENCE_MS) return tick;
        return { yes: r.yes, halfSpread: r.halfSpread, observedAtMs: nowMs };
      },
    } as unknown as LegReferences;
    const spotRef = {
      spot: (...args: Parameters<SpotReferences["spot"]>) => {
        const fresh = this.options.spot.spot(...args);
        if (!("problem" in fresh) || p.spot === null) return fresh;
        return { price: p.spot, observedAtMs: nowMs, source: "feed" as const };
      },
    } as unknown as SpotReferences;
    const built = buildInputs({
      s,
      book,
      meta,
      legsRef,
      spotRef,
      data: this.options.data(),
      settings: this.options.settings,
      nowMs,
    });
    if ("problem" in built) return { decline: built.problem };
    let model: BookModel;
    try {
      model = buildBookModel(built.inputs);
    } catch (error) {
      return { decline: (error as Error).message };
    }
    const c: Cached = {
      model,
      legs: built.legs,
      priorOnly: built.priorOnly,
      risk: { ...built.risk, model },
      key: "",
      builtAt: nowMs,
      spot: built.inputs.stock?.spot ?? null,
    };
    const overlay: WorldState = { ...s, books: new Map(s.books).set(PREVIEW_BOOK, book) };
    const zero = "0x0000000000000000000000000000000000000001" as Address;
    try {
      const products = standardProducts(def).map((product) => {
        const conditional = product.kind === "conditional";
        const stake = conditional ? stakes.moneyBack : stakes.allIn;
        const priced = this.price(
          {
            taker: zero,
            book: PREVIEW_BOOK,
            mask: product.mask,
            side: "buy",
            units: null,
            refund: 0n,
            stake,
            conditional,
            limit: 0n,
          },
          minQuoteSeconds,
          { s: overlay, c },
        );
        if ("decline" in priced)
          return {
            key: product.key,
            stake: stake.toString(),
            units: null,
            ask: null,
            decline: priced.decline,
          };
        const q = priced.quote;
        // Per unit as the indications quote it (a conditional payout's inside the world).
        const ask = conditional
          ? ((Number(q.price) - Number(q.refund) * model.center[0]!) /
              (Number(q.units) * Math.max(1e-12, 1 - model.center[0]!))) *
            1e6
          : (Number(q.price) / Number(q.units)) * 1e6;
        return {
          key: product.key,
          stake: stake.toString(),
          units: q.units.toString(),
          ask: Math.min(1_000_000, Math.max(1, Math.round(ask))),
          decline: null,
        };
      });
      const raw = [...model.center].map((x) => Math.round(x * 1e6));
      const drift = 1_000_000 - raw.reduce((a, x) => a + x, 0);
      raw[raw.indexOf(Math.max(...raw))]! += drift;
      return { marks: raw, analytics: analyticsOf(c), priorOnly: c.priorOnly, products };
    } finally {
      // The pair probabilities the risk engine cached for the preview's id.
      this.risk.forget(PREVIEW_BOOK);
    }
  }

  // ---------------------------------------------------------------- housekeeping

  /** Each of the vault's books valued: a decided book at its winning atom, others at their
   * (last) center, and a book never modelled at its lowest atom. `holdings` values a snapshot
   * (a batch's close) instead of the current atoms. */
  valuations(s: WorldState, v: VaultState, holdings?: ReadonlyMap<number, bigint[]>) {
    const now = seconds(this.now());
    const out: {
      book: number;
      atoms: bigint[];
      chances: number[] | null;
      value: number;
      basis: string;
    }[] = [];
    for (const id of holdings ? [...holdings.keys()] : [...v.positions.keys()]) {
      const atoms = holdings?.get(id) ?? atomsOf(s, id, v.address);
      const b = s.books.get(id);
      const winner = b ? winningAtom(s, b, now) : null;
      if (winner !== null) {
        out.push({
          book: id,
          atoms,
          chances: null,
          value: Number(atoms[winner] ?? 0n),
          basis: "decided",
        });
        continue;
      }
      const center = this.centers.get(id);
      if (center && center.length === atoms.length) {
        let value = 0;
        for (let a = 0; a < atoms.length; a++) value += Number(atoms[a]!) * center[a]!;
        out.push({ book: id, atoms, chances: [...center], value, basis: "model" });
      } else
        out.push({
          book: id,
          atoms,
          chances: null,
          value: Number(atoms.reduce((x, y) => (y < x ? y : x), atoms[0] ?? 0n)),
          basis: "lowest",
        });
    }
    return out;
  }

  /** The vault's value at the models' centers: its credit plus every book's valuation. */
  markedNav() {
    const st = this.state();
    if (!st) return null;
    const { s, v } = st;
    return this.valuations(s, v).reduce(
      (sum, x) => sum + x.value,
      Number(worldCreditOf(s, v.address)),
    );
  }

  /** Latches a halt when the marked NAV falls `maxDrawdownBps` within the window. */
  drawdown(nowMs = this.now()) {
    const nav = this.markedNav();
    if (nav === null || nav <= 0) return false;
    const { state } = this.options;
    const r = this.options.settings.risk;
    if (!state.checkpoint || nowMs - state.checkpoint.at >= r.drawdownWindowMs) {
      state.checkpoint = { at: nowMs, nav };
      return false;
    }
    if ((state.checkpoint.nav - nav) * 10_000 >= state.checkpoint.nav * r.maxDrawdownBps) {
      state.halted = true;
      log("drawdown-halt", { checkpoint: state.checkpoint.nav, nav });
      void this.options.save();
      return true;
    }
    return false;
  }

  /** One housekeeping round: markouts, the drawdown check, then (live) redeeming decided books
   * the vault holds atoms of and merging full sets it holds. */
  async housekeeping() {
    const nowMs = this.now();
    this.requesters.markout(nowMs, (f) => {
      const m = this.models.get(f.book)?.model;
      if (!m) return null;
      const bundle = {
        mask: f.mask,
        units: BigInt(Math.round(f.units)),
        refund: BigInt(Math.round(f.refund)),
      };
      const holding = Array.from({ length: m.atoms }, (_, a) => Number(bundlePays(bundle, a)));
      const unit = Math.max(...holding);
      return unit > 0 ? bundleSensitivity(m, holding).value / unit : null;
    });
    this.options.state.requesters = this.requesters.snapshot();
    this.drawdown(nowMs);
    const executor = this.options.executor;
    const st = this.state();
    if (!executor || !st) return;
    const { s, v } = st;
    const now = seconds(nowMs);
    const decided: bigint[] = [];
    for (const id of v.positions.keys()) {
      const b = s.books.get(id);
      if (!b) continue;
      const state = bookStateAt(s, b, now);
      if (state === BOOK_STATE.failed || state === BOOK_STATE.passed || state === BOOK_STATE.fixed)
        decided.push(BigInt(id));
    }
    const calls = worldVaultCalls(this.vault);
    await executor.reconcilePending();
    if (decided.length) {
      await executor.send(calls.settle(decided.slice(0, 20)));
      log("settled", { books: decided.slice(0, 20) });
      return;
    }
    // Full sets the vault holds (atoms sent to it, or left by a sync) back into credit.
    for (const id of v.positions.keys()) {
      const atoms = atomsOf(s, id, v.address);
      const sets = atoms.reduce((x, y) => (y < x ? y : x), atoms[0] ?? 0n);
      if (sets >= 10n ** 6n && s.books.get(id)?.status === 1) {
        await executor.send(calls.merge(BigInt(id), sets));
        log("merged", { book: id, sets });
        return;
      }
    }
  }
}
