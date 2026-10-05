import {
  approve,
  cancelMany,
  deposit,
  OPEN,
  type OrderWire,
  placement,
  planOrder,
  position,
  replace,
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
import { type Address, erc20Abi } from "viem";
import { abs, BPS, type MarketPolicy, max, min, type Settings, units } from "./config.ts";
import type { Executor } from "./execution.ts";
import { fetchReference, type Units } from "./feeds.ts";
import type { MarketState as RiskState, State } from "./state.ts";
import {
  type Book,
  equity,
  type Inventory,
  needsReplace,
  type Quote,
  quotes,
  type Reference,
} from "./strategy.ts";

export const log = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ event, ...detail }, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
const seconds = () => BigInt(Math.floor(Date.now() / 1000));

export function owned(s: ChainState, owner: Address, market?: number) {
  return [...s.orders.values()].filter(
    (o) =>
      o.owner === owner && o.status === "open" && (market === undefined || o.market === market),
  );
}
/** Claims per branch plus what the maker's own claim-funded orders reserve. */
export function inventory(s: ChainState, owner: Address, market: MarketState): Inventory {
  const yes = accountOf(s, market.id, 0, owner),
    no = accountOf(s, market.id, 1, owner);
  const inv: Inventory = { quote: [yes.quote, no.quote], base: [yes.base, no.base] };
  for (const o of owned(s, owner, market.id))
    if (o.fundingKind === 1)
      (o.side === 0 ? inv.quote : inv.base)[o.branch as 0 | 1] += reservation(
        o.side,
        o.remaining,
        o.ticks * market.tick,
      );
  return inv;
}
/** Target branch position in raw base units: explicit, or the base seed. */
export const targetBase = (p: MarketPolicy, u: Units) =>
  units(p.targetBase ?? p.baseInventory, u.baseDecimals);
/** Next cancel and/or placement bringing one ladder (branch x side) to the desired quotes. */
export function quoteChange(
  current: OrderState[],
  desired: Quote[],
  now: bigint,
  s: Settings,
  live: { makerBps: number; epoch: bigint; tick: bigint },
): { cancel?: string; quote?: Quote } | undefined {
  for (const branch of [0, 1] as const)
    for (const side of [0, 1] as const) {
      const ranked = current
          .filter((o) => o.branch === branch && o.side === side)
          .sort((a, b) =>
            a.ticks === b.ticks ? 0 : (a.ticks > b.ticks ? -1 : 1) * (side === 0 ? 1 : -1),
          ),
        targets = desired
          .filter((q) => q.branch === branch && q.side === side)
          .sort((a, b) => a.level - b.level);
      for (let level = 0; level < ranked.length; level++) {
        const o = ranked[level]!,
          target = targets[level];
        if (!target || o.fundingKind !== 1 || o.tif !== 0 || o.delegate) return { cancel: o.key };
        if (
          o.maxFeeBps !== live.makerBps ||
          o.epoch !== live.epoch ||
          o.remaining > target.quantity ||
          needsReplace(
            { price: o.ticks * live.tick, remaining: o.remaining, expiry: o.expiry },
            target,
            now,
            s,
          )
        )
          return { cancel: o.key, quote: target };
      }
      if (ranked.length < targets.length) return { quote: targets[ranked.length]! };
    }
  return undefined;
}
export function passiveOrder(
  owner: Address,
  m: MarketState,
  q: Quote,
  ttl: number,
  now: bigint,
): OrderWire {
  return {
    maker: owner,
    marketId: String(m.id),
    quantity: String(q.quantity),
    limitPriceRawX18: String(q.price),
    expiry: String(min(now + BigInt(ttl), m.cutoff - 1n)),
    maxFeeBps: m.makerBps,
    branch: q.branch,
    side: q.side,
    fundingKind: 1,
    tif: 0,
  };
}
/** Best foreign bid/ask per branch. */
export function foreignBook(s: ChainState, owner: Address, m: MarketState): Book {
  const best: Book = [{}, {}];
  for (const o of s.orders.values())
    if (o.market === m.id && o.owner !== owner && liveOrder(o, s)) {
      const top = best[o.branch as 0 | 1],
        price = o.ticks * m.tick;
      if (o.side === 0) top.bid = top.bid === undefined ? price : max(top.bid, price);
      else top.ask = top.ask === undefined ? price : min(top.ask, price);
    }
  return best;
}
function checkpoint(record: RiskState, r: Reference) {
  record.spot = String(r.spot);
  record.probability = String(r.probability);
  record.observedAt = r.observedAt;
}

export class Engine {
  stopped = false;
  constructor(
    readonly follower: ChainFollower,
    readonly tokens: TokenReader,
    readonly owner: Address,
    readonly chainId: number,
    readonly settings: Settings,
    readonly origin: string,
    readonly state: State,
    readonly save: () => void,
    readonly executor?: Executor,
    readonly readReference = fetchReference,
  ) {}

  private get exchange() {
    return this.follower.options.exchange;
  }

  /** The replica, never older than the maker's last included transaction. */
  async view() {
    const until = Date.now() + 15_000;
    while (this.follower.confirmed.block < BigInt(this.state.lastBlock)) {
      if (Date.now() > until)
        throw new Error("Chain view is behind the last submitted transaction");
      await Bun.sleep(100);
    }
    if (!this.follower.health().healthy) throw new Error("Chain view unavailable");
    return this.follower.confirmed;
  }

  async cancelMarket(id?: number, liveOnly = false) {
    if (!this.executor) return;
    await this.executor.reconcilePending();
    const now = seconds();
    const keys = owned(await this.view(), this.owner, id)
      .filter((o) => !liveOnly || o.expiry > now)
      .map((o) => o.key);
    for (let i = 0; i < keys.length; i += 64)
      await this.executor.send(cancelMany(this.exchange, keys.slice(i, i + 64)), true);
  }

  validateMarket(s: ChainState, p: MarketPolicy) {
    const m = s.markets.get(p.market),
      now = seconds();
    if (
      !m ||
      s.config.paused ||
      m.state !== OPEN ||
      m.open > now ||
      m.cutoff <= now + BigInt(this.settings.cutoffBufferSeconds)
    )
      throw new Error("Market paused, closed, or near cutoff");
    // The base token is a reviewed identity.
    if (m.base !== p.base) throw new Error("Market allocation identity changed");
    return m;
  }

  /** Token units and the issuer's live state; an issuer pause halts the market. */
  async units(s: ChainState, m: MarketState): Promise<Units> {
    await this.tokens.refreshLive([m.base]);
    const live = this.tokens.live.get(m.base)!;
    if (live.paused) throw new Error("The issuer paused the base token");
    const quoteDecimals = s.pools.get(s.quote)?.decimals,
      baseDecimals = s.pools.get(m.base)?.decimals;
    if (quoteDecimals === undefined || baseDecimals === undefined)
      throw new Error("Unlisted market token");
    return {
      chainId: this.chainId,
      quote: s.quote,
      quoteDecimals,
      baseDecimals,
      multiplier: live.multiplier,
    };
  }

  plan(s: ChainState, m: MarketState, p: MarketPolicy, r: Reference, u: Units) {
    const record = this.state.markets[p.market] ?? {};
    this.state.markets[p.market] = record;
    const now = Date.now();
    if (record.halted) throw new Error("Persistent market drawdown halt");
    if (
      now - r.observedAt > this.settings.maxFeedAgeMs ||
      r.observedAt > now + 5000 ||
      (record.observedAt !== undefined && r.observedAt < record.observedAt)
    )
      throw new Error("Reference is stale or moved backwards");
    if (record.spot) {
      const move = (abs(r.spot - BigInt(record.spot)) * BPS) / BigInt(record.spot),
        probMove = abs(r.probability - BigInt(record.probability!));
      if (
        move >= BigInt(this.settings.jumpBps) ||
        probMove >= BigInt(this.settings.probabilityJumpX6)
      )
        record.cooldownUntil = now + this.settings.cooldownMs;
      // Multiple cancel/replaces are one observation, not several volatility samples.
      if (move > 0n || probMove > 0n || now - (record.movementAt ?? 0) >= this.settings.pollMs) {
        record.movement = String((BigInt(record.movement ?? "0") * 3n + move) / 4n);
        record.movementAt = now;
      }
    }
    checkpoint(record, r);
    let inv: Inventory;
    if (this.executor) inv = inventory(s, this.owner, m);
    else {
      const cash = units(p.quoteInventory, u.quoteDecimals),
        seed = units(p.baseInventory, u.baseDecimals);
      inv = { quote: [cash, cash], base: [seed, seed] };
    }
    const mark = equity(inv, r, p.gapBps),
      peak = max(mark, BigInt(record.peak ?? "0"));
    record.peak = String(peak);
    if (peak > 0n && (peak - mark) * BPS >= peak * BigInt(this.settings.maxDrawdownBps))
      record.halted = true;
    this.save();
    if (record.halted || now < (record.cooldownUntil ?? 0)) throw new Error("Risk circuit breaker");
    return quotes({
      market: m,
      reference: r,
      gapBps: p.gapBps,
      inventory: inv,
      targetBase: targetBase(p, u),
      orderQuote: units(p.orderQuote, u.quoteDecimals),
      movementBps: BigInt(record.movement ?? "0"),
      settings: this.settings,
      best: foreignBook(s, this.owner, m),
    });
  }

  /** Signs one passive quote, replacing `cancelled` atomically when given. */
  private async submit(
    s: ChainState,
    m: MarketState,
    q: Quote,
    cancelled: OrderState | undefined,
    guard: () => boolean,
  ) {
    const now = seconds(),
      order = passiveOrder(this.owner, m, q, this.settings.ttlSeconds, now),
      a = accountOf(s, m.id, q.branch, this.owner);
    // A replaced order of the same ladder releases its reservation into the same claims.
    const released = cancelled
      ? reservation(cancelled.side, cancelled.remaining, cancelled.ticks * m.tick)
      : 0n;
    if ((q.side === 0 ? a.quote : a.base) + released < reservation(q.side, q.quantity, q.price))
      throw new Error("Seeded claim inventory is insufficient");
    const plan = planOrder({
      order,
      candidates: [],
      now,
      step: m.step,
      nextSequence: m.seq[q.branch],
      makerFeeBps: m.makerBps,
      takerFeeBps: m.takerBps,
    });
    log("quote", {
      market: m.id,
      branch: q.branch,
      side: q.side,
      level: q.level,
      price: q.price,
      quantity: q.quantity,
    });
    await this.executor!.send(
      cancelled
        ? replace(this.exchange, cancelled.key, order, plan, m.tick)
        : placement(this.exchange, order, plan, m.tick),
      false,
      guard,
    );
  }

  async cycle() {
    await this.executor?.reconcilePending();
    const initial = await this.view();
    const configured = new Set(this.settings.markets.map((p) => p.market));
    for (const id of new Set(owned(initial, this.owner).map((o) => o.market)))
      if (!configured.has(id)) await this.cancelMarket(id);
    log("discovery", {
      openMarkets: [...initial.markets.values()]
        .filter((m) => m.state === OPEN)
        .map((m) => ({ id: m.id, base: m.base, configured: configured.has(m.id) })),
    });
    for (const p of this.settings.markets) {
      if (this.stopped) break;
      let stage = "snapshot";
      try {
        // Serial cancel/replace, re-reading the book, issuer state and feeds for each action.
        for (let step = 0; step < 4 * this.settings.quoteLevels && !this.stopped; step++) {
          stage = "market-validation";
          const s = await this.view(),
            m = this.validateMarket(s, p);
          stage = "issuer-state";
          const u = await this.units(s, m);
          stage = "reference-feeds";
          const r = await this.readReference(this.origin, m, p, this.settings, u);
          stage = "inventory-and-risk";
          const desired = this.plan(s, m, p, r, u);
          if (step === 0)
            log("risk", {
              market: p.market,
              peakQuoteRaw: this.state.markets[p.market]?.peak,
              movementBps: this.state.markets[p.market]?.movement ?? "0",
            });
          if (!this.executor) {
            log("dry-run", {
              market: p.market,
              assumedSeedInventory: true,
              spot: r.spot,
              probability: r.probability,
              quotes: desired,
            });
            break;
          }
          const action = quoteChange(
            owned(s, this.owner, m.id),
            desired,
            seconds(),
            this.settings,
            {
              makerBps: m.makerBps,
              epoch: traderOf(s, this.owner).epoch,
              tick: m.tick,
            },
          );
          if (!action) break;
          stage = "execution";
          const fresh = () =>
            !this.stopped && Date.now() - r.observedAt <= this.settings.maxFeedAgeMs;
          if (!action.quote)
            await this.executor.send(cancelMany(this.exchange, [action.cancel!]), true);
          else
            await this.submit(
              s,
              m,
              action.quote,
              action.cancel ? s.orders.get(action.cancel) : undefined,
              fresh,
            );
        }
      } catch (error) {
        log("market-paused", {
          market: p.market,
          stage,
          reason: error instanceof Error ? error.message : "Safety check failed",
        });
        await this.cancelMarket(p.market);
      }
    }
  }

  /** One-time, resumable ladder placement from the last safe reference. It does not poll,
   * reprice, or cancel orders when that reference later ages. */
  async staticCycle() {
    if (!this.executor) throw new Error("Static placement requires explicit live execution");
    await this.executor.reconcilePending();
    for (const p of this.settings.markets) {
      if (this.stopped) break;
      let stage = "snapshot";
      try {
        const before = await this.view(),
          market = this.validateMarket(before, p),
          record = this.state.markets[p.market] ?? {};
        this.state.markets[p.market] = record;
        if (!record.fundComplete) throw new Error("Market lacks funded inventory");
        const u = await this.units(before, market),
          seed = units(p.baseInventory, u.baseDecimals),
          levels = this.settings.quoteLevels;
        const ladders = ["0:0", "1:0", ...(seed > 0n ? ["0:1", "1:1"] : [])];
        const resting = (s: ChainState) => {
          const now = seconds(),
            orders = owned(s, this.owner, market.id).filter((o) => o.expiry > now);
          const epoch = traderOf(s, this.owner).epoch;
          if (
            orders.some(
              (o) =>
                o.fundingKind !== 1 ||
                o.tif !== 0 ||
                o.delegate ||
                o.maxFeeBps !== market.makerBps ||
                o.epoch !== epoch,
            )
          )
            throw new Error("Static seed found an incompatible existing order");
          return orders;
        };
        const count = (orders: OrderState[], ladder: string) =>
          orders.filter((o) => `${o.branch}:${o.side}` === ladder).length;
        if (ladders.every((l) => count(resting(before), l) >= levels)) {
          log("static-market-complete", { market: p.market, alreadyPopulated: true });
          continue;
        }
        stage = "reference-feeds";
        const reference = await this.readReference(this.origin, market, p, this.settings, u);
        checkpoint(record, reference);
        this.save();
        const held = inventory(before, this.owner, market);
        const needed = seed - min(held.base[0], held.base[1], seed);
        if (needed > 0n) {
          stage = "base-top-up";
          await this.seedClaims(await this.view(), market, 1, needed);
        }
        stage = "execution";
        for (let step = 0; step < 4 * levels && !this.stopped; step++) {
          const s = await this.view(),
            m = this.validateMarket(s, p),
            existing = resting(s);
          const desired = quotes({
            market: m,
            reference,
            gapBps: p.gapBps,
            inventory: inventory(s, this.owner, m),
            targetBase: targetBase(p, u),
            orderQuote: units(p.orderQuote, u.quoteDecimals),
            movementBps: 0n,
            settings: this.settings,
            best: [{}, {}],
          });
          if (
            ladders.some(
              (l) => desired.filter((q) => `${q.branch}:${q.side}` === l).length !== levels,
            )
          )
            throw new Error("Inventory cannot back every requested static level");
          const q = desired.find(
            (q) =>
              count(existing, `${q.branch}:${q.side}`) < levels &&
              !existing.some(
                (o) => o.branch === q.branch && o.side === q.side && o.ticks * m.tick === q.price,
              ),
          );
          if (!q) {
            if (ladders.some((l) => count(existing, l) < levels))
              throw new Error("Static ladder could not fill every requested side");
            break;
          }
          await this.submit(s, m, q, undefined, () => !this.stopped);
        }
        log("static-market-complete", { market: p.market });
      } catch (error) {
        log("static-market-skipped", {
          market: p.market,
          stage,
          reason: error instanceof Error ? error.message : "Unknown failure",
        });
      }
    }
  }

  /** Splits `amount` of one collateral (0 quote, 1 base) into this market's YES and NO claims.
   * Unreserved vault credit is used first; only the deficit is deposited. */
  private async seedClaims(s: ChainState, m: MarketState, collateral: 0 | 1, amount: bigint) {
    const executor = this.executor!,
      token = collateral === 0 ? s.quote : m.base,
      guard = () => !this.stopped;
    const available = creditOf(s, this.owner, token);
    if (amount > available) {
      const deficit = amount - available;
      const allowance = await this.follower.options.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.owner, this.exchange],
      });
      if (allowance < deficit)
        await executor.send(approve(token, this.exchange, deficit), false, guard);
      await executor.send(deposit(this.exchange, token, deficit), false, guard);
    }
    // Transfer-fee tokens credit less than they send: split what was credited.
    const credited = creditOf(await this.view(), this.owner, token);
    await executor.send(
      position(this.exchange, "split", m.id, collateral, min(amount, credited)),
      false,
      guard,
    );
  }

  async fund() {
    if (!this.executor) throw new Error("Funding requires explicit live execution");
    await this.executor.reconcilePending();
    for (const p of this.settings.markets) {
      if (this.stopped) throw new Error("Funding interrupted");
      const s = await this.view(),
        m = this.validateMarket(s, p),
        record = this.state.markets[p.market] ?? {};
      this.state.markets[p.market] = record;
      if (record.fundComplete) continue;
      if (record.fundStarted)
        throw new Error(
          "Funding already attempted; inspect the journal and custody before any manual recovery",
        );
      const inv = inventory(s, this.owner, m);
      if ([...inv.quote, ...inv.base].some((v) => v !== 0n) || owned(s, this.owner, m.id).length)
        throw new Error("Funding requires an empty dedicated market position");
      const u = await this.units(s, m);
      checkpoint(record, await this.readReference(this.origin, m, p, this.settings, u));
      record.fundStarted = true;
      this.save(); // Never automatically top up losses, including after restart.
      const amounts = [
        units(p.quoteInventory, u.quoteDecimals),
        units(p.baseInventory, u.baseDecimals),
      ] as const;
      for (const collateral of [0, 1] as const)
        if (amounts[collateral] > 0n)
          await this.seedClaims(await this.view(), m, collateral, amounts[collateral]);
      record.fundComplete = true;
      this.save();
      log("funded", { market: p.market });
    }
  }
}
