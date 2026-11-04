/** The RFQ stream's world messages (protocol version 2, docs/version-2-plan.md §10.2), carried
 * on the same WebSocket as version 1 for makers the market admin approved for worlds. Amounts
 * are decimal strings of raw quote units; per-unit prices and atom marks are x 1e6.
 *
 * Server to maker: `world.rfq` for every world order, `quote.accepted` / `quote.rejected` for
 * each quote, `world.result` once the order settled. Maker to server: `world.quote` (a signed
 * `WorldQuote`), `decline` (shared with version 1), and `world.indications` (its current
 * prices for each book's standard products and the atom marks it values books at). */

import {
  BOOK_STATE_NAMES,
  parseProductKey,
  U40_MAX,
  U64_MAX,
  U128_MAX,
  unsigned,
  WORLD_MAX_ATOMS,
  WORLD_QUOTE_TYPES,
  worldQuoteDomain,
} from "@conditional-stocks/evm-client";
import { type BookState, bookStateAt } from "@conditional-stocks/evm-client/world-ledger";
import type { Address, Hex } from "viem";

export const WORLD_PROTOCOL_VERSION = 2;
/** Books one `world.indications` frame may carry (a maker sends several frames for more). */
export const MAX_INDICATED_BOOKS = 24;
const MAX_PRODUCTS = 48;
const U256_MAX = (1n << 256n) - 1n;
const RFQ_ID = /^[0-9a-f-]{36}$/;
const SIGNATURE = /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/;
const MILLION = 1_000_000;

/** A maker's signed answer to a world request: the bundle it fills (as requested, or the units
 * it gives for a stake) at `price`, and the rest of its `WorldQuote`. */
export interface WorldMakerQuote {
  units: bigint;
  refund: bigint;
  price: bigint;
  expiry: bigint;
  makerData: bigint;
  nonce: bigint;
  signature: Hex;
}
/** A maker's current prices for one book: per standard product, the bid and ask per unit
 * (x 1e6; a conditional payout's price is per unit inside the world), and the atom marks
 * (chances x 1e6 summing to a million) it values holdings at. */
export interface WorldIndication {
  book: number;
  marks: number[] | null;
  products: { key: string; bid: number | null; ask: number | null }[];
  analytics: WorldAnalytics | null;
}
/** What a maker explains a book's price with (chances x 1e6): each open leg's chance, the
 * chance chain in book order and the same chain were the legs unrelated, P(W), and for a priced
 * book the spot and the world's forward (feed units) and the one-standard-deviation log move to
 * the fixing (x 1e6). */
export interface WorldAnalytics {
  legs: { eventKey: Hex; chance: number }[];
  chain: number[];
  naive: number[];
  world: number;
  spot: number | null;
  forward: number | null;
  move: number | null;
}
/** A maker's answer to `world.preview`: a world priced before its book exists. */
export interface WorldPreviewAnswer {
  decline: string | null;
  marks: number[] | null;
  analytics: WorldAnalytics | null;
  priorOnly: boolean;
  products: {
    key: string;
    stake: string;
    units: string | null;
    ask: number | null;
    decline: string | null;
  }[];
}
export type WorldMakerMessage =
  | ({ type: "world.quote"; rfqId: string } & WorldMakerQuote)
  | { type: "world.indications"; books: WorldIndication[] }
  | ({ type: "world.previewed"; id: string } & WorldPreviewAnswer);

const per = (v: unknown, name: string) => {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || (v as number) <= 0 || (v as number) > MILLION)
    throw new Error(`${name} is an integer from 1 to 1,000,000, or null`);
  return v as number;
};

const chance = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MILLION;
const positive = (v: unknown) =>
  v === null || v === undefined
    ? null
    : typeof v === "number" && v > 0 && Number.isFinite(v)
      ? v
      : Number.NaN;

/** A maker's analytics of a book, checked; null when absent. */
export function parseAnalytics(value: unknown): WorldAnalytics | null {
  if (value === null || value === undefined) return null;
  const a = value as Record<string, unknown>;
  const list = (v: unknown, name: string) => {
    if (!Array.isArray(v) || v.length > 6 || !v.every(chance))
      throw new Error(`analytics.${name} lists up to 6 chances x 1e6`);
    return v as number[];
  };
  if (!Array.isArray(a.legs) || a.legs.length > 6) throw new Error("analytics.legs");
  const legs = a.legs.map((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    if (
      typeof x.eventKey !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(x.eventKey) ||
      !chance(x.chance)
    )
      throw new Error("analytics.legs");
    return { eventKey: x.eventKey.toLowerCase() as Hex, chance: x.chance as number };
  });
  const spot = positive(a.spot),
    forward = positive(a.forward);
  if (Number.isNaN(spot) || Number.isNaN(forward)) throw new Error("analytics spot and forward");
  if (
    a.move !== null &&
    a.move !== undefined &&
    !(Number.isInteger(a.move) && (a.move as number) >= 0)
  )
    throw new Error("analytics.move");
  if (!chance(a.world)) throw new Error("analytics.world");
  return {
    legs,
    chain: list(a.chain, "chain"),
    naive: list(a.naive, "naive"),
    world: a.world as number,
    spot,
    forward,
    move: (a.move as number | null | undefined) ?? null,
  };
}

const marksOf = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (
    !Array.isArray(v) ||
    v.length < 2 ||
    v.length > WORLD_MAX_ATOMS ||
    v.some((x) => !Number.isInteger(x) || x < 0 || x > MILLION)
  )
    throw new Error("marks are 2 to 10 integers from 0 to 1,000,000");
  const total = (v as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(total - MILLION) > v.length) throw new Error("marks sum to 1,000,000");
  return v as number[];
};

/** A maker's world frame, or an error saying what is wrong with it. */
export function parseWorldMessage(m: Record<string, unknown>): WorldMakerMessage {
  if (m.type === "world.previewed") {
    if (typeof m.id !== "string" || !RFQ_ID.test(m.id)) throw new Error("Invalid preview id");
    if (typeof m.decline === "string")
      return {
        type: "world.previewed",
        id: m.id,
        decline: m.decline.slice(0, 200),
        marks: null,
        analytics: null,
        priorOnly: false,
        products: [],
      };
    if (!Array.isArray(m.products) || m.products.length > MAX_PRODUCTS)
      throw new Error(`products lists at most ${MAX_PRODUCTS} products`);
    const products = m.products.map((p) => {
      const x = (p ?? {}) as Record<string, unknown>;
      if (typeof x.key !== "string" || !parseProductKey(x.key))
        throw new Error("Invalid product key");
      let stake: bigint, units: bigint | null;
      try {
        stake = unsigned(x.stake, U128_MAX);
        units = x.units === null || x.units === undefined ? null : unsigned(x.units, U128_MAX);
      } catch {
        throw new Error("stake and units are decimal strings");
      }
      return {
        key: x.key,
        stake: stake.toString(),
        units: units?.toString() ?? null,
        ask: per(x.ask, "ask"),
        decline: typeof x.decline === "string" ? x.decline.slice(0, 200) : null,
      };
    });
    return {
      type: "world.previewed",
      id: m.id,
      decline: null,
      marks: marksOf(m.marks),
      analytics: parseAnalytics(m.analytics),
      priorOnly: m.priorOnly === true,
      products,
    };
  }
  if (m.type === "world.indications") {
    if (!Array.isArray(m.books) || m.books.length > MAX_INDICATED_BOOKS)
      throw new Error(`books lists at most ${MAX_INDICATED_BOOKS} books`);
    return {
      type: "world.indications",
      books: m.books.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        if (!Number.isSafeInteger(e.book) || (e.book as number) <= 0)
          throw new Error("Invalid indication book");
        const marks = marksOf(e.marks);
        if (!Array.isArray(e.products) || e.products.length > MAX_PRODUCTS)
          throw new Error(`products lists at most ${MAX_PRODUCTS} products`);
        const products = e.products.map((p) => {
          const x = (p ?? {}) as Record<string, unknown>;
          if (typeof x.key !== "string" || !parseProductKey(x.key))
            throw new Error("Invalid product key");
          const bid = per(x.bid, "bid"),
            ask = per(x.ask, "ask");
          if (bid !== null && ask !== null && bid > ask) throw new Error("bid is above ask");
          return { key: x.key, bid, ask };
        });
        return { book: e.book as number, marks, products, analytics: parseAnalytics(e.analytics) };
      }),
    };
  }
  if (m.type !== "world.quote") throw new Error("Unknown message type");
  if (typeof m.rfqId !== "string" || !RFQ_ID.test(m.rfqId)) throw new Error("Invalid rfqId");
  let quote: Omit<WorldMakerQuote, "signature">;
  try {
    quote = {
      units: unsigned(m.units, U128_MAX),
      refund: unsigned(m.refund, U128_MAX),
      price: unsigned(m.price, U128_MAX),
      expiry: unsigned(m.expiry, U40_MAX),
      makerData: unsigned(m.makerData ?? "0", U64_MAX),
      nonce: unsigned(m.nonce, U256_MAX),
    };
  } catch {
    throw new Error("units, refund, price, expiry, makerData and nonce are decimal strings");
  }
  if (typeof m.signature !== "string" || !SIGNATURE.test(m.signature))
    throw new Error("signature is a 65- or 64-byte hex string");
  return { type: "world.quote", rfqId: m.rfqId, ...quote, signature: m.signature as Hex };
}

/** What a world order asks for. A buy names its bundle by `units` (and `refund`), and the
 * makers price it; or by `stake`, and the makers say how many units they give for it (a
 * conditional payout's refund is the stake). A sell (cash-out) names its bundle, and the makers
 * bid for it. `limit` is the taker's worst acceptable price (a buy by units: the most it pays;
 * a sell: the least it takes) or, for a buy by stake, the fewest units it accepts. */
export interface WorldOrder {
  taker: Address;
  book: number;
  mask: number;
  side: "buy" | "sell";
  units: bigint | null;
  refund: bigint;
  stake: bigint | null;
  conditional: boolean;
  limit: bigint;
}

/** The request every world maker receives for one world order. */
export function worldRfqRequest(input: {
  id: string;
  sentAt: number;
  windowMs: number;
  minQuoteSeconds: number;
  chainId: number;
  books: Address;
  book: BookState;
  state: Parameters<typeof bookStateAt>[0];
  now: bigint;
  order: WorldOrder;
}) {
  const { book: b, order: o } = input;
  const state = bookStateAt(input.state, b, input.now);
  return {
    type: "world.rfq",
    version: WORLD_PROTOCOL_VERSION,
    id: input.id,
    sentAt: input.sentAt,
    quoteDeadline: input.sentAt + input.windowMs,
    chainId: input.chainId,
    books: input.books,
    book: {
      id: String(b.id),
      defHash: b.defHash,
      atoms: b.atoms,
      feeBps: b.def.feeBps,
      cutoff: String(b.def.cutoff),
      fixingTime: String(b.def.fixingTime),
      state: BOOK_STATE_NAMES[state] ?? "unknown",
    },
    order: {
      taker: o.taker,
      side: o.side,
      mask: o.mask,
      units: o.units?.toString() ?? null,
      refund: o.refund.toString(),
      stake: o.stake?.toString() ?? null,
      conditional: o.conditional,
      limit: o.limit.toString(),
    },
    /** What a quote's maker signs: `WorldQuote` under this EIP-712 domain, with `sell` true
     * when the taker sells. A buy by stake is quoted at `price` = stake, refund = stake for a
     * conditional payout (else zero), and the units the maker gives. A quote expiring sooner
     * than `minQuoteSeconds` from now is refused. */
    signing: {
      domain: worldQuoteDomain(input.chainId, input.books),
      types: WORLD_QUOTE_TYPES,
      primaryType: "WorldQuote",
      minQuoteSeconds: input.minQuoteSeconds,
    },
  };
}
export type WorldRfqRequest = ReturnType<typeof worldRfqRequest>;
