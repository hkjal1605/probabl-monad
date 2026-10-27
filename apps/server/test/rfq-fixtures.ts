/** A replica with one open market, for RFQ tests that need no chain. */
import {
  conditionalStocksAbi,
  DELEGATE_CANCEL,
  DELEGATE_TRADE,
  type OrderWire,
} from "@conditional-stocks/evm-client";
import {
  type ChainState,
  creditKey,
  emptyState,
  grantKey,
  type MarketState,
  type OrderState,
  orderKeyString,
} from "@conditional-stocks/evm-client/ledger";
import type { IndexerService } from "@conditional-stocks/indexer";
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Hex,
  type Log,
  zeroHash,
} from "viem";
import { createOrderPlan } from "../src/trading/plan.ts";

export const wallet = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
export const EXCHANGE = wallet(0xe1);
export const USDC = wallet(0x05dc);
export const NVDA = wallet(0x4e5d);
export const DELEGATE = wallet(0xde1e);
export const [ALICE, BOB, CAROL] = [0xa1, 0xb0, 0xc0].map(wallet) as [Address, Address, Address];
export const SHARE = 10n ** 18n;
/** $1 per share: 1e6 quote units (6 decimals) per 1e18 base units, x1e18. */
export const DOLLAR = 1_000_000n;
export const NOW = BigInt(Math.floor(Date.now() / 1000));

export function market(overrides: Partial<MarketState> = {}): MarketState {
  return {
    id: 1,
    base: NVDA,
    condition: zeroHash,
    yesIndex: 1,
    noIndex: 2,
    rulesHash: zeroHash,
    metadataHash: zeroHash,
    metadataUri: "",
    open: NOW - 3_600n,
    cutoff: NOW + 30n * 86_400n,
    tick: 10_000n,
    step: 10n ** 15n,
    maxSteps: 1_000_000n,
    minNotional: DOLLAR,
    maxOrder: 100_000n * DOLLAR,
    maxWallet: 1_000_000n * DOLLAR,
    maxMarket: 10_000_000n * DOLLAR,
    makerBps: 20,
    takerBps: 50,
    rebateBps: 0,
    state: 2,
    openNotional: 0n,
    seq: [10n, 0n],
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
    createdBlock: 1n,
    createdAt: NOW - 86_400n,
    createdTx: zeroHash,
    ...overrides,
  };
}

export function chain(m = market()) {
  const s: ChainState = emptyState(USDC);
  s.block = 100n;
  s.config.marketAdmin = wallet(0xad);
  s.pools.set(USDC, { liability: 0n, decimals: 6, underlying: zeroHash });
  s.pools.set(NVDA, { liability: 0n, decimals: 18, underlying: zeroHash });
  s.markets.set(m.id, m);
  return s;
}

/** A resting order on branch YES, `price` in dollars per share as a raw price. */
export function rest(
  s: ChainState,
  owner: Address,
  side: 0 | 1,
  quantity: bigint,
  price: bigint,
  seq: bigint,
  extra: Partial<OrderState> = {},
) {
  const m = s.markets.get(1)!;
  const o: OrderState = {
    key: orderKeyString(1, 0, seq),
    market: 1,
    branch: 0,
    seq,
    owner,
    delegate: null,
    generation: 0,
    epoch: 0n,
    side,
    fundingKind: 0,
    tif: 0,
    quantity,
    ticks: price / m.tick,
    expiry: NOW + 86_400n,
    maxFeeBps: 1000,
    remaining: quantity,
    filled: 0n,
    feesPaid: 0n,
    status: "open",
    placedBlock: 1n,
    placedAt: NOW - 60n,
    placedTx: zeroHash,
    updatedBlock: 1n,
    ...extra,
  };
  s.orders.set(o.key, o);
  if (seq >= m.seq[0]) m.seq[0] = seq + 1n;
  return o;
}

/** A maker that granted the delegate and holds `shares` of stock and $100k as credit. */
export function fundedMaker(
  s: ChainState,
  maker: Address,
  shares = 10n,
  permissions = DELEGATE_TRADE | DELEGATE_CANCEL,
  delegate = DELEGATE,
) {
  s.credits.set(creditKey(maker, NVDA), shares * SHARE);
  s.credits.set(creditKey(maker, USDC), 100_000n * DOLLAR);
  s.grants.set(grantKey(maker, delegate), {
    owner: maker,
    delegate,
    market: 0,
    expiresAt: NOW + 7n * 86_400n,
    maxOrderQuote: 10_000n * DOLLAR,
    totalQuote: 100_000n * DOLLAR,
    maxOrderBase: 100n * SHARE,
    totalBase: 1_000n * SHARE,
    maxFeeBps: 100,
    permissions,
    epoch: 0n,
    generation: 1,
    remainingQuote: 100_000n * DOLLAR,
    remainingBase: 1_000n * SHARE,
    revoked: false,
  });
}

/** A market order of `owner` through the delegate, YES branch. */
export const marketOrder = (
  owner: Address,
  side: 0 | 1,
  quantity: bigint,
  limit: bigint,
  extra: Partial<OrderWire> = {},
): OrderWire => ({
  maker: owner,
  delegate: DELEGATE,
  marketId: "1",
  quantity: quantity.toString(),
  limitPriceRawX18: limit.toString(),
  expiry: (NOW + 3_600n).toString(),
  maxFeeBps: 100,
  branch: 0,
  side,
  fundingKind: 0,
  tif: 1,
  ...extra,
});

/** An indexer serving `s` (and whatever replaces it) to the planner. */
export function fakeIndexer(state: () => ChainState) {
  return {
    options: { exchange: EXCHANGE },
    trading: state,
    tokens: { live: new Map() },
  } as unknown as IndexerService;
}
export const planner = (state: () => ChainState) => createOrderPlan(fakeIndexer(state));

/** An exchange log as a receipt carries it. */
export function exchangeLog(
  eventName: "Trade" | "OrderPlaced" | "QuoteFilled",
  args: Record<string, unknown>,
): Log {
  const event = conditionalStocksAbi.find((x) => x.type === "event" && x.name === eventName)!;
  const inputs = (
    event as unknown as { inputs: readonly { name: string; type: string; indexed?: boolean }[] }
  ).inputs;
  const data = inputs.filter((i) => !i.indexed);
  return {
    address: EXCHANGE,
    topics: encodeEventTopics({
      abi: conditionalStocksAbi,
      eventName,
      args: Object.fromEntries(inputs.filter((i) => i.indexed).map((i) => [i.name, args[i.name]])),
    } as never) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      data.map((i) => ({ type: i.type })),
      data.map((i) => args[i.name]),
    ),
    blockHash: zeroHash,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: zeroHash,
    transactionIndex: 0,
    removed: false,
  } as Log;
}
