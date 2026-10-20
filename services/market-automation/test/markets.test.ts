import { describe, expect, test } from "bun:test";
import type { PayoutVector } from "@conditional-stocks/market-data";
import { Logger } from "@conditional-stocks/shared";
import type { PublicClient } from "viem";
import { type Admin, AWAITING, type Evidence, FROZEN, type Market, OPEN } from "../src/admin.ts";
import { resolveMarkets } from "../src/jobs/resolve-markets.ts";
import { createMarkets, settleMarket } from "../src/markets.ts";
import { payoutOf, reportedPayouts } from "../src/polygon.ts";

const YES: PayoutVector = { denominator: "1", no: "0", yes: "1" };
const NO: PayoutVector = { denominator: "1", no: "1", yes: "0" };
const CONDITION = `0x${"ab".repeat(32)}` as const;
const BASE = "0x00000000000000000000000000000000000000b1";
const now = () => Math.floor(Date.now() / 1000);

const market = (overrides: Partial<Market> = {}): Market => ({
  venue: { marketId: "7" },
  state: OPEN,
  tradingCutoff: String(now() + 3600),
  polymarketConditionId: CONDITION,
  polymarketYesIndex: "1",
  polymarketNoIndex: "2",
  baseToken: BASE,
  makerRebateBps: 0,
  ...overrides,
});
const reported = { payout: YES, blockNumber: 100n, blockHash: `0x${"cd".repeat(32)}` as const };
const snapshot = (closed: boolean, resolutionStatus: string | null) => ({
  snapshotId: "s1",
  rawHash: `0x${"ef".repeat(32)}`,
  normalized: {
    canonicalUrl: "https://polymarket.com/event/x",
    conditionId: CONDITION,
    endTime: new Date((now() + 86_400) * 1000).toISOString(),
    gammaMarketId: "g1",
    rules: "Resolves YES if…",
    closed,
    resolutionStatus,
  },
});

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
    polymarket: snapshot(true, "resolved"),
    fetchMetadata: snapshot(true, "resolved"),
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
        polymarket: { gammaMarketId: "g1", conditionId: CONDITION },
        config: { baseToken: BASE },
      },
    },
  }) as unknown as Evidence;

describe("payoutOf", () => {
  test("maps YES, NO and an even split", () => {
    expect(payoutOf(1n, 0n, 1n)).toEqual(YES);
    expect(payoutOf(0n, 1n, 1n)).toEqual(NO);
    expect(payoutOf(1n, 1n, 2n)).toEqual({ denominator: "2", no: "1", yes: "1" });
  });
  test("rejects unreported and uneven payouts", () => {
    expect(payoutOf(0n, 0n, 0n)).toBeNull();
    expect(payoutOf(3n, 1n, 4n)).toBeNull();
  });
});

describe("reportedPayouts", () => {
  test("reads at the finalized block, once per condition, in the market's orientation", async () => {
    const reads: unknown[][] = [];
    const client = {
      getBlock: async () => ({ number: 100n, hash: reported.blockHash }),
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
    const swapped = market({ polymarketYesIndex: "2", polymarketNoIndex: "1" });
    const { payouts } = await reportedPayouts(client, [swapped, swapped]);
    expect(reads).toEqual([
      [[CONDITION]],
      [
        [CONDITION, 1n],
        [CONDITION, 0n],
      ],
    ]);
    expect([...payouts.values()][0]?.payout).toEqual(YES);
  });
});

describe("settleMarket", () => {
  test("freezes an open market at its cutoff, or early once Polymarket has paid out", async () => {
    const late = fakeAdmin();
    expect(
      await settleMarket(late.admin, market({ tradingCutoff: String(now() - 1) }), reported, []),
    ).toBe("freeze-at-cutoff");
    expect(late.calls).toEqual([["lifecycle", "7", 2]]);
    const early = fakeAdmin();
    expect(await settleMarket(early.admin, market(), reported, [])).toBe("freeze-early");
    expect(early.calls[0]?.slice(0, 3)).toEqual(["lifecycle", "7", 1]);
  });

  test("waits while Polymarket's API has not resolved the market", async () => {
    const { admin, names } = fakeAdmin({ fetchMetadata: snapshot(true, "proposed") });
    expect(await settleMarket(admin, market({ state: FROZEN }), reported, [])).toBe(
      "awaiting-polymarket-api",
    );
    expect(names()).toEqual(["polymarket", "fetchMetadata"]);
  });

  test("prepares, approves and executes the Polygon payout", async () => {
    const { admin, calls, names } = fakeAdmin();
    expect(await settleMarket(admin, market({ state: FROZEN }), reported, [])).toBe(
      "begin-resolution",
    );
    expect(names()).toEqual(["polymarket", "fetchMetadata", "prepare", "approve", "execute"]);
    const body = calls[2]?.[2] as Record<string, unknown>;
    expect(body.payout).toEqual(YES);
    expect(body.polygon).toMatchObject({ chainId: "137", blockNumber: "100" });
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
    expect(await settleMarket(admin, market({ state: AWAITING }), reported, [resolution])).toBe(
      "resolve-market",
    );
    expect(names()).toEqual(["execute"]);
  });
});

describe("createMarkets", () => {
  const spec = { gammaMarketId: "g1", base: BASE as `0x${string}`, makerRebateBps: 2500 };

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
  test("advances markets whose indexed state matches the chain, and waits on the others", async () => {
    // Polymarket paid out NO on the shared condition.
    const polygon = {
      getBlock: async () => ({ number: 100n, hash: reported.blockHash }),
      multicall: async ({ contracts }: { contracts: unknown[] }) =>
        contracts.length === 1 ? [1n] : [0n, 1n],
    } as unknown as PublicClient;
    const behind = market({ venue: { marketId: "7" }, state: FROZEN });
    const current = market({ venue: { marketId: "8" }, state: OPEN });
    const { admin, calls, names } = fakeAdmin({
      markets: [behind, current],
      // On chain, 7 is already awaiting its resolution.
      chainStates: [AWAITING, OPEN],
    });
    await resolveMarkets.run({
      admin,
      polygon,
      execute: true,
      logger: new Logger({ service: "test", level: "silent" }),
    });
    expect(names()).toEqual(["markets", "chainStates", "lifecycle"]);
    expect(calls.at(-1)?.slice(0, 3)).toEqual(["lifecycle", "8", 1]);
  });
});
