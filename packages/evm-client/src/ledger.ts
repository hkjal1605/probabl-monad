/** Exact replica of the contract ledger, rebuilt from its event log.
 *
 * Every state change of `ConditionalStocks` is announced by an event, so replaying the logs of
 * the deployment in order reproduces its storage: credits, pools, claims, open notional, resting
 * orders, grants and lifecycle. The replica books a taker's full reservation when it is placed and
 * returns what fills or an immediate-or-cancel release do not use at the end of the transaction;
 * after each transaction every balance equals the contract's. Reconciliation compares a sample of
 * on-chain storage with this replica and fails closed on any difference. */
import { type Address, decodeEventLog, getAddress, type Hex, type Log, zeroHash } from "viem";
import { conditionalStocksAbi } from "./abi.ts";
import type { GrantState } from "./delegation.ts";
import { AWAITING, quote, REDEEMABLE, reservation, U32_MAX, unpackOrder, WAD } from "./protocol.ts";

export interface Account {
  quote: bigint;
  base: bigint;
  notional: bigint;
}
export interface MarketState {
  id: number;
  base: Address;
  condition: Hex;
  yesIndex: number;
  noIndex: number;
  rulesHash: Hex;
  metadataHash: Hex;
  metadataUri: string;
  open: bigint;
  cutoff: bigint;
  tick: bigint;
  step: bigint;
  maxSteps: bigint;
  minNotional: bigint;
  maxOrder: bigint;
  maxWallet: bigint;
  maxMarket: bigint;
  state: number;
  openNotional: bigint;
  /** Next sequence per branch. */
  seq: [bigint, bigint];
  payouts: [number, number] | null;
  resolvedAt: bigint | null;
  backing: { quote: bigint; base: bigint };
  /** Accrued fee claims per branch. */
  fees: [{ quote: bigint; base: bigint }, { quote: bigint; base: bigint }];
  commitment: Hex | null;
  evidence: Hex | null;
  evidenceUri: string | null;
  resolutionTx: Hex | null;
  resolver: Address | null;
  createdBlock: bigint;
  createdAt: bigint;
  createdTx: Hex;
}
export type OrderStatus = "open" | "filled" | "cancelled";
export interface OrderState {
  key: string;
  market: number;
  branch: number;
  seq: bigint;
  owner: Address;
  delegate: Address | null;
  generation: number;
  epoch: bigint;
  side: number;
  fundingKind: number;
  tif: number;
  quantity: bigint;
  /** Limit price in market ticks (price = ticks x tick). */
  ticks: bigint;
  expiry: bigint;
  maxFeeBps: number;
  remaining: bigint;
  filled: bigint;
  feesPaid: bigint;
  status: OrderStatus;
  placedBlock: bigint;
  placedAt: bigint;
  placedTx: Hex;
  updatedBlock: bigint;
}
export interface TraderState {
  epoch: bigint;
  delegationEpoch: bigint;
}
export interface Config {
  admin: Address | null;
  pendingAdmin: Address | null;
  adminAfter: bigint;
  marketAdmin: Address | null;
  guardian: Address | null;
  resolutionAdmin: Address | null;
  paused: boolean;
  makerBps: number;
  takerBps: number;
}
export interface ChainState {
  block: bigint;
  hash: Hex;
  timestamp: bigint;
  quote: Address;
  config: Config;
  /** `underlying` is the bytes32 asset id (zero for the quote token). */
  pools: Map<Address, { liability: bigint; decimals: number; underlying: Hex }>;
  /** Key `${owner}:${token}`. */
  credits: Map<string, bigint>;
  markets: Map<number, MarketState>;
  /** Key `${market}:${branch}:${owner}`. */
  accounts: Map<string, Account>;
  /** Open orders plus closed ones not yet evicted after finalization. */
  orders: Map<string, OrderState>;
  traders: Map<Address, TraderState>;
  /** Key `${owner}:${delegate}`. */
  grants: Map<string, GrantState>;
}

export function emptyState(quote: Address): ChainState {
  return {
    block: 0n,
    hash: "0x",
    timestamp: 0n,
    quote: getAddress(quote),
    config: {
      admin: null,
      pendingAdmin: null,
      adminAfter: 0n,
      marketAdmin: null,
      guardian: null,
      resolutionAdmin: null,
      paused: false,
      makerBps: 0,
      takerBps: 0,
    },
    pools: new Map(),
    credits: new Map(),
    markets: new Map(),
    accounts: new Map(),
    orders: new Map(),
    traders: new Map(),
    grants: new Map(),
  };
}

export const creditKey = (owner: Address, token: Address) => `${owner}:${token}`;
export const accountKey = (market: number, branch: number, owner: Address) =>
  `${market}:${branch}:${owner}`;
export const grantKey = (owner: Address, delegate: Address) => `${owner}:${delegate}`;
export const orderKeyString = (market: number, branch: number, seq: bigint) =>
  ((BigInt(market) << 40n) | (BigInt(branch) << 32n) | seq).toString();

export const creditOf = (s: ChainState, owner: Address, token: Address) =>
  s.credits.get(creditKey(owner, token)) ?? 0n;
export const accountOf = (s: ChainState, market: number, branch: number, owner: Address): Account =>
  s.accounts.get(accountKey(market, branch, owner)) ?? { quote: 0n, base: 0n, notional: 0n };
export const traderOf = (s: ChainState, owner: Address): TraderState =>
  s.traders.get(owner) ?? { epoch: 0n, delegationEpoch: 0n };
export const priceOf = (m: MarketState, ticks: bigint) => ticks * m.tick;

/** What a replayed event changed, for stream invalidation and persistence. */
export interface Touched {
  markets: Set<number>;
  owners: Set<Address>;
  orders: Set<string>;
}
export const touched = (): Touched => ({
  markets: new Set(),
  owners: new Set(),
  orders: new Set(),
});

export interface DecodedEvent {
  name: string;
  args: Record<string, unknown>;
  block: bigint;
  timestamp: bigint;
  logIndex: number;
  transactionHash: Hex;
}

export function decodeLog(log: Log, timestamp: bigint): DecodedEvent {
  const decoded = decodeEventLog({ abi: conditionalStocksAbi, data: log.data, topics: log.topics });
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null)
    throw new Error("Pending log cannot be applied");
  return {
    name: decoded.eventName,
    args: decoded.args as Record<string, unknown>,
    block: log.blockNumber,
    timestamp,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
  };
}

class Replica {
  constructor(
    readonly s: ChainState,
    readonly changes: Touched,
  ) {}

  credit(owner: Address, token: Address, delta: bigint) {
    const key = creditKey(owner, token);
    const value = (this.s.credits.get(key) ?? 0n) + delta;
    if (value === 0n) this.s.credits.delete(key);
    else this.s.credits.set(key, value);
    this.changes.owners.add(owner);
  }
  account(market: number, branch: number, owner: Address, delta: Partial<Account>) {
    const key = accountKey(market, branch, owner);
    const a = this.s.accounts.get(key) ?? { quote: 0n, base: 0n, notional: 0n };
    const next = {
      quote: a.quote + (delta.quote ?? 0n),
      base: a.base + (delta.base ?? 0n),
      notional: a.notional + (delta.notional ?? 0n),
    };
    if (next.quote === 0n && next.base === 0n && next.notional === 0n) this.s.accounts.delete(key);
    else this.s.accounts.set(key, next);
    this.changes.owners.add(owner);
  }
  claim(market: number, branch: number, collateral: number, owner: Address, delta: bigint) {
    this.account(market, branch, owner, collateral === 0 ? { quote: delta } : { base: delta });
  }
  market(id: number) {
    const m = this.s.markets.get(id);
    if (!m) throw new Error(`Event references unknown market ${id}`);
    this.changes.markets.add(id);
    return m;
  }
  order(key: string) {
    const o = this.s.orders.get(key);
    if (!o) throw new Error(`Event references unknown order ${key}`);
    this.changes.orders.add(key);
    this.changes.markets.add(o.market);
    this.changes.owners.add(o.owner);
    return o;
  }
  token(m: MarketState, collateral: number) {
    return collateral === 0 ? this.s.quote : m.base;
  }
  /** Returns an order's reservation to its funding source (cancellation, IOC release). */
  release(o: OrderState, m: MarketState, block: bigint) {
    const price = priceOf(m, o.ticks);
    const notional = quote(o.remaining, price, true);
    const refund = reservation(o.side, o.remaining, price);
    if (o.fundingKind === 0) this.credit(o.owner, this.token(m, o.side), refund);
    else this.claim(o.market, o.branch, o.side, o.owner, refund);
    this.account(o.market, o.branch, o.owner, { notional: -notional });
    if (o.side === 0) m.openNotional -= notional;
    o.remaining = 0n;
    o.status = o.filled === o.quantity ? "filled" : "cancelled";
    o.updatedBlock = block;
  }
}

const bi = (value: unknown) => BigInt(value as bigint | number);
const num = (value: unknown) => Number(value as number | bigint);
const addr = (value: unknown) => getAddress(value as string);

/** Applies the logs of ONE transaction, in log order. Returns what changed. */
export function applyTransaction(
  s: ChainState,
  events: DecodedEvent[],
  changes = touched(),
): Touched {
  const r = new Replica(s, changes);
  const iocTakers: string[] = [];
  for (const e of events) {
    const a = e.args;
    switch (e.name) {
      case "AdminAccepted":
        s.config.admin = addr(a.admin);
        s.config.pendingAdmin = null;
        s.config.adminAfter = 0n;
        break;
      case "AdminProposed":
        s.config.pendingAdmin = bi(a.successor) === 0n ? null : addr(a.successor);
        s.config.adminAfter = bi(a.acceptableAfter);
        break;
      case "Configured":
        s.config.marketAdmin = addr(a.marketAdmin);
        s.config.guardian = addr(a.guardian);
        s.config.resolutionAdmin = addr(a.resolutionAdmin);
        s.config.makerBps = num(a.makerBps);
        s.config.takerBps = num(a.takerBps);
        for (const id of s.markets.keys()) changes.markets.add(id);
        break;
      case "PauseSet":
        s.config.paused = a.paused as boolean;
        for (const id of s.markets.keys()) changes.markets.add(id);
        break;
      case "PoolListed":
        s.pools.set(addr(a.token), {
          liability: 0n,
          decimals: num(a.decimals),
          underlying: a.underlying as Hex,
        });
        break;
      // Governance only: an extension's own events are unknown here and stop the index.
      case "ExtensionProposed":
      case "ExtensionActivated":
      case "ExtensionCancelled":
        break;
      case "Deposited": {
        const token = addr(a.token);
        const pool = s.pools.get(token);
        if (!pool) throw new Error("Deposit to an unlisted pool");
        pool.liability += bi(a.amount);
        r.credit(addr(a.owner), token, bi(a.amount));
        break;
      }
      case "Withdrawn": {
        const token = addr(a.token);
        const pool = s.pools.get(token);
        if (!pool) throw new Error("Withdrawal from an unlisted pool");
        pool.liability -= bi(a.amount);
        r.credit(addr(a.owner), token, -bi(a.amount));
        break;
      }
      case "MarketCreated": {
        const p = a.params as Record<string, unknown>;
        const id = num(a.market);
        s.markets.set(id, {
          id,
          base: addr(p.base),
          condition: p.condition as Hex,
          yesIndex: num(p.yesIndex),
          noIndex: num(p.noIndex),
          rulesHash: p.rulesHash as Hex,
          metadataHash: p.metadataHash as Hex,
          metadataUri: a.metadataUri as string,
          open: bi(p.open),
          cutoff: bi(p.cutoff),
          tick: bi(p.tick),
          step: bi(p.step),
          maxSteps: bi(p.maxSteps),
          minNotional: bi(p.minNotional),
          maxOrder: bi(p.maxOrder),
          maxWallet: bi(p.maxWallet),
          maxMarket: bi(p.maxMarket),
          state: 1,
          openNotional: 0n,
          seq: [0n, 0n],
          payouts: null,
          resolvedAt: null,
          backing: { quote: 0n, base: 0n },
          fees: [
            { quote: 0n, base: 0n },
            { quote: 0n, base: 0n },
          ],
          commitment: null,
          evidence: null,
          evidenceUri: null,
          resolutionTx: null,
          resolver: null,
          createdBlock: e.block,
          createdAt: e.timestamp,
          createdTx: e.transactionHash,
        });
        changes.markets.add(id);
        break;
      }
      case "MarketState": {
        const m = r.market(num(a.market));
        m.state = num(a.state);
        if (m.state === AWAITING) m.commitment = a.commitment as Hex;
        break;
      }
      case "MarketResolved": {
        const m = r.market(num(a.market));
        m.payouts = [num(a.yes), num(a.no)];
        m.resolvedAt = e.timestamp;
        m.commitment = null;
        m.evidence = a.evidence as Hex;
        m.evidenceUri = a.uri as string;
        m.resolutionTx = e.transactionHash;
        m.resolver = addr(a.actor);
        m.state = REDEEMABLE;
        break;
      }
      case "PositionChanged": {
        const m = r.market(num(a.market));
        const owner = addr(a.owner),
          kind = num(a.kind),
          c = num(a.collateral),
          amount = bi(a.amount),
          yes = bi(a.yes),
          no = bi(a.no);
        const token = r.token(m, c);
        const side = c === 0 ? "quote" : "base";
        if (kind === 0) {
          r.credit(owner, token, -amount);
          m.backing[side] += amount;
          r.claim(m.id, 0, c, owner, yes);
          r.claim(m.id, 1, c, owner, no);
        } else {
          r.claim(m.id, 0, c, owner, -yes);
          r.claim(m.id, 1, c, owner, -no);
          m.backing[side] -= amount;
          r.credit(owner, token, amount);
        }
        break;
      }
      case "ClaimTransferred": {
        const m = r.market(num(a.market));
        const asset = num(a.asset),
          c = Math.floor(asset / 3),
          branch = (asset % 3) - 1;
        r.claim(m.id, branch, c, addr(a.from), -bi(a.amount));
        r.claim(m.id, branch, c, addr(a.to), bi(a.amount));
        break;
      }
      case "FeesClaimed": {
        const m = r.market(num(a.market));
        const asset = num(a.asset),
          c = Math.floor(asset / 3),
          branch = (asset % 3) - 1;
        m.fees[branch]![c === 0 ? "quote" : "base"] -= bi(a.amount);
        r.claim(m.id, branch, c, addr(a.to), bi(a.amount));
        break;
      }
      case "OrdersInvalidated": {
        const owner = addr(a.owner);
        s.traders.set(owner, { ...traderOf(s, owner), epoch: bi(a.epoch) });
        changes.owners.add(owner);
        for (const o of s.orders.values())
          if (o.owner === owner && o.status === "open") changes.markets.add(o.market);
        break;
      }
      case "DelegatesRevoked": {
        const owner = addr(a.owner);
        s.traders.set(owner, { ...traderOf(s, owner), delegationEpoch: bi(a.epoch) });
        changes.owners.add(owner);
        for (const o of s.orders.values())
          if (o.owner === owner && o.delegate) changes.markets.add(o.market);
        break;
      }
      case "DelegateApproved": {
        const owner = addr(a.owner),
          delegate = addr(a.delegate);
        s.grants.set(grantKey(owner, delegate), {
          owner,
          delegate,
          market: num(a.market),
          epoch: bi(a.epoch),
          generation: num(a.generation),
          expiresAt: bi(a.expiresAt),
          maxOrderQuote: bi(a.maxOrderQuote),
          totalQuote: bi(a.totalQuote),
          remainingQuote: bi(a.totalQuote),
          maxOrderBase: bi(a.maxOrderBase),
          totalBase: bi(a.totalBase),
          remainingBase: bi(a.totalBase),
          maxFeeBps: num(a.maxFeeBps),
          permissions: num(a.permissions),
          revoked: false,
        });
        changes.owners.add(owner);
        for (const o of s.orders.values())
          if (o.owner === owner && o.delegate === delegate) changes.markets.add(o.market);
        break;
      }
      case "DelegateRevoked": {
        const owner = addr(a.owner),
          delegate = addr(a.delegate);
        const grant = s.grants.get(grantKey(owner, delegate));
        if (!grant) throw new Error("Revocation of an unknown grant");
        grant.revoked = true;
        changes.owners.add(owner);
        for (const o of s.orders.values())
          if (o.owner === owner && o.delegate === delegate) changes.markets.add(o.market);
        break;
      }
      case "OrderPlaced": {
        const m = r.market(num(a.market));
        const u = unpackOrder(bi(a.order));
        const owner = addr(a.owner),
          seq = bi(a.seq),
          delegate = bi(a.delegate) === 0n ? null : addr(a.delegate);
        const price = priceOf(m, u.ticks);
        const notional = quote(u.quantity, price, true);
        const key = orderKeyString(m.id, u.branch, seq);
        let generation = 0;
        if (delegate) {
          const grant = s.grants.get(grantKey(owner, delegate));
          if (!grant) throw new Error("Delegated order without a grant");
          // A sell spends the base budget by quantity, a buy the quote budget by notional.
          if (u.side === 1) grant.remainingBase -= u.quantity;
          else grant.remainingQuote -= notional;
          generation = grant.generation;
        }
        m.seq[u.branch] = seq + 1n;
        // Book the full reservation; fills and releases return what is unused.
        const reserved = reservation(u.side, u.quantity, price);
        if (u.fundingKind === 0) r.credit(owner, r.token(m, u.side), -reserved);
        else r.claim(m.id, u.branch, u.side, owner, -reserved);
        r.account(m.id, u.branch, owner, { notional });
        // The market cap counts resting bids only (an ask escrows base, not quote).
        if (u.side === 0) m.openNotional += notional;
        s.orders.set(key, {
          key,
          market: m.id,
          branch: u.branch,
          seq,
          owner,
          delegate,
          generation,
          epoch: traderOf(s, owner).epoch,
          side: u.side,
          fundingKind: u.fundingKind,
          tif: u.tif,
          quantity: u.quantity,
          ticks: u.ticks,
          expiry: u.expiry,
          maxFeeBps: u.maxFeeBps,
          remaining: u.quantity,
          filled: 0n,
          feesPaid: 0n,
          status: "open",
          placedBlock: e.block,
          placedAt: e.timestamp,
          placedTx: e.transactionHash,
          updatedBlock: e.block,
        });
        changes.orders.add(key);
        if (u.tif === 1) iocTakers.push(key);
        break;
      }
      case "Trade": {
        const m = r.market(num(a.market));
        const fill = bi(a.fill),
          amounts = bi(a.amounts),
          fees = bi(a.fees);
        const q = fill & ((1n << 96n) - 1n),
          makerSeq = (fill >> 96n) & U32_MAX,
          takerSeq = (fill >> 128n) & U32_MAX,
          branch = Number((fill >> 160n) & 0xffn),
          quoteAmount = amounts & ((1n << 128n) - 1n),
          improvement = amounts >> 128n,
          buyerFee = fees & ((1n << 128n) - 1n),
          sellerFee = fees >> 128n;
        const maker = r.order(orderKeyString(m.id, branch, makerSeq));
        const taker = r.order(orderKeyString(m.id, branch, takerSeq));
        const [buyer, seller] = taker.side === 0 ? [taker, maker] : [maker, taker];
        const buyPrice = priceOf(m, buyer.ticks),
          sellPrice = priceOf(m, seller.ticks);
        const buyReduction =
          quote(buyer.remaining, buyPrice, true) - quote(buyer.remaining - q, buyPrice, true);
        const sellReduction =
          quote(seller.remaining, sellPrice, true) - quote(seller.remaining - q, sellPrice, true);
        if (
          q <= 0n ||
          q > buyer.remaining ||
          q > seller.remaining ||
          buyReduction - quoteAmount !== improvement ||
          quoteAmount !== (q * priceOf(m, maker.ticks)) / WAD
        )
          throw new Error(`Trade replay diverged in ${e.transactionHash}`);
        const inactive = 1 - branch;
        // Base leg: the seller's reservation delivers stock claims to the buyer.
        if (seller.fundingKind === 0) {
          m.backing.base += q;
          r.claim(m.id, inactive, 1, seller.owner, q);
        }
        r.claim(m.id, branch, 1, buyer.owner, q - buyerFee);
        m.fees[branch]!.base += buyerFee;
        // Quote leg: the buyer's reservation pays quote claims to the seller.
        if (buyer.fundingKind === 0) {
          m.backing.quote += quoteAmount;
          r.claim(m.id, inactive, 0, buyer.owner, quoteAmount);
        }
        r.claim(m.id, branch, 0, seller.owner, quoteAmount - sellerFee);
        m.fees[branch]!.quote += sellerFee;
        if (improvement !== 0n) {
          if (buyer.fundingKind === 0) r.credit(buyer.owner, s.quote, improvement);
          else r.claim(m.id, branch, 0, buyer.owner, improvement);
        }
        r.account(m.id, branch, buyer.owner, { notional: -buyReduction });
        r.account(m.id, branch, seller.owner, { notional: -sellReduction });
        m.openNotional -= buyReduction;
        for (const [o, paid] of [
          [buyer, buyerFee],
          [seller, sellerFee],
        ] as const) {
          o.remaining -= q;
          o.filled += q;
          o.feesPaid += paid;
          o.updatedBlock = e.block;
          if (o.remaining === 0n) o.status = "filled";
        }
        break;
      }
      case "OrderCancelled": {
        const key = bi(a.key).toString();
        const o = r.order(key);
        if (o.status !== "open") throw new Error(`Cancellation of a closed order ${key}`);
        r.release(o, r.market(o.market), e.block);
        o.status = "cancelled";
        break;
      }
      default:
        throw new Error(`Unhandled protocol event ${e.name}`);
    }
  }
  // Immediate-or-cancel remainders never rest: the contract never reserved them.
  for (const key of iocTakers) {
    const o = s.orders.get(key)!;
    if (o.remaining !== 0n) r.release(o, r.market(o.market), o.updatedBlock);
  }
  return changes;
}

/** Execution details of a Trade, resolved against a replica that already applied it (both
 * orders remain in the replica until finalized eviction). */
export function tradeDetails(s: ChainState, e: DecodedEvent) {
  const fill = BigInt(e.args.fill as bigint);
  const market = Number(e.args.market);
  const branch = Number((fill >> 160n) & 0xffn);
  const makerKey = orderKeyString(market, branch, (fill >> 96n) & U32_MAX);
  const takerKey = orderKeyString(market, branch, (fill >> 128n) & U32_MAX);
  const maker = s.orders.get(makerKey),
    taker = s.orders.get(takerKey),
    m = s.markets.get(market);
  return {
    makerKey,
    takerKey,
    maker: maker?.owner ?? null,
    taker: taker?.owner ?? null,
    takerSide: taker?.side ?? null,
    price: maker && m ? (maker.ticks * m.tick).toString() : null,
  };
}
export type TradeDetails = ReturnType<typeof tradeDetails>;

/** Groups decoded logs by transaction (logs arrive in block and log order). */
export function* transactions(events: DecodedEvent[]) {
  let batch: DecodedEvent[] = [];
  for (const e of events) {
    if (
      batch.length &&
      (batch[0]!.transactionHash !== e.transactionHash || batch[0]!.block !== e.block)
    ) {
      yield batch;
      batch = [];
    }
    batch.push(e);
  }
  if (batch.length) yield batch;
}

/** Deep copy (the confirmed view is rebuilt from the finalized base after a reorg). */
export function cloneState(s: ChainState): ChainState {
  return {
    ...s,
    config: { ...s.config },
    pools: new Map([...s.pools].map(([k, v]) => [k, { ...v }])),
    credits: new Map(s.credits),
    markets: new Map(
      [...s.markets].map(([k, m]) => [
        k,
        {
          ...m,
          seq: [...m.seq] as [bigint, bigint],
          backing: { ...m.backing },
          fees: [{ ...m.fees[0] }, { ...m.fees[1] }],
          payouts: m.payouts ? ([...m.payouts] as [number, number]) : null,
        },
      ]),
    ),
    accounts: new Map([...s.accounts].map(([k, v]) => [k, { ...v }])),
    orders: new Map([...s.orders].map(([k, v]) => [k, { ...v }])),
    traders: new Map([...s.traders].map(([k, v]) => [k, { ...v }])),
    grants: new Map([...s.grants].map(([k, v]) => [k, { ...v }])),
  };
}

// ------------------------------------------------------------------ checkpoint serialization

const replacer = (_key: string, value: unknown) =>
  typeof value === "bigint"
    ? { $n: value.toString() }
    : value instanceof Map
      ? { $m: [...value] }
      : value;
const reviver = (_key: string, value: unknown) => {
  if (value && typeof value === "object") {
    if ("$n" in value) return BigInt((value as { $n: string }).$n);
    if ("$m" in value) return new Map((value as { $m: [unknown, unknown][] }).$m);
  }
  return value;
};
export const serializeState = (s: ChainState) => JSON.stringify(s, replacer);
export function deserializeState(text: string) {
  const s = JSON.parse(text, reviver) as ChainState;
  // Checkpoints written before pools carried an underlying.
  for (const pool of s.pools.values()) pool.underlying ??= zeroHash;
  return s;
}

// Compact checkpoints: the large collections (credits, accounts, orders, traders) are positional
// rows with bigints as decimal strings, parsed without a reviver; the few markets, pools and
// grants keep the tagged form. About half the size of `serializeState` and several times faster
// to write and read.
type Kind = "b" | "v";
const ACCOUNT_FIELDS = { quote: "b", base: "b", notional: "b" } satisfies Record<
  keyof Account,
  Kind
>;
const TRADER_FIELDS = { epoch: "b", delegationEpoch: "b" } satisfies Record<
  keyof TraderState,
  Kind
>;
const ORDER_FIELDS = {
  key: "v",
  market: "v",
  branch: "v",
  seq: "b",
  owner: "v",
  delegate: "v",
  generation: "v",
  epoch: "b",
  side: "v",
  fundingKind: "v",
  tif: "v",
  quantity: "b",
  ticks: "b",
  expiry: "b",
  maxFeeBps: "v",
  remaining: "b",
  filled: "b",
  feesPaid: "b",
  status: "v",
  placedBlock: "b",
  placedAt: "b",
  placedTx: "v",
  updatedBlock: "b",
} satisfies Record<keyof OrderState, Kind>;

const columns = (fields: Record<string, Kind>) => {
  const names = Object.keys(fields);
  return { names, bigint: names.map((name) => fields[name] === "b") };
};
const ACCOUNT = columns(ACCOUNT_FIELDS),
  TRADER = columns(TRADER_FIELDS),
  ORDER = columns(ORDER_FIELDS);
const pack = (c: ReturnType<typeof columns>, value: object, lead: unknown[] = []) => {
  const row = lead;
  for (let i = 0; i < c.names.length; i++) {
    const field = (value as Record<string, unknown>)[c.names[i]!];
    row.push(c.bigint[i] ? (field as bigint).toString() : field);
  }
  return row;
};
const unpack = <T>(c: ReturnType<typeof columns>, row: unknown[], offset = 0): T => {
  const value: Record<string, unknown> = {};
  for (let i = 0; i < c.names.length; i++)
    value[c.names[i]!] = c.bigint[i] ? BigInt(row[offset + i] as string) : row[offset + i];
  return value as T;
};
const tag = (value: unknown): unknown =>
  typeof value === "bigint"
    ? { $n: value.toString() }
    : Array.isArray(value)
      ? value.map(tag)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tag(v)]))
        : value;
const untag = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(untag)
    : value !== null && typeof value === "object"
      ? "$n" in value
        ? BigInt((value as { $n: string }).$n)
        : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, untag(v)]))
      : value;

const CHECKPOINT_VERSION = 2;

/** Compact JSON form of a replica (see `restoreState`). */
export function encodeCheckpoint(s: ChainState): string {
  return JSON.stringify({
    v: CHECKPOINT_VERSION,
    block: s.block.toString(),
    hash: s.hash,
    timestamp: s.timestamp.toString(),
    quote: s.quote,
    config: tag(s.config),
    pools: tag([...s.pools]),
    markets: tag([...s.markets.values()]),
    grants: tag([...s.grants.values()]),
    credits: [...s.credits].map(([key, amount]) => [key, amount.toString()]),
    accounts: [...s.accounts].map(([key, a]) => pack(ACCOUNT, a, [key])),
    orders: [...s.orders.values()].map((o) => pack(ORDER, o)),
    traders: [...s.traders].map(([owner, t]) => pack(TRADER, t, [owner])),
  });
}

/** Replica from a checkpoint in either form (`encodeCheckpoint` or legacy `serializeState`). */
export function restoreState(text: string): ChainState {
  if (!text.startsWith('{"v":')) return deserializeState(text);
  const c = JSON.parse(text);
  if (c.v !== CHECKPOINT_VERSION) throw new Error(`Unsupported checkpoint version ${c.v}`);
  const markets = untag(c.markets) as MarketState[];
  const grants = untag(c.grants) as GrantState[];
  return {
    block: BigInt(c.block),
    hash: c.hash,
    timestamp: BigInt(c.timestamp),
    quote: c.quote,
    config: untag(c.config) as Config,
    pools: new Map(
      untag(c.pools) as [Address, { liability: bigint; decimals: number; underlying: Hex }][],
    ),
    credits: new Map(
      (c.credits as [string, string][]).map(([key, amount]) => [key, BigInt(amount)]),
    ),
    markets: new Map(markets.map((m) => [m.id, m])),
    accounts: new Map(
      (c.accounts as unknown[][]).map((row) => [
        row[0] as string,
        unpack<Account>(ACCOUNT, row, 1),
      ]),
    ),
    orders: new Map(
      (c.orders as unknown[][]).map((row) => {
        const o = unpack<OrderState>(ORDER, row);
        return [o.key, o];
      }),
    ),
    traders: new Map(
      (c.traders as unknown[][]).map((row) => [
        row[0] as Address,
        unpack<TraderState>(TRADER, row, 1),
      ]),
    ),
    grants: new Map(grants.map((g) => [grantKey(g.owner, g.delegate), g])),
  };
}
