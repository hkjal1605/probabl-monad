import {
  Branch,
  FundingKind,
  quoteForReservation,
  Side,
  TimeInForce,
  WAD,
} from "@conditional-stocks/domain";
import type { Address, Hex } from "viem";
import {
  DeterministicMatcher,
  MarketState,
  type MatcherEventEnvelope,
  makeBookKey,
} from "../src/index.ts";

const MARKET = `0x${"ef".repeat(32)}` as Hex;
const hash = (value: number): Hex => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const address = (value: number): Address =>
  `0x${(value % 10_000).toString(16).padStart(40, "0")}` as Address;

let logIndex = 0;
const envelope = (event: MatcherEventEnvelope["event"]): MatcherEventEnvelope => ({
  cursor: {
    blockHash: hash(1),
    blockNumber: 1n,
    blockTimestamp: 100n,
    chainId: 46630n,
    logIndex: logIndex++,
    transactionHash: hash(900_000 + logIndex),
    transactionIndex: logIndex,
  },
  event,
});

const matcher = new DeterministicMatcher();
matcher.apply(
  envelope({
    type: "market-terms-configured",
    baseStep: WAD,
    marketId: MARKET,
    priceTickRawX18: WAD,
    tradingCutoff: 1_000_000n,
    tradingOpen: 1n,
  }),
);
matcher.apply(
  envelope({
    type: "market-state-changed",
    marketId: MARKET,
    newState: MarketState.Scheduled,
    previousState: MarketState.None,
    reasonHash: hash(0),
  }),
);
matcher.apply(
  envelope({
    type: "market-state-changed",
    marketId: MARKET,
    newState: MarketState.Open,
    previousState: MarketState.Scheduled,
    reasonHash: hash(0),
  }),
);

const count = Number(Bun.env.MATCHER_BENCH_ORDERS ?? "25000");
const started = performance.now();
for (let index = 0; index < count; index += 1) {
  const limitPriceRawX18 = BigInt(1 + (index % 1_000)) * WAD;
  const maker = address(index + 1);
  const quantity = WAD;
  matcher.apply(
    envelope({
      type: "order-opened",
      order: {
        branch: Branch.Yes,
        expiry: 999_999n,
        fundingKind: FundingKind.WholeCollateral,
        limitPriceRawX18,
        maker,
        marketId: MARKET,
        nonce: 0n,
        quantity,
        recipient: maker,
        salt: hash(index + 1),
        maxFeeBps: 0,
        side: Side.Buy,
        tif: TimeInForce.Gtc,
      },
      orderHash: hash(index + 1),
      reserved: quoteForReservation(quantity, limitPriceRawX18),
      sequence: BigInt(index),
    }),
  );
}
const elapsedMs = performance.now() - started;
const operationsPerSecond = Math.round((count / elapsedMs) * 1_000);
const book = matcher
  .checkpoint()
  .books.find(
    (item) => makeBookKey(item.marketId, item.branch) === makeBookKey(MARKET, Branch.Yes),
  );

console.log(
  JSON.stringify({
    elapsedMs: Number(elapsedMs.toFixed(2)),
    levels: book?.bids.length ?? 0,
    operations: count,
    operationsPerSecond,
    runtime: `Bun ${Bun.version}`,
  }),
);
