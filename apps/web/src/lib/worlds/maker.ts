/** The other side of a world order: what a wallet that quotes it signs, receives, puts up and
 * stands to win or lose, and how its quote compares with the makers' marks. Pure arithmetic in
 * raw quote units (six decimals); display only until `quoteTypedData`, which is what the wallet
 * signs.
 *
 * An order by stake buys a bundle: `units` on the atoms of its mask (what it pays if right) and,
 * for Money-back, the stake back on atom 0 (the world fails). Its maker is paid the stake and
 * delivers the bundle, setting aside the bundle's largest payout until the world settles; it
 * keeps what the taker does not win. So the maker names one number: the payout. */
import type { BoardRfq, BookView } from "./types";

export const UNIT = 1_000_000n;

/** What a quote of `units` on `order` means for its maker. Amounts are raw quote units. */
export interface MakerSide {
  units: bigint;
  refund: bigint;
  /** The taker's stake: what the maker is paid when the quote fills. */
  price: bigint;
  /** What the maker loses if the taker is right: the payout less the stake. */
  risk: bigint;
  /** What the world credit must hold for the quote to fill (the stake counts toward it). */
  needs: bigint;
  /** Each way it can end, the maker's result in it, and its chance (x 1e6) at the marks. */
  endings: { key: "right" | "wrong" | "fails"; net: bigint; chance: number | null }[];
  /** P(the taker is right), x 1e6, and the maker's expected result, at the marks. */
  winChance: number | null;
  expected: bigint | null;
}

/** Whether an order is one a wallet can quote here: a buy by stake (what the app places). */
export const quotable = (order: BoardRfq["order"]) => order.side === "buy" && order.stake !== null;

const maskAtoms = (mask: number, count: number) => {
  const atoms: number[] = [];
  for (let a = 1; a < count; a++) if ((mask >> a) & 1) atoms.push(a);
  return atoms;
};

/** P(the order's bundle pays its units) and P(the world fails), x 1e6, from a book's marks. */
export function orderChances(order: BoardRfq["order"], book: BookView | undefined) {
  const marks = book?.marks;
  if (!book || !marks || marks.length !== book.atoms) return null;
  const win = maskAtoms(order.mask, book.atoms).reduce((sum, a) => sum + (marks[a] ?? 0), 0);
  return { win, fails: marks[0] ?? 0 };
}

/** The maker's side of `order` at a payout of `units`. `held` is the atoms the wallet already
 * holds in the book (they count toward what it must deliver). */
export function makerSide(
  order: BoardRfq["order"],
  units: bigint,
  book: BookView | undefined,
  held: readonly bigint[] = [],
): MakerSide {
  const price = BigInt(order.stake ?? "0");
  const refund = order.conditional ? price : 0n;
  const count = book?.atoms ?? 0;
  // The books split the largest shortfall from the maker's credit, after paying it the stake.
  // Without the book, as if the wallet held nothing in it.
  let shortfall = units > refund ? units : refund;
  if (count) {
    const pays = new Set(maskAtoms(order.mask, count));
    shortfall = 0n;
    for (let a = 0; a < count; a++) {
      const lack = (a === 0 ? refund : pays.has(a) ? units : 0n) - (held[a] ?? 0n);
      if (lack > shortfall) shortfall = lack;
    }
  }
  const chances = orderChances(order, book);
  // An event-only world has no way to be wrong inside it: the taker loses when it fails.
  const priced = count > 2;
  const loses = chances ? Math.max(0, 1_000_000 - chances.win - chances.fails) : null;
  const endings: MakerSide["endings"] = [
    { key: "right", net: price - units, chance: chances?.win ?? null },
  ];
  if (order.conditional) {
    endings.push({ key: "wrong", net: price, chance: loses });
    endings.push({ key: "fails", net: price - refund, chance: chances?.fails ?? null });
  } else
    endings.push({
      key: "wrong",
      net: price,
      chance: chances ? (priced ? (loses ?? 0) + chances.fails : chances.fails) : null,
    });
  const expected = chances
    ? price - (units * BigInt(chances.win) + refund * BigInt(chances.fails)) / 1_000_000n
    : null;
  return {
    units,
    refund,
    price,
    risk: units > price ? units - price : 0n,
    needs: shortfall > price ? shortfall - price : 0n,
    endings,
    winChance: chances?.win ?? null,
    expected,
  };
}

/** The payout at which the maker neither gains nor loses on average at the marks: more than
 * this and the quote gives money away, less and it keeps an edge. Null without marks. */
export function breakEvenUnits(order: BoardRfq["order"], book: BookView | undefined) {
  const chances = orderChances(order, book);
  if (!chances || chances.win <= 0) return null;
  const price = BigInt(order.stake ?? "0");
  const refund = order.conditional ? price : 0n;
  const net = price * 1_000_000n - refund * BigInt(chances.fails);
  return net <= 0n ? null : net / BigInt(chances.win);
}

/** Dollars typed by a person ("64", "64.5", "1,200.25") as raw units, or null. */
export function parseDollars(text: string): bigint | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d{1,12}(\.\d{0,6})?$/.test(t)) return null;
  const [whole = "0", cents = ""] = t.split(".");
  return BigInt(whole) * UNIT + BigInt(cents.padEnd(6, "0"));
}
/** Raw units as a person would type them: "64.10", "64". */
export function dollarsText(raw: bigint) {
  const whole = raw / UNIT;
  const cents = ((raw % UNIT) + 5_000n) / 10_000n;
  if (cents >= 100n) return (whole + 1n).toString();
  return cents ? `${whole}.${cents.toString().padStart(2, "0")}` : whole.toString();
}

/** The fields of the books' `WorldQuote`, as its EIP-712 type lists them
 * (`WORLD_QUOTE_TYPES` in the EVM client; a test holds the two together). */
export const WORLD_QUOTE_FIELDS = [
  { name: "taker", type: "address" },
  { name: "book", type: "uint64" },
  { name: "mask", type: "uint16" },
  { name: "units", type: "uint128" },
  { name: "refund", type: "uint128" },
  { name: "sell", type: "bool" },
  { name: "price", type: "uint128" },
  { name: "expiry", type: "uint40" },
  { name: "makerData", type: "uint64" },
  { name: "nonce", type: "uint256" },
] as const;

/** A fresh wallet nonce: 64 random bits (the books keep nonces below 2^96 for wallets, and
 * each fills once). */
export function freshNonce() {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(high) << 32n) | BigInt(low);
}

/** The typed data a wallet signs to quote `rfq` with `side` until `expiry` (unix seconds), as
 * JSON for `eth_signTypedData_v4`, and the quote's fields as the API takes them. The domain is
 * the world books of this build's deployment: a signature fills only there. */
export function quoteTypedData(input: {
  chainId: number;
  books: string;
  rfq: Pick<BoardRfq, "taker" | "book" | "order">;
  side: Pick<MakerSide, "units" | "refund" | "price">;
  expiry: number;
  nonce: bigint;
}) {
  const { rfq, side } = input;
  const message = {
    taker: rfq.taker,
    book: String(rfq.book),
    mask: rfq.order.mask,
    units: side.units.toString(),
    refund: side.refund.toString(),
    sell: rfq.order.side === "sell",
    price: side.price.toString(),
    expiry: input.expiry,
    makerData: "0",
    nonce: input.nonce.toString(),
  };
  return {
    typed: JSON.stringify({
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        WorldQuote: WORLD_QUOTE_FIELDS,
      },
      primaryType: "WorldQuote",
      domain: {
        name: "Probabl Worlds",
        version: "1",
        chainId: input.chainId,
        verifyingContract: input.books,
      },
      message,
    }),
    quote: {
      units: message.units,
      refund: message.refund,
      price: message.price,
      expiry: String(input.expiry),
      nonce: message.nonce,
    },
  };
}
