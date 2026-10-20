import {
  ARCHIVED,
  type DeltaVaultHoldings,
  type DeltaVaultQuote,
  deltaVaultCancelAll,
  deltaVaultMerge,
  deltaVaultSettle,
  deltaVaultUpdate,
  OPEN,
  quote,
  REDEEMABLE,
  reservation,
} from "@conditional-stocks/evm-client";
import {
  accountOf,
  type ChainState,
  creditOf,
  type MarketState,
  type OrderState,
  traderOf,
} from "@conditional-stocks/evm-client/ledger";
import { type ChainFollower, liveOrder, type TokenReader } from "@conditional-stocks/indexer";
import {
  abs,
  BPS,
  type Executor,
  max,
  min,
  PROB,
  type Reference,
  type ReferenceLimits,
  type ReferencePolicy,
  reference,
  spotPair,
  TESTNETS,
  type Units,
  units,
} from "@conditional-stocks/operator";
import { type Address, type PublicClient, zeroAddress } from "viem";
import {
  type MarketModel,
  type MarketOverride,
  marketModel,
  type Settings,
  type VaultSettings,
} from "./config.ts";
import type { LiveReferences } from "./live.ts";
import {
  type Book,
  conditionalGap,
  type Funds,
  fairPrices,
  halfSpread,
  impliedProbability,
  ladders,
  markedValue,
  type Quote,
  widening,
} from "./model.ts";
import {
  type Pricing,
  priceRfq,
  type RfqOrder,
  raisesImbalance,
  type VaultPosition,
} from "./pricing.ts";
import type { Basket, KeeperState, MarketRecord } from "./state.ts";
import type { Tick } from "./tick.ts";
import { readVaultView, type VaultIdentity, type VaultView } from "./vault.ts";

/** A quote the vault signed that may still fill: it counts against the vault's limits until it
 * expires (or is reported lost), so concurrent requests never overcommit it. */
export interface OutstandingQuote {
  market: number;
  branch: 0 | 1;
  /** The vault's side: true when it sells. */
  sells: boolean;
  fundingKind: 0 | 1;
  quantity: bigint;
  notional: bigint;
  expiresAtMs: number;
}

export const log = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ event, ...detail }, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
const seconds = () => BigInt(Math.floor(Date.now() / 1000));
const WAD = 10n ** 18n;
/** The order the vault's indicative prices are for, in whole quote tokens. */
const INDICATIVE_NOTIONAL = "100";
/** A buy's worst price that never binds. */
const UNLIMITED = (1n << 128n) - 1n;

/** The vault's live orders, optionally in one market. */
export function vaultOrders(s: ChainState, vault: Address, market?: number) {
  return [...s.orders.values()].filter(
    (o) =>
      o.owner === vault && o.status === "open" && (market === undefined || o.market === market),
  );
}
/** Best foreign bid and ask per branch. */
export function foreignBook(s: ChainState, vault: Address, m: MarketState): Book {
  const best: Book = [{}, {}];
  for (const o of s.orders.values())
    if (o.market === m.id && o.owner !== vault && liveOrder(o, s)) {
      const top = best[o.branch as 0 | 1],
        price = o.ticks * m.tick;
      if (o.side === 0) top.bid = top.bid === undefined ? price : max(top.bid, price);
      else top.ask = top.ask === undefined ? price : min(top.ask, price);
    }
  return best;
}
/** What one market's quotes may reserve: unreserved credit and claims plus what the market's
 * own quotes (all of which may be replaced) hold, less the withdrawal reserve on plain holdings. */
export function marketFunds(
  v: Pick<VaultView, "holdings">,
  market: number,
  own: OrderState[],
  tick: bigint,
  reserveBps: number,
): Funds {
  const h = v.holdings,
    m = h.markets.find((x) => x.market === market);
  if (!m) throw new Error("Market is not registered in the vault");
  const f: Funds = {
    quote: h.freeQuote,
    base: h.freeBase,
    quoteClaims: [m.free.yesQuote, m.free.noQuote],
    baseClaims: [m.free.yesBase, m.free.noBase],
  };
  for (const o of own) {
    const reserved = reservation(o.side, o.remaining, o.ticks * tick);
    if (o.fundingKind === 0) {
      if (o.side === 0) f.quote += reserved;
      else f.base += reserved;
    } else (o.side === 0 ? f.quoteClaims : f.baseClaims)[o.branch as 0 | 1] += reserved;
  }
  f.quote -= min(f.quote, (h.quote * BigInt(reserveBps)) / BPS);
  f.base -= min(f.base, (h.base * BigInt(reserveBps)) / BPS);
  return f;
}
/** Stock the vault holds for one market: plain plus the branch average of its stock claims. */
export function inventory(h: DeltaVaultHoldings, market: number) {
  const m = h.markets.find((x) => x.market === market);
  return h.base + (m ? (m.claims.yesBase + m.claims.noBase) / 2n : 0n);
}
/** Holdings per 1e18 shares. */
export function basket(h: DeltaVaultHoldings, supply: bigint): Basket {
  const per = (amount: bigint) => String((amount * WAD) / supply);
  return {
    quote: per(h.quote),
    base: per(h.base),
    markets: h.markets.map((m) => ({
      market: m.market,
      yesQuote: per(m.claims.yesQuote),
      noQuote: per(m.claims.noQuote),
      yesBase: per(m.claims.yesBase),
      noBase: per(m.claims.noBase),
    })),
  };
}
const holdingsOf = (b: Basket) => ({
  quote: BigInt(b.quote),
  base: BigInt(b.base),
  markets: b.markets.map((m) => ({
    market: m.market,
    claims: {
      yesQuote: BigInt(m.yesQuote),
      noQuote: BigInt(m.noQuote),
      yesBase: BigInt(m.yesBase),
      noBase: BigInt(m.noBase),
    },
  })),
});

/** Whether a resting quote may stay: good-till-expiry, placed by the vault itself under its
 * current epoch and fee cap, and not about to expire. */
export function keepable(
  o: OrderState,
  now: bigint,
  pollMs: number,
  live: { epoch: bigint; maxFeeBps: number },
) {
  return (
    o.tif === 0 &&
    !o.delegate &&
    o.epoch === live.epoch &&
    o.maxFeeBps === live.maxFeeBps &&
    o.expiry > now + BigInt(Math.ceil(pollMs / 1000) * 2)
  );
}
/** Cancels and placements bringing the market's quotes to `desired`: the resting quotes the
 * ladders kept stay, every other one is cancelled and every new quote is placed. */
export function orderChanges(existing: OrderState[], desired: Quote[]) {
  const kept = new Set(desired.flatMap((q) => (q.key === undefined ? [] : [q.key])));
  return {
    cancels: existing.map((o) => BigInt(o.key)).filter((key) => !kept.has(key)),
    places: desired.filter((q) => q.key === undefined),
  };
}

/** Reads one market's reference within a round (tests substitute their own). */
export type ReferenceReader = (
  tick: Tick,
  market: MarketState,
  policy: ReferencePolicy,
  limits: ReferenceLimits,
  units: Units,
) => Promise<Reference>;
/** The round's shared reads of the market's event and of the spot prices. */
export const tickReference: ReferenceReader = async (tick, market, policy, limits, u) => {
  const [source, prices] = await Promise.all([
    tick.event(market.id, market.condition),
    tick.spotPrices(),
  ]);
  return reference(source, spotPair(prices, u.quote, policy.base), market, policy, limits, u);
};

/** Quotes one Δ-vault: every market it registers, both branches. Several keepers run in one
 * process over one chain follower; each signs with its own wallet, so none waits on another. */
export class Keeper {
  stopped = false;
  /** Live references for RFQ quotes (set when RFQ is on). */
  live?: LiveReferences;
  /** The latest read of the vault, which RFQ quotes price against between rounds. */
  latest?: { v: VaultView; at: number };
  /** Signed quotes that may still fill, by request id. */
  readonly outstanding = new Map<string, OutstandingQuote>();
  /** Markets the vault registered at the last read: the next read fetches their terms along. */
  private known: number[] = [];
  private readonly overrides: Map<number, MarketOverride>;

  constructor(
    readonly follower: ChainFollower,
    readonly tokens: TokenReader,
    readonly client: PublicClient,
    readonly chainId: number,
    readonly settings: Settings,
    readonly config: VaultSettings,
    readonly identity: VaultIdentity,
    readonly state: KeeperState,
    readonly save: () => void | Promise<void>,
    readonly executor?: Executor,
    readonly readReference: ReferenceReader = tickReference,
  ) {
    this.overrides = new Map(config.markets.map((m) => [m.market, m]));
  }

  get vault() {
    return this.identity.address;
  }

  log(event: string, detail: Record<string, unknown> = {}) {
    log(event, { vault: this.vault, ...detail });
  }

  /** The Δ-model of a registered market; undefined when it is not to be quoted. */
  model(market: number): MarketModel | undefined {
    return marketModel(this.settings.model, this.overrides.get(market));
  }

  /** The replica, never older than the keeper's last included transaction, and the vault. */
  async snapshot() {
    const last = BigInt(this.state.lastBlock);
    if (this.follower.confirmed.block < last) {
      // Our transaction landed after the follower's last poll: read it now, not at the next.
      this.follower.poke();
      await this.follower.reached(last, 15_000);
    }
    if (!this.follower.health().healthy) throw new Error("Chain view unavailable");
    const v = await readVaultView(this.client, this.identity, this.known);
    this.known = v.markets.map((m) => m.market);
    this.latest = { v, at: Date.now() };
    return { s: this.follower.confirmed, v };
  }

  /** Token units and the issuer's live state; an issuer pause stops quoting. */
  units(s: ChainState, v: VaultView): Units {
    const live = this.tokens.live.get(v.base);
    if (!live) throw new Error("The issuer's state of the vault's stock is unknown");
    if (live.paused) throw new Error("The issuer paused the vault's stock token");
    const quoteDecimals = s.pools.get(v.quote)?.decimals,
      baseDecimals = s.pools.get(v.base)?.decimals;
    if (quoteDecimals === undefined || baseDecimals === undefined)
      throw new Error("Unlisted vault token");
    return {
      chainId: this.chainId,
      quote: v.quote,
      quoteDecimals,
      baseDecimals,
      multiplier: live.multiplier,
    };
  }

  private record(market: number): MarketRecord {
    const record = this.state.markets[market] ?? {};
    this.state.markets[market] = record;
    return record;
  }

  /** Cancels every resting vault order. */
  async cancelAll() {
    if (!this.executor) return;
    await this.executor.reconcilePending();
    const { s } = await this.snapshot();
    if (vaultOrders(s, this.vault).length)
      await this.executor.send(deltaVaultCancelAll(this.vault), true);
  }

  /** Cancels the vault's orders in one market, rereading the chain unless `s` is current. */
  async cancelMarket(market: number, s?: ChainState) {
    if (!this.executor) return false;
    if (!s) {
      await this.executor.reconcilePending();
      ({ s } = await this.snapshot());
    }
    const m = s.markets.get(market),
      keys = vaultOrders(s, this.vault, market).map((o) => BigInt(o.key));
    if (!m || !keys.length || !this.known.includes(market)) return false;
    await this.executor.send(deltaVaultUpdate(this.vault, market, keys, [], m.tick), true);
    return true;
  }

  /** One round: settle, merge, then bring every registered market's quotes to its ladders.
   * The risk state is persisted at the end of the round, whatever the outcome. */
  async cycle(tick: Tick) {
    try {
      await this.round(tick);
    } finally {
      await this.save();
    }
  }

  private async round(tick: Tick) {
    await this.executor?.reconcilePending();
    if (this.state.halted) {
      this.log("halted", { reason: "Drawdown latch set; an operator must review and clear it" });
      await this.cancelAll();
      return;
    }
    // The references of the markets the vault had registered are read while the chain is.
    const view = this.follower.confirmed;
    for (const market of this.known) {
      const m = view.markets.get(market);
      if (m && this.model(market)) tick.prefetch(market, m.condition);
    }
    let [{ s, v }] = await Promise.all([this.snapshot(), tick.issuers()]);
    // Resolved markets: redeem the vault's claims and free their slots (anyone may; the keeper
    // does it promptly).
    let settled = false;
    if (this.executor)
      for (const { market } of v.markets) {
        const state = s.markets.get(market)?.state;
        if (state === REDEEMABLE || state === ARCHIVED) {
          await this.executor.send(deltaVaultSettle(this.vault, market), true);
          this.log("settled", { market });
          settled = true;
        }
      }
    if (settled) ({ s, v } = await this.snapshot());
    const u = this.units(s, v);
    const references = new Map<number, Reference>();
    await Promise.all(
      v.markets
        .filter(({ market }) => this.model(market) && s.markets.has(market))
        .map(async ({ market }) => {
          try {
            references.set(
              market,
              await this.readReference(
                tick,
                s.markets.get(market)!,
                this.policy(),
                this.settings,
                u,
              ),
            );
          } catch (error) {
            this.log("reference-unavailable", { market, reason: (error as Error).message });
          }
        }),
    );
    // RFQ quotes price from live references, validated against each event's metadata.
    if (this.live)
      for (const market of references.keys()) {
        const m = s.markets.get(market)!;
        this.live.track(m, await tick.event(market, m.condition).catch(() => undefined));
      }
    if (this.drawdown(v, references)) {
      // The latch is durable before anything else happens.
      await this.save();
      await this.cancelAll();
      return;
    }
    // Paired claims back into credit before quoting, so withdrawals and bids see them.
    if (this.executor) {
      let merged = false;
      for (const h of v.holdings.markets) {
        const r = references.get(h.market),
          threshold = units(this.settings.mergeQuote, u.quoteDecimals),
          f = h.free;
        const pairedStock = min(f.yesBase, f.noBase);
        if (
          min(f.yesQuote, f.noQuote) >= threshold ||
          (r && quote(pairedStock, r.spot) >= threshold)
        ) {
          await this.executor.send(deltaVaultMerge(this.vault, h.market));
          merged = true;
        }
      }
      if (merged) ({ s, v } = await this.snapshot());
    }
    const markets = v.markets.map(({ market }) => market);
    for (const [i, market] of markets.entries()) {
      if (this.stopped) break;
      const model = this.model(market);
      let stage = "validation";
      let changed = false;
      try {
        if (!model) {
          // Disabled here, or no model applies: never leave quotes behind.
          changed = await this.cancelMarket(market, s);
        } else {
          if (!s.markets.has(market)) throw new Error("The market is not in the chain view yet");
          const r = references.get(market);
          if (!r) throw new Error("Reference unavailable");
          stage = "quoting";
          changed = await this.quote(market, model, s, v, u, r);
        }
      } catch (error) {
        this.log("market-paused", {
          market,
          stage,
          reason: error instanceof Error ? error.message : "Safety check failed",
        });
        changed = await this.cancelMarket(market).catch(() => true);
      }
      // Funds are shared across the vault's markets: the next one plans on the new state.
      if (changed && i < markets.length - 1) ({ s, v } = await this.snapshot());
    }
  }

  /** Reviewed unit conversion of the vault stock's reference price. */
  private policy(): ReferencePolicy {
    return {
      base: this.identity.base,
      basePriceMultiplier: this.config.basePriceMultiplier,
      quotePriceMultiplier: this.config.quotePriceMultiplier,
    };
  }

  /** Δ̂ of a market at the vault's current exposure. */
  private gap(model: MarketModel, v: VaultView, market: number, widen: bigint) {
    const vm = v.markets.find((m) => m.market === market)!;
    return conditionalGap({
      anchorBps: model.anchorBps,
      impactBps: model.impactBps,
      maxGapBps: model.maxGapBps,
      imbalance: vm.exposure.imbalance,
      inventory: inventory(v.holdings, market),
      widen,
    });
  }

  /** Latches a vault-wide halt when trading lost `maxDrawdownBps` of value since the
   * checkpoint: both baskets (per share) are marked at the same current prices, so stock-price
   * moves, deposits and withdrawals never count, only trading. */
  drawdown(
    v: Pick<VaultView, "totalSupply" | "holdings" | "markets">,
    references: Map<number, Reference>,
  ): boolean {
    if (v.totalSupply === 0n) return false;
    const spot = [...references.values()][0]?.spot;
    if (spot === undefined) return false;
    const marks = (market: number) => {
      const r = references.get(market),
        stored = this.state.markets[market]?.probability,
        model = this.model(market);
      const probability = r?.probability ?? (stored ? BigInt(stored) : PROB / 2n);
      const gapPpm =
        model && v.markets.some((m) => m.market === market)
          ? this.gap(model, v as VaultView, market, BPS)
          : 0n;
      return { probability, gapPpm };
    };
    const now = Date.now(),
      current = basket(v.holdings, v.totalSupply),
      checkpoint = this.state.checkpoint;
    const sameMarkets =
      checkpoint &&
      checkpoint.basket.markets.map((m) => m.market).join() ===
        current.markets.map((m) => m.market).join();
    if (!checkpoint || !sameMarkets || now - checkpoint.at >= this.settings.drawdownWindowMs) {
      this.state.checkpoint = { at: now, basket: current };
      return false;
    }
    const then = markedValue(holdingsOf(checkpoint.basket), spot, marks),
      value = markedValue(holdingsOf(current), spot, marks);
    if (then > 0n && (then - value) * BPS >= then * BigInt(this.settings.maxDrawdownBps)) {
      this.state.halted = true;
      this.log("drawdown-halt", { checkpointValue: then, value });
      return true;
    }
    return false;
  }

  /** Brings one market's quotes to the model's ladders; returns whether a transaction was sent. */
  private async quote(
    market: number,
    model: MarketModel,
    s: ChainState,
    v: VaultView,
    u: Units,
    r: Reference,
  ) {
    const m = s.markets.get(market)!,
      vm = v.markets.find((x) => x.market === market)!,
      nowMs = Date.now(),
      now = seconds(),
      set = this.settings;
    if (v.paused) throw new Error("Vault paused");
    // The guardian's exchange pause halts every placement: quotes would only fail.
    if (s.config.paused) throw new Error("Exchange paused");
    if (m.state !== OPEN || m.open > now) throw new Error("Market not open");
    // Orders must expire before the vault's cutoff buffer and within its lifetime limit, which
    // the vault measures from the block's timestamp: the latest block seen bounds it, as this
    // host's clock may run ahead of the chain's.
    const stopAt = BigInt(vm.cutoff - vm.risk.cutoffBuffer),
      expiry = min(now + BigInt(set.ttlSeconds), s.timestamp + BigInt(v.limits.maxTtl), stopAt);
    if (expiry <= now + BigInt(Math.ceil(set.pollMs / 1000) * 3))
      throw new Error("Quoting window closed before cutoff");
    const stale = set.allowStaleSpot && TESTNETS.includes(this.chainId);
    if (nowMs - r.observedAt > set.maxFeedAgeMs || r.observedAt > nowMs + 5000)
      throw new Error("Reference is stale");
    if (!stale && Math.abs(r.spotAt - r.probabilityAt) > set.maxSkewMs)
      throw new Error("Stock price and probability were observed too far apart");
    const oracle = v.oraclePrice;
    if (oracle === null) throw new Error("Vault oracle unavailable");
    if (abs(r.spot - oracle) * BPS > oracle * BigInt(set.maxOracleDeviationBps))
      throw new Error("Reference price and the vault oracle disagree");
    const makerBps = m.makerBps;
    if (makerBps > v.limits.maxFeeBps) throw new Error("Market maker fee exceeds the vault cap");

    // Jumps pause quoting for a cooldown; movement widens spreads.
    const record = this.record(market);
    if (record.observedAt !== undefined && r.observedAt < record.observedAt)
      throw new Error("Reference moved backwards");
    if (record.spot) {
      const move = (abs(r.spot - BigInt(record.spot)) * BPS) / BigInt(record.spot),
        probMove = abs(r.probability - BigInt(record.probability!));
      if (move >= BigInt(set.jumpBps) || probMove >= BigInt(set.probabilityJumpX6))
        record.cooldownUntil = nowMs + set.cooldownMs;
      if (move > 0n || probMove > 0n || nowMs - (record.movementAt ?? 0) >= set.pollMs) {
        record.movement = String((BigInt(record.movement ?? "0") * 3n + move) / 4n);
        record.movementAt = nowMs;
      }
    }
    record.spot = String(r.spot);
    record.probability = String(r.probability);
    record.observedAt = r.observedAt;
    if (nowMs < (record.cooldownUntil ?? 0)) throw new Error("Cooling down after a jump");

    const widen = widening(stopAt - now, set.wideningSeconds, set.wideningFactor);
    const gap = this.gap(model, v, market, widen);
    const fair = fairPrices(r.spot, r.probability, gap);
    const half = halfSpread({
      minBps: set.halfSpreadBps,
      makerBps,
      takerBps: m.takerBps,
      rebateBps: m.rebateBps,
      adverseSelectionBps: set.adverseSelectionBps,
      movementBps: BigInt(record.movement ?? "0"),
      probabilitySpread: r.spread,
      gapPpm: gap,
      widen,
    });
    // A liquid book implying another probability means the event's p or our flow is off.
    const best = foreignBook(s, this.vault, m);
    const implied = impliedProbability(best, r.spot);
    if (implied !== null && abs(implied - r.probability) > BigInt(set.maxProbabilityDriftX6))
      throw new Error("Order books imply a different probability than the reference");
    const own = vaultOrders(s, this.vault, market);
    const live = { epoch: traderOf(s, this.vault).epoch, maxFeeBps: makerBps };
    // Quoting only through RFQ, the vault leaves nothing resting on the book.
    const desired = !set.rfq.bookQuotes
      ? []
      : ladders({
          terms: m,
          fair,
          halfSpread: half,
          levels: set.quoteLevels,
          levelSpacingBps: set.levelSpacingBps,
          maxHalfSpreadBps: set.maxHalfSpreadBps,
          oracle,
          bandBps: vm.risk.bandBps,
          bandMarginBps: set.bandMarginBps,
          budget: units(model.orderQuote, u.quoteDecimals),
          maxOrder: vm.risk.maxOrder,
          maxResting: vm.risk.maxResting,
          imbalance: vm.exposure.imbalance,
          maxImbalance: vm.risk.maxImbalance,
          funds: marketFunds(v, market, own, m.tick, set.reserveBps),
          best,
          resting: own
            .filter((o) => keepable(o, now, set.pollMs, live))
            .map((o) => ({
              key: BigInt(o.key),
              branch: o.branch as 0 | 1,
              side: o.side as 0 | 1,
              price: o.ticks * m.tick,
              quantity: o.remaining,
              funding: o.fundingKind as 0 | 1,
            })),
          repriceBps: set.repriceBps,
        });
    const { cancels, places } = orderChanges(own, desired);
    this.log("plan", {
      market,
      spot: r.spot,
      probability: r.probability,
      gapPpm: gap,
      halfSpreadBps: half,
      fair,
      imbalance: vm.exposure.imbalance,
      quotes: desired.length,
      cancels: cancels.length,
      places: places.length,
    });
    if (!cancels.length && !places.length) return false;
    const quotes: DeltaVaultQuote[] = places.map((q) => ({
      order: {
        maker: this.vault,
        marketId: String(market),
        quantity: String(q.quantity),
        limitPriceRawX18: String(q.price),
        expiry: String(expiry),
        maxFeeBps: makerBps,
        branch: q.branch,
        side: q.side,
        fundingKind: q.funding,
        tif: 0,
      },
      nextSequence: m.seq[q.branch],
      deadline: min(now + 60n, expiry),
    }));
    if (!this.executor) {
      this.log("dry-run", { market, cancels, quotes: places });
      return false;
    }
    const fresh = () => !this.stopped && Date.now() - r.observedAt <= set.maxFeedAgeMs;
    await this.executor.send(
      deltaVaultUpdate(this.vault, market, cancels, quotes, m.tick),
      false,
      fresh,
    );
    return true;
  }

  // ---------------------------------------------------------------- RFQ

  /** The vault's position in `market` from the replica (exact, event by event), with its
   * resting orders and every outstanding quote counted as filled. */
  position(s: ChainState, v: VaultView, market: number, nowMs = Date.now()): VaultPosition {
    const vault = this.vault;
    const yes = accountOf(s, market, 0, vault),
      no = accountOf(s, market, 1, vault);
    let imbalance = yes.base - no.base,
      raise = 0n,
      lower = 0n,
      expected = 0n,
      plainBase = creditOf(s, vault, v.base),
      plainQuote = creditOf(s, vault, v.quote),
      claimBase: [bigint, bigint] = [yes.base, no.base];
    const funds: Funds = {
      quote: plainQuote,
      base: plainBase,
      quoteClaims: [yes.quote, no.quote],
      baseClaims: [yes.base, no.base],
    };
    for (const o of vaultOrders(s, vault)) {
      const m = s.markets.get(o.market);
      if (!m) continue;
      const sell = o.side === 1;
      // Escrow is the vault's: whole-funded orders hold plain credit, claim-funded ones claims.
      if (o.fundingKind === 0) {
        if (sell) plainBase += o.remaining;
        else plainQuote += reservation(0, o.remaining, o.ticks * m.tick);
      }
      if (o.market !== market) continue;
      if (sell && o.fundingKind === 1) {
        imbalance += o.branch === 0 ? o.remaining : -o.remaining;
        claimBase[o.branch as 0 | 1] += o.remaining;
      }
      if (sell === (o.branch === 1)) raise += o.remaining;
      else lower += o.remaining;
    }
    for (const [id, q] of this.outstanding) {
      if (q.expiresAtMs <= nowMs) {
        this.outstanding.delete(id);
        continue;
      }
      // Credit is shared by every market; claims belong to theirs.
      if (q.fundingKind === 0) {
        if (q.sells) funds.base -= q.quantity;
        else funds.quote -= q.notional;
      }
      if (q.market !== market) continue;
      if (q.fundingKind === 1) {
        if (q.sells) funds.baseClaims[q.branch] -= q.quantity;
        else funds.quoteClaims[q.branch] -= q.notional;
      }
      const raises = raisesImbalance({ branch: q.branch, side: q.sells ? 0 : 1 });
      if (raises) raise += q.quantity;
      else lower += q.quantity;
      expected += raises ? q.quantity : -q.quantity;
    }
    // The withdrawal reserve stays free, as for the book's ladders.
    const reserve = BigInt(this.settings.reserveBps);
    funds.quote -= min(funds.quote, (plainQuote * reserve) / BPS);
    funds.base -= min(funds.base, (plainBase * reserve) / BPS);
    for (const list of [funds.quoteClaims, funds.baseClaims])
      for (const b of [0, 1] as const) list[b] = max(0n, list[b]);
    return {
      imbalance,
      high: imbalance + raise,
      low: imbalance - lower,
      expected: imbalance + expected,
      inventory: plainBase + (claimBase[0] + claimBase[1]) / 2n,
      funds: { ...funds, quote: max(0n, funds.quote), base: max(0n, funds.base) },
    };
  }

  /** The vault's quote for one RFQ, from memory: the latest vault read, the replica and the
   * live references. The same safety gates as the book's quotes apply; a jump starts the same
   * cooldown. Synchronous: it is the whole of the response time but the signature. */
  rfqQuote(
    request: { market: number; order: RfqOrder & { taker: Address } },
    minQuoteSeconds: number,
  ): Pricing {
    const decline = (reason: string) => ({ decline: reason });
    const set = this.settings,
      nowMs = Date.now(),
      now = seconds();
    if (!set.rfq.enabled || !this.live) return decline("RFQ is off");
    if (this.state.halted) return decline("Drawdown latch set");
    const latest = this.latest;
    if (!latest || nowMs - latest.at > set.pollMs * 3) return decline("Vault view is stale");
    const v = latest.v,
      market = request.market,
      vm = v.markets.find((x) => x.market === market),
      model = this.model(market);
    if (!vm) return decline("Not a market of this vault");
    if (!model) return decline("Market not quoted");
    if (v.paused) return decline("Vault paused");
    if (request.order.taker === this.vault) return decline("The vault's own order");
    if (!this.follower.health().healthy) return decline("Chain view unavailable");
    const s = this.follower.confirmed,
      m = s.markets.get(market);
    if (s.config.paused) return decline("Exchange paused");
    if (!m || m.state !== OPEN || m.open > now) return decline("Market not open");
    if (v.oraclePrice === null) return decline("Vault oracle unavailable");
    let u: Units, r: Reference;
    try {
      u = this.units(s, v);
      r = this.live.reference(
        m,
        this.policy(),
        { ...set, maxFeedAgeMs: set.rfq.maxReferenceAgeMs },
        u,
        nowMs,
      );
    } catch (error) {
      return decline((error as Error).message);
    }
    // A move since the last round's reference as large as a jump pauses quoting, as the rounds
    // would on their next read.
    const record = this.record(market);
    if (record.spot && record.probability) {
      const move = (abs(r.spot - BigInt(record.spot)) * BPS) / BigInt(record.spot),
        probMove = abs(r.probability - BigInt(record.probability));
      if (move >= BigInt(set.jumpBps) || probMove >= BigInt(set.probabilityJumpX6))
        record.cooldownUntil = Math.max(record.cooldownUntil ?? 0, nowMs + set.cooldownMs);
    }
    if (nowMs < (record.cooldownUntil ?? 0)) return decline("Cooling down after a jump");
    return priceRfq({
      order: request.order,
      market: m,
      risk: { ...vm.risk, maxImbalance: vm.risk.maxImbalance },
      cutoff: vm.cutoff,
      limits: v.limits,
      oracle: v.oraclePrice,
      model,
      settings: set,
      reference: r,
      movementBps: BigInt(record.movement ?? "0"),
      position: this.position(s, v, market, nowMs),
      maxNotional: min(vm.risk.maxOrder, units(model.orderQuote, u.quoteDecimals)),
      now,
      nowMs,
      chainTime: s.timestamp,
      minQuoteSeconds,
      allowStaleSpot: set.allowStaleSpot && TESTNETS.includes(this.chainId),
    });
  }

  /** The vault's current prices, unsigned, for an order of `INDICATIVE_NOTIONAL` on each branch of
   * every market it holds: what an RFQ for that order would be quoted now (`rfqQuote`, from
   * memory). A side the vault would decline is null; a branch it quotes on neither side is left
   * out. The order is sized at the vault's oracle price. */
  indications(minQuoteSeconds: number) {
    const v = this.latest?.v,
      s = this.follower.confirmed;
    if (!v?.oraclePrice) return [];
    let u: Units;
    try {
      u = this.units(s, v);
    } catch {
      return [];
    }
    const quantity = (units(INDICATIVE_NOTIONAL, u.quoteDecimals) * WAD) / v.oraclePrice;
    const prices: { market: number; branch: 0 | 1; bid: bigint | null; ask: bigint | null }[] = [];
    for (const { market } of v.markets)
      for (const branch of [0, 1] as const) {
        const price = (side: 0 | 1) => {
          const limit = side === 0 ? UNLIMITED : 0n;
          const q = this.rfqQuote(
            { market, order: { branch, side, quantity, limit, taker: zeroAddress } },
            minQuoteSeconds,
          );
          return "decline" in q ? null : q.price;
        };
        const ask = price(0),
          bid = price(1);
        if ((ask !== null || bid !== null) && (ask === null || bid === null || bid <= ask))
          prices.push({ market, branch, bid, ask });
      }
    return prices;
  }

  /** What a request came to: a quote that lost (or never filled) frees its capacity at once; a
   * filled one keeps it until it expires, by when the replica holds the fill. */
  quoteOutcome(id: string, outcome: string) {
    if (outcome === "filled" || outcome === "partially_filled") this.follower.poke();
    else this.outstanding.delete(id);
  }
}
