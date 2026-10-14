/** Pricing a market order against the book and signed RFQ quotes together, without RPC or
 * database.
 *
 * A quote rests nothing. The taker's own placement (`placeWithQuotes`) carries each awarded
 * quote, and the exchange checks the maker's signature and fills it from the maker's balance:
 * one transaction, no maker order. Quotes compete with resting orders in one best-price
 * ranking, each after every resting order at its price (the book keeps priority on ties), and
 * the placement fills them first, each exactly its award, then the book's orders. */
import {
  type AtomicPlan,
  type Candidate,
  conditionalStocksAbi,
  type OrderWire,
  packQuoteTerms,
  planOrder,
  QUOTE_TYPES,
  type QuoteFill,
  quote,
  quoteDomain,
  U96_MAX,
} from "@conditional-stocks/evm-client";
import {
  accountOf,
  type ChainState,
  creditOf,
  type MarketState,
} from "@conditional-stocks/evm-client/ledger";
import { liveOrder } from "@conditional-stocks/indexer";
import {
  type Address,
  decodeEventLog,
  getAddress,
  type Hex,
  hashTypedData,
  type Log,
  parseCompactSignature,
  parseSignature,
  recoverTypedDataAddress,
  signatureToCompactSignature,
} from "viem";
import type { MakerQuote } from "./protocol.ts";

/** The signed `terms` word of a maker's quote for `taker`. */
export const quoteTerms = (m: MarketState, taker: OrderWire, q: MakerQuote) =>
  packQuoteTerms(
    {
      marketId: m.id,
      branch: taker.branch,
      side: 1 - taker.side,
      fundingKind: q.fundingKind,
      expiry: q.expiry,
      priceRawX18: q.price,
      quantity: q.quantity,
    },
    m.tick,
  );

/** Why `q` cannot fill `quantity` of `taker` for `maker`, or null. Everything the exchange
 * checks but the signature (`quoteSigner`): a quote that passes fills, unless the maker's
 * balance changes before the transaction lands, in which case the exchange skips it. */
export function quoteProblem(input: {
  state: ChainState;
  market: MarketState;
  taker: OrderWire;
  maker: Address;
  quote: MakerQuote;
  quantity: bigint;
  now: bigint;
  /** The least lifetime left a quote needs to outlast the taker's inclusion. */
  minQuoteSeconds: number;
}): string | null {
  const { state: s, market: m, taker, quote: q, quantity } = input;
  if (input.maker === taker.maker) return "A maker cannot quote its own order";
  if (q.fundingKind !== 0 && q.fundingKind !== 1) return "fundingKind is 0 or 1";
  if (quantity <= 0n || quantity % m.step !== 0n || q.quantity % m.step !== 0n)
    return "Quantity must be a positive multiple of the market step";
  if (q.quantity > U96_MAX) return "Quantity is outside the supported range";
  if (q.price <= 0n || q.price % m.tick !== 0n)
    return "Price must be a positive multiple of the market tick";
  const limit = BigInt(taker.limitPriceRawX18);
  if (taker.side === 0 ? q.price > limit : q.price < limit)
    return "Price is outside the order's limit";
  if (q.expiry < input.now + BigInt(input.minQuoteSeconds))
    return `The quote must stay valid at least ${input.minQuoteSeconds} s`;
  // The maker delivers at the fill: stock to a buying taker, quote to a selling one.
  const sells = taker.side === 0;
  const required = sells ? quantity : quote(quantity, q.price);
  const account = accountOf(s, m.id, taker.branch, input.maker);
  const available =
    q.fundingKind === 1
      ? sells
        ? account.base
        : account.quote
      : creditOf(s, input.maker, sells ? m.base : s.quote);
  if (available < required) return "The maker's exchange balance cannot fund this quote";
  return null;
}

/** (r, vs) of a 65-byte or 64-byte (EIP-2098) signature, and its 65-byte form. */
function compact(signature: Hex) {
  const c =
    signature.length === 130
      ? parseCompactSignature(signature)
      : signatureToCompactSignature(parseSignature(signature));
  const vs = BigInt(c.yParityAndS);
  const s = (vs & ((1n << 255n) - 1n)).toString(16).padStart(64, "0");
  return {
    r: c.r,
    vs: c.yParityAndS,
    full: `${c.r}${s}${vs >> 255n ? "1c" : "1b"}` as Hex,
  };
}

/** The EIP-712 digest a quote of `q` for `taker` is signed as. */
export function quoteDigest(
  chainId: number,
  exchange: Address,
  m: MarketState,
  taker: OrderWire,
  q: MakerQuote,
): Hex {
  return hashTypedData({
    domain: quoteDomain(chainId, exchange),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: { taker: taker.maker, terms: quoteTerms(m, taker, q), nonce: q.nonce },
  });
}

/** The wallet that signed `q` for `taker` (null for a malformed signature). */
export function quoteSigner(
  chainId: number,
  exchange: Address,
  m: MarketState,
  taker: OrderWire,
  q: MakerQuote,
): Promise<Address | null> {
  try {
    return recoverTypedDataAddress({
      domain: quoteDomain(chainId, exchange),
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: { taker: taker.maker, terms: quoteTerms(m, taker, q), nonce: q.nonce },
      signature: compact(q.signature).full,
    }).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/** The fill of `quantity` from `q` that a placement carries. */
export function quoteFill(
  m: MarketState,
  taker: OrderWire,
  q: MakerQuote,
  quantity: bigint,
): QuoteFill {
  const { r, vs } = compact(q.signature);
  return {
    terms: quoteTerms(m, taker, q).toString(),
    nonce: q.nonce.toString(),
    fill: quantity.toString(),
    r,
    vs,
  };
}

export interface Award<Q> {
  quote: Q;
  quantity: bigint;
}

/** The best fill of `taker` from the book's `candidates` and `quotes` together: one best-price
 * ranking, resting orders first at equal prices, then earlier quotes. An award `viable` refuses
 * at its size drops that quote and the ranking runs again. */
export function selectQuotes<Q extends { terms: MakerQuote; maker: Address }>(input: {
  taker: OrderWire;
  candidates: Candidate[];
  quotes: readonly Q[];
  nextSequence: bigint;
  now: bigint;
  step: bigint;
  makerFeeBps: number;
  takerFeeBps: number;
  viable(quote: Q, quantity: bigint): string | null;
}) {
  const { taker } = input;
  const plan = (quotes: readonly Q[]) =>
    planOrder({
      order: taker,
      candidates: [
        ...input.candidates,
        ...quotes.map((q, i) => ({
          key: `rfq:${i}`,
          // After every resting order: a quote never takes a resting order's place at its price.
          sequence: input.nextSequence + BigInt(i),
          remaining: q.terms.quantity,
          order: {
            maker: q.maker,
            marketId: taker.marketId,
            quantity: q.terms.quantity.toString(),
            limitPriceRawX18: q.terms.price.toString(),
            expiry: q.terms.expiry.toString(),
            maxFeeBps: input.makerFeeBps,
            branch: taker.branch,
            side: 1 - taker.side,
            fundingKind: q.terms.fundingKind,
            tif: 0,
          },
        })),
      ],
      now: input.now,
      step: input.step,
      nextSequence: input.nextSequence + BigInt(quotes.length),
      makerFeeBps: input.makerFeeBps,
      takerFeeBps: input.takerFeeBps,
    });
  let live = [...input.quotes];
  const dropped: { quote: Q; reason: string }[] = [];
  for (;;) {
    const p = plan(live);
    const awards: Award<Q>[] = [];
    p.makers.forEach((key, i) => {
      if (key.startsWith("rfq:"))
        awards.push({ quote: live[Number(key.slice(4))]!, quantity: BigInt(p.quantities[i]!) });
    });
    const refused = awards.flatMap((a) => {
      const reason = input.viable(a.quote, a.quantity);
      return reason ? [{ quote: a.quote, reason }] : [];
    });
    if (!refused.length) return { plan: p, awards, dropped };
    dropped.push(...refused);
    live = live.filter((q) => !refused.some((r) => r.quote === q));
  }
}

/** The plan a placement carries from a ranking of book and quotes: the book's legs as makers
 * (filling greedily after the quotes) and each awarded quote with its exact fill. */
export function quotedPlan(
  ranked: AtomicPlan,
  nextSequence: bigint,
  quotes: QuoteFill[],
): AtomicPlan {
  const book = ranked.makers.flatMap((key, i) => (key.startsWith("rfq:") ? [] : [i]));
  return {
    ...ranked,
    nextSequence: nextSequence.toString(),
    makers: book.map((i) => ranked.makers[i]!),
    sequences: book.map((i) => ranked.sequences[i]!),
    quantities: book.map((i) => ranked.quantities[i]!),
    expectedRemaining: book.map((i) => ranked.expectedRemaining[i]!),
    quotes,
  };
}

/** The best live bid and ask on one branch. */
export function topOfBook(s: ChainState, m: MarketState, branch: number, now: bigint) {
  let bestBid: bigint | null = null,
    bestAsk: bigint | null = null;
  for (const o of s.orders.values()) {
    if (o.market !== m.id || o.branch !== branch || !liveOrder(o, s, now)) continue;
    const price = o.ticks * m.tick;
    if (o.side === 0) {
      if (bestBid === null || price > bestBid) bestBid = price;
    } else if (bestAsk === null || price < bestAsk) bestAsk = price;
  }
  return { bestBid, bestAsk };
}

/** The base quantity each quoting maker filled in a transaction, from its QuoteFilled logs. */
export function quoteFills(logs: readonly Log[], exchange: Address) {
  const fills = new Map<Address, bigint>();
  for (const log of logs) {
    if (log.address.toLowerCase() !== exchange.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: conditionalStocksAbi,
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName !== "QuoteFilled") continue;
      const { maker, fill } = event.args as { maker: Address; fill: bigint };
      const wallet = getAddress(maker);
      fills.set(wallet, (fills.get(wallet) ?? 0n) + (fill & U96_MAX));
    } catch {
      // Not a protocol event.
    }
  }
  return fills;
}
