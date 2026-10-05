/** Referral scheduling and claims against fakes: weekly unlocks, event-driven accrual, a
 * reconciler that is idle when nothing is in flight, and transfers journaled before broadcast. */
import { afterEach, expect, test } from "bun:test";
import type { Database, ReferralTotal } from "@conditional-stocks/db";
import type { IndexerService } from "@conditional-stocks/indexer";
import { type Address, type Hex, type PublicClient, parseTransaction, toHex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { Referrals, weeklyUnlock } from "../src/referrals/service.ts";

const at = (iso: string) => Date.parse(iso) / 1000;
const usdc = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const nvda = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const referrer = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
// Anvil's account 6: the payout wallet's signer.
const payout = privateKeyToAccount(
  toHex(
    mnemonicToAccount("test test test test test test test test test test test junk", {
      addressIndex: 6,
    }).getHdKey().privateKey as Uint8Array,
  ),
);
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

test("rewards unlock at the first Monday 00:00 UTC strictly after resolution", () => {
  expect(weeklyUnlock(at("2026-10-04T23:59:59Z"))).toBe(at("2026-10-05T00:00:00Z"));
  expect(weeklyUnlock(at("2026-10-05T00:00:00Z"))).toBe(at("2026-10-12T00:00:00Z"));
  expect(weeklyUnlock(at("2026-10-07T12:00:00Z"))).toBe(at("2026-10-12T00:00:00Z"));
  expect(weeklyUnlock(at("2026-10-11T23:59:59Z"))).toBe(at("2026-10-12T00:00:00Z"));
  expect(weeklyUnlock(at("2026-12-31T08:00:00Z"))).toBe(at("2027-01-04T00:00:00Z"));
});

/** A YES-resolved market (resolved `resolvedAt`) whose referrer accrued USDC and NVDA claims on
 * YES, and USDC claims on NO (worthless). */
function setup(options: { resolvedAt?: number; nvdaBalance?: bigint; failSend?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const events: string[] = [];
  const calls = { accrue: 0, sent: 0 };
  let listener = () => {};
  const accrued: ReferralTotal[] = [
    { market: 1, branch: 0, collateral: 0, amount: 30_000n, fee: 0n, fills: 1 },
    { market: 1, branch: 0, collateral: 1, amount: 5n * 10n ** 14n, fee: 0n, fills: 1 },
    { market: 1, branch: 1, collateral: 0, amount: 999n, fee: 0n, fills: 1 },
  ];
  const state = {
    quote: usdc,
    timestamp: BigInt(now),
    pools: new Map([
      [usdc, { decimals: 6 }],
      [nvda, { decimals: 18 }],
    ]),
    markets: new Map([
      [
        1,
        {
          id: 1,
          base: nvda,
          payouts: [1, 0],
          resolvedAt: BigInt(options.resolvedAt ?? now - 14 * 86_400),
        },
      ],
    ]),
  };
  const indexer = {
    finalized: () => state,
    onPersistedTrades: (l: () => void) => {
      listener = l;
      return () => {};
    },
    tokens: { identity: new Map([[usdc, { symbol: "USDC" }]]) },
  } as unknown as IndexerService;
  let accrualResults: number[] = [];
  let slow: Promise<void> | undefined;
  /** Payouts awaiting a receipt. */
  const journal = new Map<string, { id: string; tx: Hex; raw: Hex }>();
  const queries = {
    referralTotals: async () => accrued,
    referralPaidTotals: async () => [],
    recordReferralPayout: async (_: string, p: { token: string; tx: Hex; raw: Hex }) => {
      events.push(`record ${parseTransaction(p.raw).nonce} ${p.token === usdc ? "USDC" : "NVDA"}`);
      const id = String(events.length);
      journal.set(id, { id, tx: p.tx, raw: p.raw });
      return id;
    },
  };
  const db = {
    accrueReferrals: async () => {
      calls.accrue++;
      await slow;
      return { trades: accrualResults.shift() ?? 0, accruals: 0 };
    },
    serialized: (_: string, work: (q: unknown) => unknown) => work(queries),
    settleReferralPayout: async (id: string, status: number) => {
      events.push(`settle ${id} ${status}`);
      journal.delete(id);
      return 1;
    },
    sentReferralPayouts: async () => {
      calls.sent++;
      return [...journal.values()];
    },
  } as unknown as Database;
  let sends = 0;
  const client = {
    getBalance: async () => 10n ** 18n,
    getTransactionCount: async () => 7,
    readContract: async ({ address }: { address: Address }) =>
      address === nvda ? (options.nvdaBalance ?? 10n ** 30n) : 10n ** 30n,
    prepareTransactionRequest: async (r: { nonce: number; to: Address; data: Hex }) => ({
      chainId: 31337,
      type: "eip1559",
      nonce: r.nonce,
      gas: 60_000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      to: r.to,
      data: r.data,
    }),
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      events.push(`send ${parseTransaction(serializedTransaction).nonce}`);
      if (options.failSend && sends++ === 0) throw new Error("connection reset");
      return "0x";
    },
    waitForTransactionReceipt: async () => {
      if (options.failSend) throw new Error("timed out");
      return { status: "success" };
    },
    getTransactionReceipt: async () => null,
  } as unknown as PublicClient;
  const referrals = new Referrals({
    db,
    indexer,
    client,
    domain: "test",
    config: { shareBps: 1_500, months: 6 },
    payout,
    probability: async () => null,
    onError: () => {},
    reconcileMs: 10,
  });
  started.push(referrals);
  return {
    referrals,
    events,
    calls,
    fire: () => listener(),
    accrualResults: (r: number[]) => {
      accrualResults = r;
    },
    hold: () => {
      let release = () => {};
      slow = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        slow = undefined;
        release();
      };
    },
  };
}
const started: Referrals[] = [];
afterEach(() => {
  for (const r of started.splice(0)) r.stop();
});

test("claims journal each transfer before broadcasting it, on consecutive nonces", async () => {
  const { referrals, events } = setup();
  const claimed = await referrals.claim(referrer);
  // The winning side's claims become tokens; the NO claims are worthless.
  expect(claimed.payouts).toMatchObject([
    { token: usdc, amount: "30000", status: "paid" },
    { token: nvda, amount: (5n * 10n ** 14n).toString(), status: "paid" },
  ]);
  expect(claimed.unavailable).toEqual([]);
  expect(events).toEqual([
    "record 7 USDC",
    "send 7",
    "record 8 NVDA",
    "send 8",
    "settle 1 1",
    "settle 3 1",
  ]);
});

test("a failed broadcast stops the claim, and the reconciler resends it", async () => {
  const { referrals, events } = setup({ failSend: true });
  const claimed = await referrals.claim(referrer);
  expect(claimed.payouts).toMatchObject([{ token: usdc, status: "sent" }]);
  // Nothing queued behind the unconfirmed transfer; NVDA stays claimable.
  expect(events).toEqual(["record 7 USDC", "send 7"]);
  await Bun.sleep(50);
  // The same signed transfer goes out again (never a new one), until a receipt settles it.
  expect(events.slice(2).length).toBeGreaterThan(0);
  expect(new Set(events.slice(2))).toEqual(new Set(["send 7"]));
});

test("an underfunded token stays claimable while the others pay", async () => {
  const { referrals, events } = setup({ nvdaBalance: 1n });
  const claimed = await referrals.claim(referrer);
  expect(claimed.payouts).toMatchObject([{ token: usdc, status: "paid" }]);
  expect(claimed.unavailable).toMatchObject([
    { token: nvda, decimals: 18, amount: (5n * 10n ** 14n).toString() },
  ]);
  expect(events.filter((e) => e.startsWith("record"))).toEqual(["record 7 USDC"]);
});

test("nothing is claimable before the Monday after resolution", async () => {
  const { referrals, events } = setup({ resolvedAt: Math.floor(Date.now() / 1000) });
  await expect(referrals.claim(referrer)).rejects.toThrow("Nothing is claimable yet.");
  expect(events).toEqual([]);
});

test("accrual runs at start and when trades are stored, never on a timer", async () => {
  const { referrals, calls, fire, accrualResults, hold } = setup();
  accrualResults([5_000, 5_000, 12]);
  referrals.start();
  await flush();
  // Full batches continue at once; the short one ends the run.
  expect(calls.accrue).toBe(3);
  await Bun.sleep(60);
  expect(calls.accrue).toBe(3);
  fire();
  await flush();
  expect(calls.accrue).toBe(4);
  // Stores during a run coalesce into one more run.
  const release = hold();
  fire();
  fire();
  fire();
  await flush();
  release();
  await flush();
  expect(calls.accrue).toBe(6);
});

test("with nothing in flight, the payout reconciler looks once and stays idle", async () => {
  const { referrals, calls } = setup();
  referrals.start();
  await Bun.sleep(80);
  expect(calls.sent).toBe(1);
});
