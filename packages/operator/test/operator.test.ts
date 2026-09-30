import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import {
  decimal,
  initialJournal,
  type Journal,
  reference,
  StateFile,
  units,
  validateJournal,
} from "../src/index.ts";

const BASE = getAddress("0x00000000000000000000000000000000000000b1");
const QUOTE = getAddress("0x00000000000000000000000000000000000000a1");
const CONDITION = `0x${"ab".repeat(32)}` as const;
const market = { condition: CONDITION, yesIndex: 1, noIndex: 2, tick: 10_000n };
const limits = {
  allowStaleSpot: false,
  maxFeedAgeMs: 30_000,
  maxProbabilitySpreadX6: 50_000,
  probabilityFloorX6: 20_000,
};
const policy = { base: BASE, basePriceMultiplier: "1", quotePriceMultiplier: "1" };
const tokens = { chainId: 31337, quote: QUOTE, quoteDecimals: 6, baseDecimals: 18 };

function polymarket(observedAt: number) {
  return {
    metadata: {
      normalized: {
        conditionId: CONDITION,
        active: true,
        closed: false,
        outcomes: [
          { label: "YES", tokenId: "11", indexSet: "1" },
          { label: "NO", tokenId: "22", indexSet: "2" },
        ],
      },
    },
    probability: {
      conditionId: CONDITION,
      yesTokenId: "11",
      schemaVersion: 1,
      quality: "valid",
      isStale: false,
      midpointX6: "400000",
      bestBidX6: "395000",
      bestAskX6: "405000",
      spreadX6: "10000",
      standardNotionalX6: "1000000",
      bidDepthQuoteX6: "5000000",
      askDepthQuoteX6: "5000000",
      observedAtMs: String(observedAt),
    },
  };
}
function pyth(publishedAt: number, fetchedAt: number) {
  const price = (token: string, priceUsd: number) => ({
    token,
    status: "available",
    priceUsd,
    priceTimestamp: Math.floor(publishedAt / 1000),
    fetchedAt: Math.floor(fetchedAt / 1000),
  });
  return { source: "pyth", chainId: 31337, prices: [price(QUOTE, 1), price(BASE, 125.5)] };
}

const directories: string[] = [];
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("decimal and token-unit conversions are exact", () => {
  expect(decimal("125.5", 6)).toBe(125_500_000n);
  expect(decimal("1.25e2", 2)).toBe(12_500n);
  expect(decimal("0.1234567", 6)).toBe(123_456n);
  expect(units("0.001", 18)).toBe(10n ** 15n);
  expect(() => units("0.0000001", 6)).toThrow();
  expect(() => decimal("-1", 6)).toThrow();
});

test("a reference carries the spot and probability times separately", () => {
  const now = 1_800_000_000_000;
  const r = reference(
    polymarket(now - 4000),
    pyth(now - 1000, now - 500),
    market,
    policy,
    limits,
    { ...tokens, multiplier: 10n ** 18n },
    now,
  );
  // $125.50 per whole 18-decimal token: 125.5e6 raw USDC per 1e18 raw, x1e18.
  expect(r.spot).toBe(125_500_000n);
  expect(r.probability).toBe(400_000n);
  expect(r.spread).toBe(10_000n);
  expect(r.probabilityAt).toBe(now - 4000);
  expect(r.spotAt).toBe(now - 1000);
  expect(r.observedAt).toBe(now - 4000);
  expect(() =>
    reference(
      polymarket(now - 40_000),
      pyth(now, now),
      market,
      policy,
      limits,
      { ...tokens, multiplier: 10n ** 18n },
      now,
    ),
  ).toThrow("Stale");
});

test("journals refuse malformed gas or pending records", () => {
  validateJournal(initialJournal());
  const bad: Journal[] = [
    { ...initialJournal(), spent: "-1" },
    { ...initialJournal(), day: "yesterday" },
    {
      ...initialJournal(),
      pending: { hash: "0x12", nonce: 0, raw: "0x00", charged: "1" },
    },
  ];
  for (const journal of bad) expect(() => validateJournal(journal)).toThrow();
});

test("state files are private, locked to one process and reloaded as saved", () => {
  const directory = mkdtempSync(join(tmpdir(), "operator-"));
  directories.push(directory);
  const path = join(directory, "state", "keeper.json");
  const open = () =>
    new StateFile(
      path,
      (value) => {
        validateJournal(value as Journal);
        return value as Journal & { note?: string };
      },
      () => ({ ...initialJournal(), note: "fresh" }),
    );
  const file = open();
  expect(file.state.note).toBe("fresh");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  // This process is alive, so a second holder is refused.
  expect(open).toThrow("Another bot process holds this state");
  file.state.note = "saved";
  file.save();
  file.close();
  const reopened = open();
  expect(reopened.state.note).toBe("saved");
  expect(JSON.parse(readFileSync(path, "utf8")).note).toBe("saved");
  reopened.close();
});
