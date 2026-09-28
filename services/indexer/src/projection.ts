/** JSON views of the replica served to the API and UI (`protocolVersion: 4`). Quantities are
 * raw base units, prices raw quote units per raw base unit x 1e18, amounts raw token units. */
import { activeDelegation } from "@conditional-stocks/evm-client";
import {
  accountKey,
  type ChainState,
  creditOf,
  grantKey,
  type MarketState,
  type OrderState,
  traderOf,
} from "@conditional-stocks/evm-client/ledger";
import type { Address } from "viem";

export const PROTOCOL_VERSION = 4;
export const PRICE_FORMAT = "raw-unit-ratio-x18";

/** Live state of a market's base token (issuer pause and UI multiplier), read periodically. */
export interface BaseLive {
  /** Issuer UI multiplier x 1e18 (1e18 when the token has none). */
  multiplier: bigint;
  paused: boolean;
}

export const decimalsOf = (s: ChainState, token: Address) => s.pools.get(token)?.decimals ?? 0;

export interface TokenIdentity {
  symbol: string | null;
  name: string | null;
}

export function marketView(
  s: ChainState,
  m: MarketState,
  live?: BaseLive,
  identity: (token: Address) => TokenIdentity | undefined = () => undefined,
) {
  const baseDecimals = decimalsOf(s, m.base);
  const base = identity(m.base),
    quote = identity(s.quote);
  const halt = live?.paused ? "issuer-paused" : null;
  return {
    id: String(m.id),
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

export function orderView(o: OrderState, m: MarketState, confirmation: "confirmed" | "finalized") {
  const price = o.ticks * m.tick;
  return {
    id: o.key,
    marketId: String(o.market),
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
    o.expiry <= now
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

/** Price levels of every market's live orders (public list views). */
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
  for (const id of s.markets.keys()) levels.set(id, new Map());
  for (const o of s.orders.values()) {
    if (!liveOrder(o, s, now)) continue;
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
    books[String(id)] = {
      orders: [...book.values()].map((l) => ({ ...l, remaining: l.remaining.toString() })),
      truncated: false,
    };
  return books;
}

/** Claims of one owner, per market with any balance (escrowed claims are order reservations). */
export function positionsOf(s: ChainState, owner: Address) {
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
      marketId: String(m.id),
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

/** Reservations of an owner's open underlying-funded orders, per token (never released by
 * expiry or revocation until cancelled on chain). */
export function reservedUnderlying(s: ChainState, owner: Address, token: Address) {
  let total = 0n;
  for (const o of s.orders.values()) {
    if (o.status !== "open" || o.fundingKind !== 0 || o.owner !== owner) continue;
    const m = s.markets.get(o.market)!;
    if ((o.side === 0 ? s.quote : m.base) === token) total += reservedOf(o, m);
  }
  return total;
}

/** Withdrawable balances: vault credit per token and claim balances per market. */
export function payoutCredits(s: ChainState, owner: Address) {
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
          marketId: String(m.id),
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
