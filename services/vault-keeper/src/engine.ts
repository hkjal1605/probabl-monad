import {
  ARCHIVED,
  type DeltaVaultHoldings,
  type DeltaVaultQuote,
  type DeltaVaultState,
  deltaVaultCancelAll,
  deltaVaultMerge,
  deltaVaultSettle,
  deltaVaultUpdate,
  OPEN,
  quote,
  REDEEMABLE,
  readDeltaVault,
  reservation,
} from "@conditional-stocks/evm-client";
import {
  type ChainState,
  type MarketState,
  type OrderState,
  traderOf,
} from "@conditional-stocks/evm-client/ledger";
import { type ChainFollower, liveOrder, type TokenReader } from "@conditional-stocks/indexer";
import {
  abs,
  BPS,
  type Executor,
  fetchReference,
  max,
  min,
  PROB,
  type Reference,
  TESTNETS,
  type Units,
  units,
} from "@conditional-stocks/operator";
import type { Address, PublicClient } from "viem";
import type { MarketModel, Settings } from "./config.ts";
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
import type { Basket, KeeperState, MarketRecord } from "./state.ts";

export const log = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ event, ...detail }, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
const seconds = () => BigInt(Math.floor(Date.now() / 1000));
const WAD = 10n ** 18n;

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
  v: DeltaVaultState,
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

/** Cancels and placements bringing the market's quotes to `desired`, per ladder (branch x side),
 * best price first. A resting quote is kept only if it is current, its funding and fee cap
 * match, it is not about to expire, and its price and size are close to the target (never
 * larger, so limits computed for the target hold). */
export function orderChanges(
  existing: OrderState[],
  desired: Quote[],
  now: bigint,
  s: Pick<Settings, "pollMs" | "repriceBps">,
  live: { epoch: bigint; maxFeeBps: number; tick: bigint },
) {
  const cancels: bigint[] = [],
    places: Quote[] = [];
  const horizon = now + BigInt(Math.ceil(s.pollMs / 1000) * 2);
  for (const branch of [0, 1] as const)
    for (const side of [0, 1] as const) {
      const ranked = existing
        .filter((o) => o.branch === branch && o.side === side)
        .sort((a, b) =>
          a.ticks === b.ticks ? 0 : (a.ticks > b.ticks ? -1 : 1) * (side === 0 ? 1 : -1),
        );
      const targets = desired
        .filter((q) => q.branch === branch && q.side === side)
        .sort((a, b) => a.level - b.level);
      for (let i = 0; i < Math.max(ranked.length, targets.length); i++) {
        const o = ranked[i],
          q = targets[i];
        const keep =
          o !== undefined &&
          q !== undefined &&
          o.fundingKind === q.funding &&
          o.tif === 0 &&
          !o.delegate &&
          o.epoch === live.epoch &&
          o.maxFeeBps === live.maxFeeBps &&
          o.expiry > horizon &&
          o.remaining <= q.quantity &&
          abs(o.ticks * live.tick - q.price) * BPS < q.price * BigInt(s.repriceBps) &&
          (q.quantity - o.remaining) * 4n < q.quantity;
        if (keep) continue;
        if (o) cancels.push(BigInt(o.key));
        if (q) places.push(q);
      }
    }
  return { cancels, places };
}

export class Keeper {
  stopped = false;
  constructor(
    readonly follower: ChainFollower,
    readonly tokens: TokenReader,
    readonly client: PublicClient,
    readonly chainId: number,
    readonly settings: Settings,
    readonly origin: string,
    readonly state: KeeperState,
    readonly save: () => void,
    readonly executor?: Executor,
    readonly readReference = fetchReference,
  ) {}

  get vault() {
    return this.settings.vault;
  }

  /** The replica, never older than the keeper's last included transaction, and the vault. */
  async snapshot() {
    const until = Date.now() + 15_000;
    while (this.follower.confirmed.block < BigInt(this.state.lastBlock)) {
      if (Date.now() > until)
        throw new Error("Chain view is behind the last submitted transaction");
      await Bun.sleep(100);
    }
    if (!this.follower.health().healthy) throw new Error("Chain view unavailable");
    const v = await readDeltaVault(this.client, this.vault);
    if (v.exchange !== this.follower.options.exchange)
      throw new Error("The vault trades on a different exchange");
    return { s: this.follower.confirmed, v };
  }

  /** Token units and the issuer's live state; an issuer pause stops quoting. */
  async units(s: ChainState, v: DeltaVaultState): Promise<Units> {
    await this.tokens.refreshLive([v.base]);
    const live = this.tokens.live.get(v.base)!;
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

  async cancelMarket(market: number) {
    if (!this.executor) return;
    await this.executor.reconcilePending();
    const { s, v } = await this.snapshot();
    const m = s.markets.get(market),
      keys = vaultOrders(s, this.vault, market).map((o) => BigInt(o.key));
    if (!m || !keys.length || !v.markets.some((x) => x.market === market)) return;
    await this.executor.send(deltaVaultUpdate(this.vault, market, keys, [], m.tick), true);
  }

  async cycle() {
    await this.executor?.reconcilePending();
    if (this.state.halted) {
      log("halted", { reason: "Drawdown latch set; an operator must review and clear it" });
      await this.cancelAll();
      return;
    }
    let { s, v } = await this.snapshot();
    // Resolved markets: redeem the vault's claims (anyone may; the keeper does it promptly).
    for (const { market } of v.markets) {
      const state = s.markets.get(market)?.state;
      if ((state === REDEEMABLE || state === ARCHIVED) && this.executor) {
        await this.executor.send(deltaVaultSettle(this.vault, market), true);
        log("settled", { market });
      }
    }
    ({ s, v } = await this.snapshot());
    const u = await this.units(s, v);
    const models = new Map(this.settings.markets.map((m) => [m.market, m]));
    const references = new Map<number, Reference>();
    await Promise.all(
      v.markets
        .filter(({ market }) => models.has(market) && s.markets.has(market))
        .map(async ({ market }) => {
          try {
            references.set(
              market,
              await this.readReference(
                this.origin,
                s.markets.get(market)!,
                this.policy(v),
                this.settings,
                u,
              ),
            );
          } catch (error) {
            log("reference-unavailable", { market, reason: (error as Error).message });
          }
        }),
    );
    if (this.drawdown(v, references)) {
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
    for (const { market } of v.markets) {
      if (this.stopped) break;
      const model = models.get(market);
      let stage = "validation";
      try {
        if (!model) {
          // Registered by the curator but not configured here: never leave quotes behind.
          await this.cancelMarket(market);
          continue;
        }
        const r = references.get(market);
        if (!r) throw new Error("Reference unavailable");
        stage = "quoting";
        await this.quote(model, s, v, u, r);
        ({ s, v } = await this.snapshot());
      } catch (error) {
        log("market-paused", {
          market,
          stage,
          reason: error instanceof Error ? error.message : "Safety check failed",
        });
        await this.cancelMarket(market);
      }
    }
  }

  /** Reviewed unit conversion of the vault stock's reference price. */
  private policy(v: DeltaVaultState) {
    return {
      base: v.base,
      basePriceMultiplier: this.settings.basePriceMultiplier,
      quotePriceMultiplier: this.settings.quotePriceMultiplier,
    };
  }

  /** Δ̂ of a market at the vault's current exposure. */
  private gap(model: MarketModel, v: DeltaVaultState, market: number, widen: bigint) {
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
  drawdown(v: DeltaVaultState, references: Map<number, Reference>): boolean {
    if (v.totalSupply === 0n) return false;
    const spot = [...references.values()][0]?.spot;
    if (spot === undefined) return false;
    const models = new Map(this.settings.markets.map((m) => [m.market, m]));
    const marks = (market: number) => {
      const r = references.get(market),
        stored = this.state.markets[market]?.probability,
        model = models.get(market);
      const probability = r?.probability ?? (stored ? BigInt(stored) : PROB / 2n);
      const gapPpm =
        model && v.markets.some((m) => m.market === market) ? this.gap(model, v, market, BPS) : 0n;
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
      this.save();
      return false;
    }
    const then = markedValue(holdingsOf(checkpoint.basket), spot, marks),
      value = markedValue(holdingsOf(current), spot, marks);
    if (then > 0n && (then - value) * BPS >= then * BigInt(this.settings.maxDrawdownBps)) {
      this.state.halted = true;
      this.save();
      log("drawdown-halt", { checkpointValue: then, value });
      return true;
    }
    return false;
  }

  private async quote(
    model: MarketModel,
    s: ChainState,
    v: DeltaVaultState,
    u: Units,
    r: Reference,
  ) {
    const market = model.market,
      m = s.markets.get(market)!,
      vm = v.markets.find((x) => x.market === market)!,
      nowMs = Date.now(),
      now = seconds(),
      set = this.settings;
    if (v.paused) throw new Error("Vault paused");
    if (m.state !== OPEN || m.open > now) throw new Error("Market not open");
    // Orders must expire before the vault's cutoff buffer and within its lifetime limit.
    const stopAt = BigInt(vm.cutoff - vm.risk.cutoffBuffer),
      expiry = min(now + BigInt(set.ttlSeconds), now + BigInt(v.limits.maxTtl), stopAt);
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
    const makerBps = s.config.makerBps;
    if (makerBps > v.limits.maxFeeBps) throw new Error("Exchange maker fee exceeds the vault cap");

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
    this.save();
    if (nowMs < (record.cooldownUntil ?? 0)) throw new Error("Cooling down after a jump");

    const widen = widening(stopAt - now, set.wideningSeconds, set.wideningFactor);
    const gap = this.gap(model, v, market, widen);
    const fair = fairPrices(r.spot, r.probability, gap);
    const half = halfSpread({
      minBps: set.halfSpreadBps,
      makerBps,
      adverseSelectionBps: set.adverseSelectionBps,
      movementBps: BigInt(record.movement ?? "0"),
      probabilitySpread: r.spread,
      gapPpm: gap,
      widen,
    });
    // A liquid book implying another probability means Polymarket's p or our flow is off.
    const best = foreignBook(s, this.vault, m);
    const implied = impliedProbability(best, r.spot);
    if (implied !== null && abs(implied - r.probability) > BigInt(set.maxProbabilityDriftX6))
      throw new Error("Order books imply a different probability than the reference");
    const own = vaultOrders(s, this.vault, market);
    const desired = ladders({
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
    });
    const { cancels, places } = orderChanges(own, desired, now, set, {
      epoch: traderOf(s, this.vault).epoch,
      maxFeeBps: makerBps,
      tick: m.tick,
    });
    log("plan", {
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
    if (!cancels.length && !places.length) return;
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
      log("dry-run", { market, cancels, quotes: places });
      return;
    }
    const fresh = () => !this.stopped && Date.now() - r.observedAt <= set.maxFeedAgeMs;
    await this.executor.send(
      deltaVaultUpdate(this.vault, market, cancels, quotes, m.tick),
      false,
      fresh,
    );
  }
}
