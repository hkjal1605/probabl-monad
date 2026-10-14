/** JSON views of the replica served to the API and UI (`protocolVersion: 4`). Quantities are
 * raw base units, prices raw quote units per raw base unit x 1e18, amounts raw token units.
 *
 * Markets are addressed by their chain-independent public id (`marketId`); every on-chain
 * market is a venue of one, described by `venue` (deployment and on-chain market id). */
import type { ClosedOrderRecord, TradeRecord } from "@conditional-stocks/db";
import {
  activeDelegation,
  eventKey,
  marketKey,
  marketSlug,
  publicMarketId,
  QUOTE_SEQ,
  U32_MAX,
  underlyingSymbol,
} from "@conditional-stocks/evm-client";
import {
  accountKey,
  type ChainState,
  creditOf,
  type DecodedEvent,
  grantKey,
  type MarketState,
  type OrderState,
  orderKeyString,
  type TradeDetails,
  traderOf,
} from "@conditional-stocks/evm-client/ledger";
import { type Address, getAddress, type Hex, zeroHash } from "viem";

export const PROTOCOL_VERSION = 4;
export const PRICE_FORMAT = "raw-unit-ratio-x18";

/** Live state of a market's base token (issuer pause and UI multiplier), read periodically. */
export interface BaseLive {
  /** Issuer UI multiplier x 1e18 (1e18 when the token has none). */
  multiplier: bigint;
  paused: boolean;
}

export const decimalsOf = (s: ChainState, token: Address) => s.pools.get(token)?.decimals ?? 0;

/** The deployment these views describe. */
export interface Deployment {
  chainId: number;
  exchange: Address;
}
export const venueOf = (d: Deployment, market: number) => ({
  chainId: d.chainId,
  exchange: d.exchange,
  marketId: String(market),
});

export interface MarketIdentity {
  /** Public market id: 16 hex digits of the market key. */
  id: string;
  key: Hex;
  eventKey: Hex;
  /** e.g. "US:NVDA"; null when the base token was listed without a readable underlying. */
  underlying: string | null;
  /** URL segment: ticker prefix plus the public id. */
  slug: string;
}
const identities = new Map<string, MarketIdentity>();
/** Chain-independent identity of a market (as the contract's `marketKey`), memoized. */
export function marketIdentity(s: ChainState, m: MarketState): MarketIdentity {
  const asset = s.pools.get(m.base)?.underlying ?? zeroHash;
  const memo = `${m.condition}:${m.yesIndex}:${m.noIndex}:${asset}`;
  let identity = identities.get(memo);
  if (!identity) {
    const event = eventKey(m.condition, m.yesIndex, m.noIndex);
    const key = marketKey(event, asset);
    const id = publicMarketId(key);
    const underlying = underlyingSymbol(asset);
    identity = { id, key, eventKey: event, underlying, slug: marketSlug(id, underlying) };
    identities.set(memo, identity);
  }
  return identity;
}
export const publicIdOf = (s: ChainState, market: number) => {
  const m = s.markets.get(market);
  return m ? marketIdentity(s, m).id : String(market);
};

/** Open beats any other state, archived loses to all; ties go to the newest. */
const rank = (m: MarketState) => (m.state === 2 ? 2 : m.state === 7 ? 0 : 1) * 2 ** 32 + m.id;
const representatives = new WeakMap<
  ChainState,
  { block: bigint; count: number; byId: Map<string, MarketState> }
>();
/** One venue per public market on this deployment: an open one, else the newest not archived,
 * else the newest. Other venues of the same event and asset stay reachable by on-chain id. */
export function publicMarkets(s: ChainState): Map<string, MarketState> {
  const cached = representatives.get(s);
  if (cached && cached.block === s.block && cached.count === s.markets.size) return cached.byId;
  const byId = new Map<string, MarketState>();
  for (const m of s.markets.values()) {
    const id = marketIdentity(s, m).id;
    const current = byId.get(id);
    if (!current || rank(m) > rank(current)) byId.set(id, m);
  }
  representatives.set(s, { block: s.block, count: s.markets.size, byId });
  return byId;
}

export interface TokenIdentity {
  symbol: string | null;
  name: string | null;
}

export function marketView(
  s: ChainState,
  m: MarketState,
  deployment: Deployment,
  live?: BaseLive,
  identity: (token: Address) => TokenIdentity | undefined = () => undefined,
) {
  const baseDecimals = decimalsOf(s, m.base);
  const base = identity(m.base),
    quote = identity(s.quote);
  const halt = live?.paused ? "issuer-paused" : null;
  const market = marketIdentity(s, m);
  return {
    id: market.id,
    marketKey: market.key,
    eventKey: market.eventKey,
    underlying: market.underlying,
    slug: market.slug,
    venue: venueOf(deployment, m.id),
    createdAt: new Date(Number(m.createdAt) * 1000).toISOString(),
    conditionId: String(m.id),
    polymarketConditionId: m.condition,
    polymarketYesIndex: String(m.yesIndex),
    polymarketNoIndex: String(m.noIndex),
    rulesHash: m.rulesHash,
    metadataHash: m.metadataHash,
    metadataUri: m.metadataUri,
    state: m.state,
    tradingOpen: m.open.toString(),
    tradingCutoff: m.cutoff.toString(),
    priceTickRawX18: m.tick.toString(),
    baseStep: m.step.toString(),
    minNotional: m.minNotional.toString(),
    maxOrderQuantity: (m.step * m.maxSteps).toString(),
    maxOrderNotional: m.maxOrder.toString(),
    maxWalletOpenNotional: m.maxWallet.toString(),
    maxMarketOpenNotional: m.maxMarket.toString(),
    /** Fee rates in bps, fixed at creation: makers pay the first, takers the second. */
    makerFeeBps: m.makerBps,
    takerFeeBps: m.takerBps,
    /** The filled maker's share of each fill's taker fee, in bps of that fee. */
    makerRebateBps: m.rebateBps,
    openNotional: m.openNotional.toString(),
    sequences: { yes: m.seq[0].toString(), no: m.seq[1].toString() },
    quoteToken: s.quote,
    quoteTokenDecimals: decimalsOf(s, s.quote),
    quoteSymbol: quote?.symbol ?? null,
    quoteName: quote?.name ?? null,
    baseToken: m.base,
    baseTokenDecimals: baseDecimals,
    /** Quantity decimals: the base token's own (raw-unit markets). */
    shareDecimals: baseDecimals,
    base: {
      token: m.base,
      decimals: baseDecimals,
      symbol: base?.symbol ?? null,
      name: base?.name ?? null,
      live: {
        multiplier: (live?.multiplier ?? 10n ** 18n).toString(),
        multiplierValue: Number(live?.multiplier ?? 10n ** 18n) / 1e18,
        paused: live?.paused ?? false,
        tradable: halt === null,
        halt,
      },
    },
    payouts: m.payouts,
    resolvedAt: m.resolvedAt === null ? null : m.resolvedAt.toString(),
    protocolVersion: PROTOCOL_VERSION,
    priceFormat: PRICE_FORMAT,
  };
}
export type MarketView = ReturnType<typeof marketView>;

const reservedOf = (o: OrderState, m: MarketState) => {
  const price = o.ticks * m.tick;
  return o.side === 0 ? (o.remaining * price + 10n ** 18n - 1n) / 10n ** 18n : o.remaining;
};

export function orderView(
  s: ChainState,
  o: OrderState,
  m: MarketState,
  deployment: Deployment,
  confirmation: "confirmed" | "finalized",
) {
  const price = o.ticks * m.tick;
  return {
    id: o.key,
    marketId: marketIdentity(s, m).id,
    venue: venueOf(deployment, o.market),
    maker: o.owner,
    ...(o.delegate ? { delegate: o.delegate } : {}),
    branch: o.branch,
    side: o.side,
    fundingKind: o.fundingKind,
    tif: o.tif,
    sequence: o.seq.toString(),
    quantity: o.quantity.toString(),
    limitPriceRawX18: price.toString(),
    expiry: o.expiry.toString(),
    maxFeeBps: o.maxFeeBps,
    remaining: o.remaining.toString(),
    filled: o.filled.toString(),
    reserved: reservedOf(o, m).toString(),
    openNotional: ((o.remaining * price + 10n ** 18n - 1n) / 10n ** 18n).toString(),
    feesPaid: o.feesPaid.toString(),
    status: o.status,
    createdAt: new Date(Number(o.placedAt) * 1000).toISOString(),
    transactionHash: o.placedTx,
    updatedBlock: o.updatedBlock.toString(),
    confirmation,
  };
}
export type OrderView = ReturnType<typeof orderView>;

/** Whether a resting order can fill now: the same checks the contract applies to a maker. */
export function liveOrder(
  o: OrderState,
  s: ChainState,
  now = BigInt(Math.floor(Date.now() / 1000)),
) {
  const m = s.markets.get(o.market);
  if (
    !m ||
    o.status !== "open" ||
    s.config.paused ||
    m.state !== 2 ||
    m.cutoff <= now ||
    o.expiry <= now ||
    o.maxFeeBps < m.makerBps
  )
    return false;
  const trader = traderOf(s, o.owner);
  if (o.epoch !== trader.epoch) return false;
  if (o.delegate) {
    const grant = s.grants.get(grantKey(o.owner, o.delegate));
    if (
      !grant ||
      grant.generation !== o.generation ||
      !activeDelegation(grant, trader.delegationEpoch, o.market, now)
    )
      return false;
  }
  return true;
}

/** Each market's YES and NO book midpoints (by venue id; raw quote per raw base x 1e18): halfway
 * between the best live bid and ask, null without both or while they cross. */
export function bookMidpoints(s: ChainState, now?: bigint) {
  const best = new Map<number, { bid?: bigint; ask?: bigint }[]>();
  for (const o of s.orders.values()) {
    if (!liveOrder(o, s, now)) continue;
    const price = o.ticks * s.markets.get(o.market)!.tick;
    let books = best.get(o.market);
    if (!books) {
      books = [{}, {}];
      best.set(o.market, books);
    }
    const book = books[o.branch]!;
    if (o.side === 0) book.bid = book.bid === undefined || price > book.bid ? price : book.bid;
    else book.ask = book.ask === undefined || price < book.ask ? price : book.ask;
  }
  const mid = ({ bid, ask }: { bid?: bigint; ask?: bigint }) =>
    bid !== undefined && ask !== undefined && ask >= bid ? (bid + ask) / 2n : null;
  return new Map(
    [...best].map(([market, [yes, no]]) => [market, { yes: mid(yes!), no: mid(no!) }]),
  );
}

/** Price levels of every public market's live orders, keyed by public id. */
export function orderbookLevels(s: ChainState, now?: bigint) {
  const books: Record<
    string,
    {
      orders: { branch: number; side: number; limitPriceRawX18: string; remaining: string }[];
      truncated: false;
    }
  > = {};
  const levels = new Map<
    number,
    Map<string, { branch: number; side: number; limitPriceRawX18: string; remaining: bigint }>
  >();
  const listed = publicMarkets(s);
  for (const m of listed.values()) levels.set(m.id, new Map());
  for (const o of s.orders.values()) {
    if (!levels.has(o.market) || !liveOrder(o, s, now)) continue;
    const m = s.markets.get(o.market)!;
    const price = (o.ticks * m.tick).toString();
    const book = levels.get(o.market)!;
    const key = `${o.branch}:${o.side}:${price}`;
    const level = book.get(key) ?? {
      branch: o.branch,
      side: o.side,
      limitPriceRawX18: price,
      remaining: 0n,
    };
    level.remaining += o.remaining;
    book.set(key, level);
  }
  for (const [id, book] of levels)
    books[publicIdOf(s, id)] = {
      orders: [...book.values()].map((l) => ({ ...l, remaining: l.remaining.toString() })),
      truncated: false,
    };
  return books;
}

/** Claims of one owner, per venue with any balance (escrowed claims are order reservations). */
export function positionsOf(s: ChainState, owner: Address, deployment: Deployment) {
  const result = [];
  for (const m of s.markets.values()) {
    const yes = s.accounts.get(accountKey(m.id, 0, owner));
    const no = s.accounts.get(accountKey(m.id, 1, owner));
    const quoteYes = yes?.quote ?? 0n,
      quoteNo = no?.quote ?? 0n,
      baseYes = yes?.base ?? 0n,
      baseNo = no?.base ?? 0n;
    if (!quoteYes && !quoteNo && !baseYes && !baseNo) continue;
    result.push({
      marketId: marketIdentity(s, m).id,
      venue: venueOf(deployment, m.id),
      conditionId: String(m.id),
      redeemable: m.state === 6 || m.state === 7,
      shareDecimals: decimalsOf(s, m.base),
      quoteTokenDecimals: decimalsOf(s, s.quote),
      baseToken: m.base,
      baseTokenDecimals: decimalsOf(s, m.base),
      quoteYes: quoteYes.toString(),
      quoteNo: quoteNo.toString(),
      baseYes: baseYes.toString(),
      baseNo: baseNo.toString(),
      protocolVersion: PROTOCOL_VERSION,
    });
  }
  return result;
}

/** Reservations of open underlying-funded orders (one owner's), per token, in one pass. They
 * are never released by expiry or revocation until cancelled on chain. */
export function reservedByToken(s: ChainState, orders: Iterable<OrderState>) {
  const totals = new Map<Address, bigint>();
  for (const o of orders) {
    if (o.status !== "open" || o.fundingKind !== 0) continue;
    const m = s.markets.get(o.market)!;
    const token = o.side === 0 ? s.quote : m.base;
    totals.set(token, (totals.get(token) ?? 0n) + reservedOf(o, m));
  }
  return totals;
}

/** Checksummed form of a lowercase address read back from storage, memoized: a few wallets
 * make most trades. */
const checksums = new Map<string, Address>();
export function checksum(address: string): Address {
  let value = checksums.get(address);
  if (!value) {
    if (checksums.size >= 50_000) checksums.clear();
    value = getAddress(address);
    checksums.set(address, value);
  }
  return value;
}

const LOW96 = (1n << 96n) - 1n;
const LOW128 = (1n << 128n) - 1n;

/** A Trade event and its execution details as one typed record (the persisted form). */
export function tradeRecord(e: DecodedEvent, trade: TradeDetails): TradeRecord {
  const fill = BigInt(e.args.fill as bigint),
    amounts = BigInt(e.args.amounts as bigint),
    fees = BigInt(e.args.fees as bigint);
  // The replay rejects a Trade of unknown orders before details are resolved.
  if (
    trade.maker === null ||
    trade.taker === null ||
    trade.price === null ||
    trade.takerSide === null ||
    trade.makerRebate === null
  )
    throw new Error(`Trade ${e.transactionHash}:${e.logIndex} references unknown orders`);
  return {
    block: e.block,
    logIndex: e.logIndex,
    blockTime: e.timestamp,
    tx: e.transactionHash,
    market: Number(e.args.market),
    branch: Number((fill >> 160n) & 0xffn),
    takerSide: trade.takerSide,
    makerSeq: (fill >> 96n) & U32_MAX,
    takerSeq: (fill >> 128n) & U32_MAX,
    quantity: fill & LOW96,
    price: BigInt(trade.price),
    quote: amounts & LOW128,
    buyerFee: fees & LOW128,
    sellerFee: fees >> 128n,
    makerRebate: BigInt(trade.makerRebate),
    maker: trade.maker,
    taker: trade.taker,
  };
}

export function tradeView(
  r: TradeRecord,
  s: ChainState,
  deployment: Deployment,
  confirmation: "confirmed" | "finalized",
) {
  return {
    id: `${r.tx}:${r.logIndex}`,
    marketId: publicIdOf(s, r.market),
    venue: venueOf(deployment, r.market),
    branch: r.branch,
    blockTimestamp: r.blockTime.toString(),
    executionPriceRawX18: r.price.toString(),
    fillQuantity: r.quantity.toString(),
    executionQuote: r.quote.toString(),
    buyerFee: r.buyerFee.toString(),
    sellerFee: r.sellerFee.toString(),
    /** Paid to the maker out of the taker's fee (buyer fee when the taker bought, seller fee
     * when it sold), in the same claims. */
    makerRebate: r.makerRebate.toString(),
    takerSide: r.takerSide,
    // A quote fill has no maker order.
    ...(r.makerSeq === QUOTE_SEQ
      ? {}
      : { makerOrderHash: orderKeyString(r.market, r.branch, r.makerSeq) }),
    takerOrderHash: orderKeyString(r.market, r.branch, r.takerSeq),
    maker: checksum(r.maker),
    taker: checksum(r.taker),
    transactionHash: r.tx,
    confirmation,
  };
}
export type TradeView = ReturnType<typeof tradeView>;

/** A closed order as persisted: everything its view needs besides the market's identity. */
export function closedOrderRecord(o: OrderState, m: MarketState): ClosedOrderRecord {
  return {
    market: o.market,
    branch: o.branch,
    seq: o.seq,
    owner: o.owner,
    delegate: o.delegate,
    side: o.side,
    fundingKind: o.fundingKind,
    tif: o.tif,
    quantity: o.quantity,
    price: o.ticks * m.tick,
    expiry: o.expiry,
    maxFeeBps: o.maxFeeBps,
    filled: o.filled,
    feesPaid: o.feesPaid,
    placedAt: o.placedAt,
    placedTx: o.placedTx,
    updatedBlock: o.updatedBlock,
  };
}

/** `orderView` of a closed order: nothing remains or is reserved, and it is filled exactly when
 * its whole quantity traded. */
export function closedOrderView(r: ClosedOrderRecord, s: ChainState, deployment: Deployment) {
  return {
    id: orderKeyString(r.market, r.branch, r.seq),
    marketId: publicIdOf(s, r.market),
    venue: venueOf(deployment, r.market),
    maker: checksum(r.owner),
    ...(r.delegate ? { delegate: checksum(r.delegate) } : {}),
    branch: r.branch,
    side: r.side,
    fundingKind: r.fundingKind,
    tif: r.tif,
    sequence: r.seq.toString(),
    quantity: r.quantity.toString(),
    limitPriceRawX18: r.price.toString(),
    expiry: r.expiry.toString(),
    maxFeeBps: r.maxFeeBps,
    remaining: "0",
    filled: r.filled.toString(),
    reserved: "0",
    openNotional: "0",
    feesPaid: r.feesPaid.toString(),
    status: (r.filled === r.quantity ? "filled" : "cancelled") as OrderState["status"],
    createdAt: new Date(Number(r.placedAt) * 1000).toISOString(),
    transactionHash: r.placedTx as Hex,
    updatedBlock: r.updatedBlock.toString(),
    confirmation: "finalized" as const,
  };
}

/** Withdrawable balances: vault credit per token and claim balances per venue. */
export function payoutCredits(s: ChainState, owner: Address, deployment: Deployment) {
  const payouts = [];
  for (const [token, pool] of s.pools) {
    const amount = creditOf(s, owner, token);
    if (!amount) continue;
    payouts.push({
      id: `credit:${token}`,
      scope: "global" as const,
      beneficiary: owner,
      asset: token,
      tokenId: "0",
      amount: amount.toString(),
      collateralToken: token,
      decimals: pool.decimals,
      branch: null,
      kind: token === s.quote ? ("quote" as const) : ("stock" as const),
      collateral: null,
      marketId: null,
      confirmation: "confirmed",
    });
  }
  for (const m of s.markets.values())
    for (const branch of [0, 1]) {
      const account = s.accounts.get(accountKey(m.id, branch, owner));
      if (!account) continue;
      for (const [collateral, amount] of [
        [0, account.quote],
        [1, account.base],
      ] as const) {
        if (!amount) continue;
        const token = collateral === 0 ? s.quote : m.base;
        payouts.push({
          id: `${m.id}:${3 * collateral + 1 + branch}`,
          scope: "market" as const,
          beneficiary: owner,
          asset: token,
          tokenId: String(3 * collateral + 1 + branch),
          amount: amount.toString(),
          collateralToken: token,
          decimals: decimalsOf(s, token),
          branch: branch === 0 ? ("YES" as const) : ("NO" as const),
          kind: collateral === 0 ? ("quote" as const) : ("stock" as const),
          collateral,
          marketId: marketIdentity(s, m).id,
          venue: venueOf(deployment, m.id),
          confirmation: "confirmed",
        });
      }
    }
  return payouts;
}

/** Trading readiness of one market, as the UI shows it. */
export function readiness(
  s: ChainState,
  m: MarketState,
  now = BigInt(Math.floor(Date.now() / 1000)),
) {
  const reason = s.config.paused
    ? "paused"
    : m.state !== 2
      ? m.state === 1
        ? "scheduled"
        : "closed"
      : m.cutoff <= now
        ? "closed"
        : m.open > now
          ? "scheduled"
          : "ready";
  return { healthy: reason === "ready", reason };
}
