import { describe, expect, test } from "bun:test";
import type { PayoutVector } from "@conditional-stocks/market-data";
import { Logger } from "@conditional-stocks/shared";
import type { PublicClient } from "viem";
import { type Admin, AWAITING, type Evidence, FROZEN, type Market, OPEN } from "../src/admin.ts";
import { resolveMarkets } from "../src/jobs/resolve-markets.ts";
import { createMarkets, type MarketSpec, settleMarket } from "../src/markets.ts";
import { kalshiSettlements } from "../src/venues/kalshi.ts";
import { payoutOf, polymarketSettlements } from "../src/venues/polymarket.ts";

const YES: PayoutVector = { denominator: "1", no: "0", yes: "1" };
const NO: PayoutVector = { denominator: "1", no: "1", yes: "0" };
const CONDITION = `0x${"ab".repeat(32)}` as const;
const KALSHI_CONDITION = `0x${"cd".repeat(32)}` as const;
const TICKER = "KXFEDDECISION-26DEC-H25";
const BASE = "0x00000000000000000000000000000000000000b1";
const now = () => Math.floor(Date.now() / 1000);

const market = (overrides: Partial<Market> = {}): Market => ({
  venue: { marketId: "7" },
  state: OPEN,
  tradingCutoff: String(now() + 3600),
  eventSource: "polymarket",
  eventConditionId: CONDITION,
  eventYesIndex: "1",
  eventNoIndex: "2",
  baseToken: BASE,
  makerRebateBps: 0,
  ...overrides,
});
const kalshiMarket = (overrides: Partial<Market> = {}) =>
  market({
    venue: { marketId: "5" },
    eventSource: "kalshi",
    eventConditionId: KALSHI_CONDITION,
    ...overrides,
  });
const polygonSettlement = {
  source: "polymarket" as const,
  payout: YES,
  blockNumber: 100n,
  blockHash: `0x${"cd".repeat(32)}` as const,
};
const kalshiSettlement = { source: "kalshi" as const, payout: NO };
const polymarketSnapshot = (closed: boolean, resolutionStatus: string | null) => ({
  snapshotId: "s1",
  rawHash: `0x${"ef".repeat(32)}`,
  normalized: {
    source: "polymarket",
    canonicalUrl: "https://polymarket.com/event/x",
    conditionId: CONDITION,
    endTime: new Date((now() + 86_400) * 1000).toISOString(),
    gammaMarketId: "g1",
    rules: "Resolves YES if…",
    closed,
    resolutionStatus,
  },
});
const kalshiSnapshot = (status: string, result: string | null) => ({
  snapshotId: "k1",
  rawHash: `0x${"ef".repeat(32)}`,
  normalized: {
    source: "kalshi",
    ticker: TICKER,
    canonicalUrl: "https://kalshi.com/markets/kxfeddecision",
    conditionId: KALSHI_CONDITION,
    endTime: new Date((now() + 86_400) * 1000).toISOString(),
    rules: "Resolves Yes if the Fed hikes by 25bps.",
    closed: status !== "active",
    status,
    result,
    resolutionStatus: status,
  },
});
const logger = new Logger({ service: "test", level: "silent" });

/** Records every call an operation makes; answers from `overrides` or with defaults. */
function fakeAdmin(overrides: Record<string, unknown> = {}) {
  const calls: [string, ...unknown[]][] = [];
  const answer =
    (name: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return typeof value === "function" ? value(...args) : value;
    };
  const defaults: Record<string, unknown> = {
    markets: [],
    evidence: [],
    quote: "0x00000000000000000000000000000000000000c1",
    event: polymarketSnapshot(true, "resolved"),
    fetchMetadata: polymarketSnapshot(true, "resolved"),
    prepare: (_: string, body: unknown) => ({ ...packet("prepared"), body }),
    approve: () => packet("approved"),
    execute: { action: "begin-resolution", marketId: "9", transactionHash: "0x1" },
    lifecycle: "0x2",
    setMakerRebate: "0x3",
  };
  const admin = Object.fromEntries(
    Object.entries({ ...defaults, ...overrides }).map(([name, value]) => [
      name,
      answer(name, value),
    ]),
  );
  return { admin: admin as unknown as Admin, calls, names: () => calls.map(([name]) => name) };
}
const packet = (status: Evidence["status"], observations: { marketId?: string }[] = []) =>
  ({
    status,
    observations,
    envelope: {
      packetHash: "0xpacket",
      packet: {
        kind: "market-creation",
        event: { source: "polymarket", marketId: "g1", conditionId: CONDITION },
        config: { baseToken: BASE },
      },
    },
  }) as unknown as Evidence;

describe("Polymarket settlements", () => {
  test("map YES, NO and an even split", () => {
    expect(payoutOf(1n, 0n, 1n)).toEqual(YES);
    expect(payoutOf(0n, 1n, 1n)).toEqual(NO);
    expect(payoutOf(1n, 1n, 2n)).toEqual({ denominator: "2", no: "1", yes: "1" });
    expect(payoutOf(0n, 0n, 0n)).toBeNull();
    expect(payoutOf(3n, 1n, 4n)).toBeNull();
  });

  test("read at the finalized block, once per event, in the market's orientation", async () => {
    const reads: unknown[][] = [];
    const client = {
      getBlock: async () => ({ number: 100n, hash: polygonSettlement.blockHash }),
      multicall: async ({
        contracts,
        blockNumber,
      }: {
        contracts: { args: unknown[] }[];
        blockNumber: bigint;
      }) => {
        expect(blockNumber).toBe(100n);
        reads.push(contracts.map((c) => c.args));
        // Denominator 1, then numerators [slot 0 = 0, slot 1 = 1].
        return contracts.length === 1 ? [1n] : [1n, 0n];
      },
    } as unknown as PublicClient;
    // YES is index set 2 (slot 1): slot 1 paid out, so YES won.
    const swapped = market({ eventYesIndex: "2", eventNoIndex: "1" });
    const { settlements } = await polymarketSettlements(client, [swapped, swapped]);
    expect(reads).toEqual([
      [[CONDITION]],
      [
        [CONDITION, 1n],
        [CONDITION, 0n],
      ],
    ]);
    expect([...settlements.values()][0]).toMatchObject({ source: "polymarket", payout: YES });
  });
});

describe("Kalshi settlements", () => {
  test("come from finalized results, read once per event", async () => {
    const { admin, names } = fakeAdmin({ event: kalshiSnapshot("finalized", "no") });
    const settlements = await kalshiSettlements(admin, [
      kalshiMarket(),
      kalshiMarket({ venue: { marketId: "6" } }),
    ]);
    expect([...settlements.values()]).toEqual([kalshiSettlement]);
    expect(names()).toEqual(["event"]);
    const pending = fakeAdmin({ event: kalshiSnapshot("determined", "no") });
    expect((await kalshiSettlements(pending.admin, [kalshiMarket()])).size).toBe(0);
  });
});

describe("settleMarket", () => {
  test("freezes an open market at its cutoff, or early once the result is known", async () => {
    const late = fakeAdmin();
    expect(
      await settleMarket(
        late.admin,
        market({ tradingCutoff: String(now() - 1) }),
        polygonSettlement,
        [],
      ),
    ).toBe("freeze-at-cutoff");
    expect(late.calls).toEqual([["lifecycle", "7", 2]]);
    const early = fakeAdmin();
    expect(await settleMarket(early.admin, kalshiMarket(), kalshiSettlement, [])).toBe(
      "freeze-early",
    );
    expect(early.calls[0]?.slice(0, 3)).toEqual(["lifecycle", "5", 1]);
  });

  test("waits while Polymarket's API has not resolved the market", async () => {
    const { admin, names } = fakeAdmin({ fetchMetadata: polymarketSnapshot(true, "proposed") });
    expect(await settleMarket(admin, market({ state: FROZEN }), polygonSettlement, [])).toBe(
      "awaiting-venue-api",
    );
    expect(names()).toEqual(["event", "fetchMetadata"]);
  });

  test("prepares, approves and executes Polymarket's Polygon payout", async () => {
    const { admin, calls, names } = fakeAdmin();
    expect(await settleMarket(admin, market({ state: FROZEN }), polygonSettlement, [])).toBe(
      "begin-resolution",
    );
    expect(names()).toEqual(["event", "fetchMetadata", "prepare", "approve", "execute"]);
    expect(calls[1]).toEqual(["fetchMetadata", "polymarket", "g1"]);
    const body = calls[2]?.[2] as Record<string, unknown>;
    expect(body.payout).toEqual(YES);
    expect(body.polygon).toMatchObject({ chainId: "137", blockNumber: "100" });
  });

  test("resolves a Kalshi market from a fresh, final snapshot, with no Polygon record", async () => {
    const final = kalshiSnapshot("finalized", "no");
    const { admin, calls, names } = fakeAdmin({ event: final, fetchMetadata: final });
    expect(await settleMarket(admin, kalshiMarket({ state: FROZEN }), kalshiSettlement, [])).toBe(
      "begin-resolution",
    );
    expect(names()).toEqual(["event", "fetchMetadata", "prepare", "approve", "execute"]);
    expect(calls[1]).toEqual(["fetchMetadata", "kalshi", TICKER]);
    const body = calls[2]?.[2] as Record<string, unknown>;
    expect(body).toMatchObject({ payout: NO, polygon: null, officialStatus: "finalized" });
    // A fresh snapshot that disagrees is never cited.
    const stale = fakeAdmin({
      event: final,
      fetchMetadata: kalshiSnapshot("finalized", "yes"),
    });
    expect(
      await settleMarket(stale.admin, kalshiMarket({ state: FROZEN }), kalshiSettlement, []),
    ).toBe("awaiting-venue-api");
  });

  test("continues an approved packet with the same payout", async () => {
    const resolution = {
      status: "approved",
      observations: [],
      envelope: {
        packetHash: "0xr",
        // As stored: jsonb reorders keys.
        packet: {
          kind: "market-resolution",
          localMarket: { marketId: "7" },
          payout: { no: "0", yes: "1", denominator: "1" },
        },
      },
    } as unknown as Evidence;
    const { admin, names } = fakeAdmin({ execute: { action: "resolve-market" } });
    expect(
      await settleMarket(admin, market({ state: AWAITING }), polygonSettlement, [resolution]),
    ).toBe("resolve-market");
    expect(names()).toEqual(["execute"]);
  });
});

describe("createMarkets", () => {
  const spec: MarketSpec = {
    source: "polymarket",
    marketId: "g1",
    base: BASE,
    makerRebateBps: 2500,
  };

  test("creates, sets the rebate and opens a new market", async () => {
    const { admin, calls, names } = fakeAdmin({
      execute: { action: "create-market", marketId: "9" },
    });
    expect(await createMarkets(admin, [spec, spec])).toEqual([
      { spec, marketId: "9", created: true },
    ]);
    expect(names()).toEqual([
      "evidence",
      "markets",
      "fetchMetadata",
      "quote",
      "prepare",
      "approve",
      "execute",
      "setMakerRebate",
      "lifecycle",
    ]);
    expect(calls.at(-1)).toEqual(["lifecycle", "9", 0]);
  });

  test("fetches a Kalshi spec's market by its ticker", async () => {
    const kalshi: MarketSpec = { source: "kalshi", marketId: TICKER, base: BASE };
    const { admin, calls } = fakeAdmin({
      fetchMetadata: kalshiSnapshot("active", null),
      execute: { action: "create-market", marketId: "10" },
    });
    expect(await createMarkets(admin, [kalshi])).toEqual([
      { spec: kalshi, marketId: "10", created: true },
    ]);
    expect(calls.find(([name]) => name === "fetchMetadata")).toEqual([
      "fetchMetadata",
      "kalshi",
      TICKER,
    ]);
  });

  test("skips a market that exists on chain", async () => {
    const { admin, names } = fakeAdmin({ markets: [market({ venue: { marketId: "4" } })] });
    expect(await createMarkets(admin, [spec])).toEqual([{ spec, marketId: "4", created: false }]);
    expect(names()).toEqual(["evidence", "markets", "fetchMetadata"]);
  });

  test("never re-executes a packet whose market is not indexed yet", async () => {
    const { admin, names } = fakeAdmin({ evidence: [packet("approved", [{ marketId: "9" }])] });
    const [result] = await createMarkets(admin, [spec]);
    expect(result).toMatchObject({ error: "The created market is not indexed yet" });
    expect(names()).not.toContain("execute");
  });
});

describe("resolve-markets job", () => {
  // Polymarket paid out NO on its event; Kalshi finalized NO on its own.
  const polygon = {
    getBlock: async () => ({ number: 100n, hash: polygonSettlement.blockHash }),
    multicall: async ({ contracts }: { contracts: unknown[] }) =>
      contracts.length === 1 ? [1n] : [0n, 1n],
  } as unknown as PublicClient;

  test("advances markets whose indexed state matches the chain, and waits on the others", async () => {
    const behind = market({ venue: { marketId: "7" }, state: FROZEN });
    const current = market({ venue: { marketId: "8" }, state: OPEN });
    const { admin, calls, names } = fakeAdmin({
      markets: [behind, current],
      // On chain, 7 is already awaiting its resolution.
      chainStates: [AWAITING, OPEN],
    });
    await resolveMarkets.run({ admin, polygon, execute: true, logger });
    expect(names()).toEqual(["markets", "chainStates", "lifecycle"]);
    expect(calls.at(-1)?.slice(0, 3)).toEqual(["lifecycle", "8", 1]);
  });

  test("settles each venue's markets from that venue", async () => {
    const { admin, calls } = fakeAdmin({
      markets: [market({ venue: { marketId: "8" } }), kalshiMarket()],
      event: kalshiSnapshot("finalized", "no"),
      chainStates: [OPEN, OPEN],
    });
    await resolveMarkets.run({ admin, polygon, execute: true, logger });
    const frozen = calls.filter(([name]) => name === "lifecycle").map(([, id]) => id);
    expect(frozen.sort()).toEqual(["5", "8"]);
  });
});
