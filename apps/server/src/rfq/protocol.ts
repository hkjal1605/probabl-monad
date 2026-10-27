/** The RFQ stream's wire format (version 1): JSON text frames over one WebSocket per approved
 * maker connection, authenticated by the maker's API key. Amounts are decimal strings of raw
 * token units; prices are raw quote units per raw base unit x 1e18, as on the exchange.
 *
 * Server to maker: `welcome` once, then `rfq` for every market order, `quote.accepted` or
 * `quote.rejected` for each quote, `rfq.result` once the order settled, `pong`, `error`.
 * Maker to server: `quote` (a signed price, replacing that maker's earlier quote for the
 * request), `decline`, `ping`, and `indications` (its current prices for a standard order, which
 * the app shows and charts). docs/rfq.md specifies every field. */
import {
  type OrderWire,
  QUOTE_TYPES,
  quoteDomain,
  U40_MAX,
  unsigned,
} from "@conditional-stocks/evm-client";
import type { MarketState } from "@conditional-stocks/evm-client/ledger";
import type { Address, Hex } from "viem";

export const RFQ_PROTOCOL_VERSION = 1;
/** Longest frame a maker may send: a quote is under 500 bytes, a full vault's indications
 * (48 markets, both branches) under 10 KB. */
export const MAX_MAKER_FRAME = 16_384;
/** Prices one `indications` frame may carry. */
export const MAX_INDICATIONS = 256;
const U128_MAX = (1n << 128n) - 1n;
const U256_MAX = (1n << 256n) - 1n;

export interface MakerIdentity {
  id: string;
  label: string;
  wallet: Address;
}
/** A maker's signed offer for one request: the price it fills at and up to how much. */
export interface MakerQuote {
  price: bigint;
  quantity: bigint;
  /** How the maker delivers: 0 from its underlying credit, 1 from its claims on the branch. */
  fundingKind: number;
  /** Unix seconds: the quote fills only before it. */
  expiry: bigint;
  /** Fills once: bit `nonce % 256` of word `nonce / 256` (sequential nonces cost least gas). */
  nonce: bigint;
  /** The maker wallet's EIP-712 signature of Quote(taker, terms, nonce). */
  signature: Hex;
}
/** A maker's current prices for one market branch, for a standard order: unsigned and not
 * binding (a market order still gets a firm quote). Raw prices as on the exchange. */
export interface MakerIndication {
  market: number;
  branch: 0 | 1;
  /** What the maker pays for the branch's stock, or null when it does not buy. */
  bid: bigint | null;
  /** What it sells at, or null when it does not sell. */
  ask: bigint | null;
}
export type MakerMessage =
  | ({ type: "quote"; rfqId: string } & MakerQuote)
  | { type: "decline"; rfqId: string }
  | { type: "ping"; id: string | null }
  | { type: "indications"; prices: MakerIndication[] };

const RFQ_ID = /^[0-9a-f-]{36}$/;
const PING_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** 65-byte (r, s, v) or 64-byte EIP-2098 compact signatures. */
const SIGNATURE = /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/;

/** A maker's frame, or an error saying what is wrong with it. */
export function parseMakerMessage(text: string): MakerMessage {
  if (text.length > MAX_MAKER_FRAME) throw new Error("Message too large");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Messages are JSON objects");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Messages are JSON objects");
  const m = value as Record<string, unknown>;
  if (m.type === "ping") {
    if (m.id !== undefined && (typeof m.id !== "string" || !PING_ID.test(m.id)))
      throw new Error("Invalid ping id");
    return { type: "ping", id: (m.id as string | undefined) ?? null };
  }
  if (m.type === "indications") return { type: "indications", prices: parseIndications(m.prices) };
  if (m.type !== "quote" && m.type !== "decline") throw new Error("Unknown message type");
  if (typeof m.rfqId !== "string" || !RFQ_ID.test(m.rfqId)) throw new Error("Invalid rfqId");
  if (m.type === "decline") return { type: "decline", rfqId: m.rfqId };
  const fundingKind = m.fundingKind ?? 0;
  if (fundingKind !== 0 && fundingKind !== 1) throw new Error("fundingKind is 0 or 1");
  let price: bigint, quantity: bigint, expiry: bigint, nonce: bigint;
  try {
    price = unsigned(m.price);
    quantity = unsigned(m.quantity);
    expiry = unsigned(m.expiry, U40_MAX);
    nonce = unsigned(m.nonce, U256_MAX);
  } catch {
    throw new Error("price, quantity, expiry and nonce are decimal strings");
  }
  if (typeof m.signature !== "string" || !SIGNATURE.test(m.signature))
    throw new Error("signature is a 65- or 64-byte hex string");
  return {
    type: "quote",
    rfqId: m.rfqId,
    price,
    quantity,
    fundingKind,
    expiry,
    nonce,
    signature: m.signature as Hex,
  };
}

/** An `indications` frame's prices: every one names a market and branch, and a positive bid at or
 * below a positive ask (either may be null). */
function parseIndications(value: unknown): MakerIndication[] {
  if (!Array.isArray(value) || value.length > MAX_INDICATIONS)
    throw new Error(`prices lists at most ${MAX_INDICATIONS} market branches`);
  const price = (v: unknown) => {
    if (v === null) return null;
    const raw = unsigned(v, U128_MAX);
    if (raw === 0n) throw new Error();
    return raw;
  };
  return value.map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (
      !Number.isSafeInteger(e.market) ||
      (e.market as number) <= 0 ||
      (e.market as number) >= 2 ** 32
    )
      throw new Error("Invalid indication market");
    if (e.branch !== 0 && e.branch !== 1) throw new Error("branch is 0 (YES) or 1 (NO)");
    let bid: bigint | null, ask: bigint | null;
    try {
      bid = price(e.bid ?? null);
      ask = price(e.ask ?? null);
    } catch {
      throw new Error("bid and ask are positive decimal strings or null");
    }
    if (bid !== null && ask !== null && bid > ask) throw new Error("bid is above ask");
    return { market: e.market as number, branch: e.branch, bid, ask };
  });
}

/** The request every connected maker receives for one market order. */
export function rfqRequest(input: {
  id: string;
  sentAt: number;
  windowMs: number;
  minQuoteSeconds: number;
  chainId: number;
  exchange: Address;
  market: MarketState;
  quoteToken: Address;
  quoteDecimals: number | null;
  baseDecimals: number | null;
  order: OrderWire;
  book: { bestBid: bigint | null; bestAsk: bigint | null };
}) {
  const { market: m, order: o } = input;
  return {
    type: "rfq",
    version: RFQ_PROTOCOL_VERSION,
    id: input.id,
    sentAt: input.sentAt,
    /** Quotes received after this time (ms since the epoch) are not considered. */
    quoteDeadline: input.sentAt + input.windowMs,
    chainId: input.chainId,
    exchange: input.exchange,
    market: {
      id: String(m.id),
      condition: m.condition,
      base: { token: m.base, decimals: input.baseDecimals },
      quote: { token: input.quoteToken, decimals: input.quoteDecimals },
      tick: m.tick.toString(),
      step: m.step.toString(),
      maxSteps: m.maxSteps.toString(),
      minNotional: m.minNotional.toString(),
      maxOrder: m.maxOrder.toString(),
      open: m.open.toString(),
      cutoff: m.cutoff.toString(),
      makerFeeBps: m.makerBps,
      takerFeeBps: m.takerBps,
      rebateBps: m.rebateBps,
    },
    /** The market order, as its owner signed it in for the API's delegate to place. */
    order: {
      taker: o.maker,
      branch: o.branch,
      side: o.side,
      quantity: o.quantity,
      limitPriceRawX18: o.limitPriceRawX18,
      fundingKind: o.fundingKind,
      tif: o.tif,
      expiry: o.expiry,
      maxFeeBps: o.maxFeeBps,
    },
    /** The side a quote takes: 1 sells to a buying taker, 0 buys from a selling one. */
    quoteSide: 1 - o.side,
    /** The best live prices on the order's branch now. */
    book: {
      bestBid: input.book.bestBid?.toString() ?? null,
      bestAsk: input.book.bestAsk?.toString() ?? null,
    },
    /** What a quote's maker signs: Quote(taker, terms, nonce) under this EIP-712 domain, where
     * terms = market | flags << 32 | expiry << 56 | (price / tick) << 96 | quantity << 160 and
     * flags = branch | quoteSide << 1 | fundingKind << 2. A quote expiring sooner than
     * `minQuoteSeconds` from now is refused: the fill needs time to be included. */
    signing: {
      domain: quoteDomain(input.chainId, input.exchange),
      types: QUOTE_TYPES,
      primaryType: "Quote",
      taker: o.maker,
      minQuoteSeconds: input.minQuoteSeconds,
    },
  };
}
export type RfqRequest = ReturnType<typeof rfqRequest>;
