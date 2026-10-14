/** Signed quotes against the book: which quotes stand, how a market order is split between
 * resting orders and quotes, and the plan its one transaction carries. No chain. */
import { expect, test } from "bun:test";
import {
  parseAtomicPlan,
  QUOTE_TYPES,
  quoteDomain,
  unpackOrder,
} from "@conditional-stocks/evm-client";
import {
  type Address,
  parseSignature,
  serializeCompactSignature,
  signatureToCompactSignature,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  quotedPlan,
  quoteFill,
  quoteFills,
  quoteProblem,
  quoteSigner,
  quoteTerms,
  selectQuotes,
  topOfBook,
} from "../src/rfq/auction.ts";
import type { MakerQuote } from "../src/rfq/protocol.ts";
import { bookCandidates } from "../src/trading/plan.ts";
import {
  ALICE,
  BOB,
  CAROL,
  chain,
  DOLLAR,
  EXCHANGE,
  exchangeLog,
  fundedMaker,
  marketOrder,
  NOW,
  rest,
  SHARE,
  wallet,
} from "./rfq-fixtures.ts";

const makers = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
const [MAKER_A, MAKER_B, MAKER_C] = makers.map((m) => m.address) as [Address, Address, Address];
const cents = (n: bigint) => (n * DOLLAR) / 100n;
const buy4 = marketOrder(ALICE, 0, 4n * SHARE, 102n * DOLLAR);

/** Bob asks 2 shares at $101; the makers hold stock and quote credit. */
function setup() {
  const s = chain();
  rest(s, BOB, 1, 2n * SHARE, 101n * DOLLAR, 3n);
  for (const m of [MAKER_A, MAKER_B, MAKER_C]) fundedMaker(s, m);
  return { s, m: s.markets.get(1)! };
}
const terms = (price: bigint, shares: bigint, extra: Partial<MakerQuote> = {}): MakerQuote => ({
  price,
  quantity: shares * SHARE,
  fundingKind: 0,
  expiry: NOW + 30n,
  nonce: 1n,
  signature: `0x${"00".repeat(65)}`,
  ...extra,
});

test("a quote stands only if the exchange would fill it", () => {
  const { s, m } = setup();
  const problem = (maker: Address, q: MakerQuote, quantity = q.quantity, order = buy4) =>
    quoteProblem({
      state: s,
      market: m,
      taker: order,
      maker,
      quote: q,
      quantity,
      now: NOW,
      minQuoteSeconds: 3,
    });
  expect(problem(ALICE, terms(101n * DOLLAR, 1n))).toBe("A maker cannot quote its own order");
  expect(problem(MAKER_A, terms(101n * DOLLAR + 5_000n, 1n))).toBe(
    "Price must be a positive multiple of the market tick",
  );
  expect(problem(MAKER_A, terms(101n * DOLLAR, 1n, { quantity: SHARE + 10n ** 14n }))).toBe(
    "Quantity must be a positive multiple of the market step",
  );
  // The buyer pays at most $102; a seller gets at least its limit.
  expect(problem(MAKER_A, terms(cents(10201n), 1n))).toBe("Price is outside the order's limit");
  const sell = marketOrder(ALICE, 1, SHARE, 99n * DOLLAR);
  expect(problem(MAKER_A, terms(cents(9899n), 1n), SHARE, sell)).toBe(
    "Price is outside the order's limit",
  );
  expect(problem(MAKER_A, terms(101n * DOLLAR, 1n, { expiry: NOW + 2n }))).toBe(
    "The quote must stay valid at least 3 s",
  );
  // Ten shares of credit cannot deliver eleven; claims on the branch are none.
  expect(problem(MAKER_A, terms(101n * DOLLAR, 11n))).toBe(
    "The maker's exchange balance cannot fund this quote",
  );
  expect(problem(MAKER_A, terms(101n * DOLLAR, 1n, { fundingKind: 1 }))).toBe(
    "The maker's exchange balance cannot fund this quote",
  );
  expect(problem(MAKER_A, terms(cents(10050n), 1n))).toBeNull();
  // A quote rests nothing, so pricing through the book's other side is fine.
  rest(s, CAROL, 0, SHARE, cents(10100n), 4n);
  expect(problem(MAKER_A, terms(cents(10050n), 1n))).toBeNull();
  // No grant to anyone is needed: the signature authorizes the fill.
  s.grants.clear();
  expect(problem(MAKER_A, terms(cents(10050n), 1n))).toBeNull();
});

test("only the maker wallet's signature of the exact terms is accepted, in either encoding", async () => {
  const { m } = setup();
  const q = terms(cents(10050n), 3n, { nonce: 42n });
  const signature = await makers[0]!.signTypedData({
    domain: quoteDomain(31337, EXCHANGE),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: { taker: ALICE, terms: quoteTerms(m, buy4, q), nonce: 42n },
  });
  const signer = (sig: `0x${string}`, quote = q, order = buy4, chainId = 31337) =>
    quoteSigner(chainId, EXCHANGE, m, order, { ...quote, signature: sig });
  expect(await signer(signature)).toBe(MAKER_A);
  const compact = serializeCompactSignature(signatureToCompactSignature(parseSignature(signature)));
  expect(await signer(compact)).toBe(MAKER_A);
  // Another price, nonce, taker or chain recovers someone else.
  expect(await signer(signature, { ...q, price: cents(10040n) })).not.toBe(MAKER_A);
  expect(await signer(signature, { ...q, nonce: 43n })).not.toBe(MAKER_A);
  expect(await signer(signature, q, { ...buy4, maker: CAROL })).not.toBe(MAKER_A);
  expect(await signer(signature, q, buy4, 1)).not.toBe(MAKER_A);
  expect(await signer(`0x${"00".repeat(65)}`)).toBeNull();
  // What the placement carries: the signed terms (the maker's side, on the order's branch) and
  // the EIP-2098 signature.
  const fill = quoteFill(m, buy4, { ...q, signature }, SHARE);
  const unpacked = unpackOrder(BigInt(fill.terms));
  expect(unpacked).toMatchObject({
    market: 1,
    branch: 0,
    side: 1,
    fundingKind: 0,
    quantity: 3n * SHARE,
  });
  expect(unpacked.ticks * m.tick).toBe(cents(10050n));
  expect(unpacked.expiry).toBe(NOW + 30n);
  expect(fill).toMatchObject({ nonce: "42", fill: SHARE.toString() });
  expect(`${fill.r}${fill.vs.slice(2)}`).toBe(compact);
});

const quoted = (maker: Address, price: bigint, shares: bigint) => ({
  maker,
  terms: terms(price, shares),
});
const rank = (
  s: ReturnType<typeof setup>["s"],
  order: typeof buy4,
  quotes: ReturnType<typeof quoted>[],
  viable: (q: ReturnType<typeof quoted>) => string | null = () => null,
) => {
  const m = s.markets.get(1)!;
  return selectQuotes({
    taker: order,
    candidates: bookCandidates(s, m, order, NOW),
    quotes,
    nextSequence: m.seq[0],
    now: NOW,
    step: m.step,
    makerFeeBps: m.makerBps,
    takerFeeBps: m.takerBps,
    viable,
  });
};

test("the order fills best price first across book and quotes, resting orders first on ties", () => {
  const { s } = setup();
  const quotes = [
    quoted(MAKER_C, cents(10150n), 3n),
    quoted(MAKER_B, 101n * DOLLAR, 5n),
    quoted(MAKER_A, cents(10050n), 1n),
  ];
  const result = rank(s, buy4, quotes);
  // A's share at $100.50, Bob's 2 at $101 (he rested first), 1 of B's at $101.
  expect(result.awards.map((a) => [a.quote.maker, a.quantity])).toEqual([
    [MAKER_A, SHARE],
    [MAKER_B, SHARE],
  ]);
  expect(result.plan.filledQuantity).toBe((4n * SHARE).toString());
  expect(BigInt(result.plan.executionQuote)).toBe(cents(10050n) + 3n * 101n * DOLLAR);
});

test("an award the maker cannot fill at its size drops that quote and the ranking runs again", () => {
  const { s } = setup();
  const quotes = [
    quoted(MAKER_A, cents(10050n), 1n),
    quoted(MAKER_B, 101n * DOLLAR, 5n),
    quoted(MAKER_C, cents(10150n), 3n),
  ];
  const result = rank(s, buy4, quotes, (q) => (q.maker === MAKER_B ? "spent" : null));
  expect(result.dropped).toEqual([{ quote: quotes[1]!, reason: "spent" }]);
  expect(result.awards.map((a) => [a.quote.maker, a.quantity])).toEqual([
    [MAKER_A, SHARE],
    [MAKER_C, SHARE],
  ]);
});

test("a market sell takes the highest bids, and one transaction carries at most eight", () => {
  const { s } = setup();
  rest(s, CAROL, 0, SHARE, cents(9950n), 4n);
  const sell = marketOrder(ALICE, 1, 3n * SHARE, 99n * DOLLAR);
  const sold = rank(s, sell, [
    quoted(MAKER_B, cents(9950n), 3n),
    quoted(MAKER_A, cents(9980n), 2n),
  ]);
  // A's 2 at $99.80, then Carol's bid at $99.50 ahead of B's equal quote.
  expect(sold.awards.map((a) => [a.quote.maker, a.quantity])).toEqual([[MAKER_A, 2n * SHARE]]);
  const many = Array.from({ length: 9 }, (_, i) => quoted(wallet(0x100 + i), cents(10010n), 1n));
  const capped = rank(s, marketOrder(ALICE, 0, 12n * SHARE, 102n * DOLLAR), many);
  expect(capped.plan.makers).toHaveLength(8);
  expect(capped.awards).toHaveLength(8);
});

test("the plan carries the book's legs as makers and each award as a quote fill", async () => {
  const { s, m } = setup();
  const q = terms(cents(10050n), 3n);
  const signature = await makers[0]!.signTypedData({
    domain: quoteDomain(31337, EXCHANGE),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: { taker: ALICE, terms: quoteTerms(m, buy4, q), nonce: q.nonce },
  });
  const ranked = rank(s, buy4, [{ maker: MAKER_A, terms: { ...q, signature } }]);
  const plan = quotedPlan(ranked.plan, m.seq[0], [
    quoteFill(m, buy4, { ...q, signature }, ranked.awards[0]!.quantity),
  ]);
  // Three from the quote first, then one of Bob's two.
  expect(plan.quotes?.map((f) => f.fill)).toEqual([(3n * SHARE).toString()]);
  expect(plan).toMatchObject({
    nextSequence: m.seq[0].toString(),
    sequences: ["3"],
    quantities: [SHARE.toString()],
    filledQuantity: (4n * SHARE).toString(),
    remainingQuantity: "0",
    minFill: (10n ** 15n).toString(),
  });
  // The app's structural check of a plan accepts it, and refuses a quote for the wrong side.
  expect(() => parseAtomicPlan(plan, buy4)).not.toThrow();
  expect(() => parseAtomicPlan(plan, { ...buy4, side: 1 })).toThrow();
});

test("the top of the book counts only orders that can fill", () => {
  const { s, m } = setup();
  rest(s, CAROL, 0, SHARE, 99n * DOLLAR, 4n);
  rest(s, CAROL, 0, SHARE, cents(9990n), 5n, { expiry: NOW - 1n });
  expect(topOfBook(s, m, 0, NOW)).toEqual({ bestBid: 99n * DOLLAR, bestAsk: 101n * DOLLAR });
  expect(topOfBook(s, m, 1, NOW)).toEqual({ bestBid: null, bestAsk: null });
});

test("what each maker filled is read back from the receipt's QuoteFilled logs", () => {
  const quoteLog = (maker: Address, quantity: bigint) =>
    exchangeLog("QuoteFilled", {
      market: 1,
      maker,
      fill: quantity | ((2n ** 32n - 1n) << 96n) | (99n << 128n),
      amounts: 0n,
      fees: 0n,
    });
  const fills = quoteFills(
    [quoteLog(MAKER_A, SHARE), quoteLog(MAKER_B, 2n * SHARE), quoteLog(MAKER_A, SHARE)],
    EXCHANGE,
  );
  expect(fills.get(MAKER_A)).toBe(2n * SHARE);
  expect(fills.get(MAKER_B)).toBe(2n * SHARE);
  expect(quoteFills([{ ...quoteLog(MAKER_A, SHARE), address: wallet(0x99) }], EXCHANGE).size).toBe(
    0,
  );
});
