import { expect, test } from "bun:test";
import { join } from "node:path";
import { WORLD_QUOTE_TYPES, worldQuoteDigest } from "@conditional-stocks/evm-client";
import { hashTypedData } from "viem";
import {
  breakEvenUnits,
  dollarsText,
  makerSide,
  parseDollars,
  quoteTypedData,
  WORLD_QUOTE_FIELDS,
} from "../src/lib/worlds/maker";
import type { BoardRfq, BookView } from "../src/lib/worlds/types";

const order = (over: Partial<BoardRfq["order"]> = {}): BoardRfq["order"] => ({
  side: "buy",
  mask: 0b100,
  units: null,
  refund: "0",
  stake: "19801980",
  conditional: false,
  limit: "0",
  ...over,
});
/** A priced world: 70% it fails, 8% the stock closes below, 22% above. */
const book = { atoms: 3, marks: [700_000, 80_000, 220_000] } as BookView;

test("the maker's side of an All-in order: paid the stake, risks the payout less the stake", () => {
  const side = makerSide(order(), 84_200_000n, book);
  expect(side).toMatchObject({
    units: 84_200_000n,
    refund: 0n,
    price: 19_801_980n,
    risk: 64_398_020n,
    needs: 64_398_020n,
    winChance: 220_000,
  });
  // Right: the payout less the stake is lost. Wrong (an event fails, or the stock goes the
  // other way): the stake is kept.
  expect(side.endings).toEqual([
    { key: "right", net: -64_398_020n, chance: 220_000 },
    { key: "wrong", net: 19_801_980n, chance: 780_000 },
  ]);
  // 19.80198 - 22% of 84.20
  expect(side.expected).toBe(19_801_980n - 18_524_000n);
  // What the wallet already holds on the paying atom counts toward what it must deliver.
  expect(makerSide(order(), 84_200_000n, book, [0n, 0n, 50_000_000n]).needs).toBe(14_398_020n);
  // The payout that breaks even at the marks: the stake over the chance.
  expect(breakEvenUnits(order(), book)).toBe((19_801_980n * 1_000_000n) / 220_000n);
});

test("a Money-back order returns the stake if an event fails: nothing gained or lost there", () => {
  const side = makerSide(order({ conditional: true }), 60_000_000n, book);
  expect(side.refund).toBe(19_801_980n);
  expect(side.endings).toEqual([
    { key: "right", net: -40_198_020n, chance: 220_000 },
    { key: "wrong", net: 19_801_980n, chance: 80_000 },
    { key: "fails", net: 0n, chance: 700_000 },
  ]);
  // Break-even: the stake kept when the world holds (30%) over the chance it pays (22%).
  expect(breakEvenUnits(order({ conditional: true }), book)).toBe(
    (19_801_980n * 300_000n) / 220_000n,
  );
  // Without marks there is nothing to compare with.
  expect(makerSide(order(), 60_000_000n, undefined).expected).toBeNull();
  expect(breakEvenUnits(order(), undefined)).toBeNull();
});

test("dollars are read as typed and written back to the cent", () => {
  expect(parseDollars("84.2")).toBe(84_200_000n);
  expect(parseDollars("$1,200.25")).toBe(1_200_250_000n);
  expect(parseDollars("")).toBeNull();
  expect(parseDollars("1.2.3")).toBeNull();
  expect(dollarsText(84_200_000n)).toBe("84.20");
  expect(dollarsText(84_000_000n)).toBe("84");
  expect(dollarsText(84_999_999n)).toBe("85");
});

test("what the wallet signs is the books' WorldQuote for exactly this order", () => {
  expect(WORLD_QUOTE_FIELDS).toEqual(WORLD_QUOTE_TYPES.WorldQuote);
  const books = "0x00000000000000000000000000000000000000b0" as const;
  const taker = "0x00000000000000000000000000000000000000A2" as const;
  const side = makerSide(order(), 84_200_000n, book);
  const { typed, quote } = quoteTypedData({
    chainId: 46630,
    books,
    rfq: { taker, book: 7, order: order() },
    side,
    expiry: 1_800_000_000,
    nonce: 123_456_789n,
  });
  expect(quote).toEqual({
    units: "84200000",
    refund: "0",
    price: "19801980",
    expiry: "1800000000",
    nonce: "123456789",
  });
  const data = JSON.parse(typed) as {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    primaryType: "WorldQuote";
    message: Record<string, string | number | boolean>;
  };
  const m = data.message;
  // The digest a wallet computes from the JSON is the one the books recover the maker from.
  const digest = hashTypedData({
    domain: data.domain,
    types: WORLD_QUOTE_TYPES,
    primaryType: data.primaryType,
    message: {
      taker: m.taker as `0x${string}`,
      book: BigInt(m.book as string),
      mask: m.mask as number,
      units: BigInt(m.units as string),
      refund: BigInt(m.refund as string),
      sell: m.sell as boolean,
      price: BigInt(m.price as string),
      expiry: m.expiry as number,
      makerData: BigInt(m.makerData as string),
      nonce: BigInt(m.nonce as string),
    },
  });
  expect(digest).toBe(
    worldQuoteDigest(46630, books, {
      taker,
      book: 7n,
      mask: 0b100,
      units: 84_200_000n,
      refund: 0n,
      sell: false,
      price: 19_801_980n,
      expiry: 1_800_000_000n,
      makerData: 0n,
      nonce: 123_456_789n,
    }),
  );
});

// The Explore page in a browser-like DOM: the board from one stream, a quote made, replaced,
// turned down, taken back and accepted, and the trades under it, each API call counted.
test("open orders are quoted from the Explore page", async () => {
  const child = Bun.spawn([process.execPath, "test", "./test/fixtures/world-explore.tsx"], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
}, 120_000);
