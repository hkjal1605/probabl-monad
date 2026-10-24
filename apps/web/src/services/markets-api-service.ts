import {
  assertShareUnits,
  formatPriceRawX18,
  formatShareAmount,
  formatTokenAmount,
  type ShareUnits,
  tokenDecimals,
} from "@conditional-stocks/domain";
import { type FeeRates, isFeeRate, isRebateRate } from "@conditional-stocks/evm-client";
import {
  EVENT_SOURCES,
  type EventSource,
  httpsImageUrl,
  polymarketImageUrl,
} from "@conditional-stocks/market-data";
import { venueImageUrl } from "../lib/markets/venue-images";
import { marketTokenDisplay } from "../lib/tokens/catalog";
import type {
  BaseLiveView,
  BaseTokenView,
  BranchBook,
  MarketLifecycle,
  MarketView,
  VenueView,
} from "../types/api";
import { requestJson } from "./api";
import { API_URL } from "./constants";
import { expireCachedProbability, parseProbabilityMessage } from "./probability";

const upstreamUrl = (_service: string) => API_URL;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const number = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const lifecycle = (state: unknown): MarketLifecycle =>
  (
    [
      "scheduled",
      "open",
      "frozen",
      "awaiting-resolution",
      "resolved",
      "redeemable",
      "archived",
    ] as const
  )[Math.max(0, Number(state) - 1)] ?? "scheduled";
/** A raw token amount (decimal string) as an approximate display number, else null. */
const displayAmount = (value: unknown, decimals: number) =>
  typeof value === "string" && /^[0-9]{1,78}$/.test(value)
    ? Number(formatTokenAmount(BigInt(value), decimals))
    : null;
const isoSeconds = (value: unknown) => {
  const seconds = number(value);
  return seconds === null ? new Date(0).toISOString() : new Date(seconds * 1_000).toISOString();
};
function metadataProbability(attached: Record<string, unknown>): MarketView["probability"] | null {
  const snapshot = record(attached.metadata);
  const raw = record(snapshot.rawPayload);
  const parseList = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const outcomes = parseList(raw.outcomes);
  const prices = parseList(raw.outcomePrices);
  const yes = outcomes.findIndex(
    (outcome) => typeof outcome === "string" && outcome.trim().toLowerCase() === "yes",
  );
  const value = number(prices[yes]);
  if (yes < 0 || value === null || value < 0 || value > 1) return null;
  const observed = number(snapshot.fetchedAtMs);
  return {
    ask: null,
    bid: null,
    observedAt: observed === null ? null : new Date(observed).toISOString(),
    quality: "stale",
    value,
  };
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGITS = /^(0|[1-9][0-9]{0,39})$/;
const address = (value: unknown, label: string) => {
  if (typeof value !== "string" || !ADDRESS.test(value))
    throw new Error(`Invalid ${label} address`);
  return value;
};
const digits = (value: unknown, label: string) => {
  const raw = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof raw !== "string" || !DIGITS.test(raw)) throw new Error(`Invalid ${label}`);
  return raw;
};

const PUBLIC_ID = /^[0-9a-f]{16}$/;
/** Where a market trades: its deployment and on-chain market id. */
export function parseVenue(value: unknown): VenueView {
  const venue = record(value);
  const chainId = Number(venue.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid market venue");
  return {
    chainId,
    exchange: address(venue.exchange, "venue exchange"),
    marketId: digits(venue.marketId, "venue market id"),
  };
}

/** The market's base token and its issuer's live state (pause, UI multiplier). */
export function parseBase(
  market: Record<string, unknown>,
): Omit<BaseTokenView, "symbol" | "metadata"> & { symbol: string | null } {
  const base = record(market.base);
  const live = record(base.live);
  const halt = live.halt === null || live.halt === undefined ? null : live.halt;
  if (
    typeof live.paused !== "boolean" ||
    typeof live.tradable !== "boolean" ||
    typeof live.multiplierValue !== "number" ||
    !Number.isFinite(live.multiplierValue) ||
    (halt !== null && halt !== "issuer-paused") ||
    live.tradable !== (halt === null) ||
    base.decimals !== market.shareDecimals
  )
    throw new Error("Invalid base token state");
  return {
    token: address(base.token, "base token"),
    decimals: tokenDecimals(base.decimals),
    symbol: typeof base.symbol === "string" && base.symbol ? base.symbol.slice(0, 32) : null,
    name: typeof base.name === "string" && base.name ? base.name.slice(0, 64) : null,
    live: {
      multiplier: digits(live.multiplier, "multiplier"),
      multiplierValue: live.multiplierValue,
      paused: live.paused,
      tradable: live.tradable,
      halt: halt as BaseLiveView["halt"],
    },
  };
}

/** The market's fee rates: a market without valid ones is never shown as tradable. */
export function parseFees(market: Record<string, unknown>): FeeRates {
  const { makerFeeBps, takerFeeBps } = market;
  if (!isFeeRate(makerFeeBps) || !isFeeRate(takerFeeBps))
    throw new Error("Invalid market fee rates");
  return { makerBps: makerFeeBps, takerBps: takerFeeBps };
}

/** The market's maker rebate in bps of the taker fee; an API without it pays none. */
export function parseRebate(market: Record<string, unknown>): number {
  const { makerRebateBps } = market;
  if (makerRebateBps === undefined) return 0;
  if (!isRebateRate(makerRebateBps)) throw new Error("Invalid market maker rebate");
  return makerRebateBps;
}

/** Aggregate price levels (or full indexed orders) into one branch book. */
export function aggregateBook(
  orders: Record<string, unknown>[],
  branch: number,
  units: ShareUnits,
): BranchBook {
  const side = (value: number) => {
    const totals = new Map<bigint, bigint>();
    for (const order of orders) {
      if (Number(order.branch) !== branch || Number(order.side) !== value) continue;
      const price = BigInt(text(order.limitPriceRawX18));
      totals.set(price, (totals.get(price) ?? 0n) + BigInt(text(order.remaining)));
    }
    return [...totals]
      .sort(([a], [b]) => (a === b ? 0 : (a < b ? -1 : 1) * (value === 0 ? -1 : 1)))
      .map(([price, total]) => ({
        priceExact: formatPriceRawX18(price, units),
        price: Number(formatPriceRawX18(price, units)),
        quantity: Number(formatShareAmount(total, units)),
      }));
  };
  const bids = side(0);
  const asks = side(1);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    asks,
    bestAskExact: asks[0]?.priceExact ?? null,
    bestBidExact: bids[0]?.priceExact ?? null,
    bestAsk,
    bestBid,
    bids,
    depthUsd: [...bids, ...asks].reduce((total, item) => total + item.price * item.quantity, 0),
    spread: bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null,
  };
}

/** Markets per `/v1/events` read (the API's limit). */
const EVENT_BATCH_SIZE = 50;
/** Events (a market's off-chain metadata and its latest probability) as last read, by market.
 * Chain frames cannot change them and probability has its own stream, so a list refreshed by a
 * frame reuses one read within a minute. A failed read falls back on one up to 30 minutes old
 * rather than leaving markets without their question, art and rules. */
const EVENT_FRESH_MS = 60_000;
const EVENT_KEPT_MS = 30 * 60_000;
const eventCache = new Map<string, { event: Record<string, unknown>; at: number }>();
/** Forgets the kept events (tests that reuse market ids with other event data). */
export const forgetEvents = () => eventCache.clear();
/** Whether a read could not get every event it needed (the caller reads again later). */
export interface MarketsReadReport {
  eventsFailed: boolean;
}
type Book = { orders: Record<string, unknown>[]; truncated?: boolean; unavailable?: boolean };
const UNAVAILABLE_BOOK: Book = { orders: [], unavailable: true, truncated: false };

/** The market list (or one market by its URL segment) with each market's book and event. A list
 * read costs three requests: the markets, all their books, and their events in batches of 50
 * (one market per event: sibling markets share their event). A single market's three reads start
 * together, as the indexer and the API resolve the segment themselves. */
async function liveMarkets(
  marketId?: string,
  signal?: AbortSignal,
  report?: MarketsReadReport,
): Promise<MarketView[]> {
  const json = <T>(url: string): Promise<T> =>
    requestJson<T>(new URL(url).pathname + new URL(url).search, signal ? { signal } : {});
  /** The events of `ids`: kept ones within a minute, the rest read in batches of 50 (each batch
   * tried twice). An entry the API could not produce, or a batch that failed, keeps the last
   * good event and is reported so the list is read again. */
  const events = async (ids: string[]): Promise<Record<string, unknown>> => {
    const now = Date.now();
    const due = ids.filter((id) => (eventCache.get(id)?.at ?? 0) <= now - EVENT_FRESH_MS);
    const read = (batch: string[]) =>
      json<{ events: Record<string, unknown> }>(
        `${upstreamUrl("api")}/v1/events?markets=${batch.map(encodeURIComponent).join(",")}`,
      ).then((response) => record(response.events));
    await Promise.all(
      Array.from({ length: Math.ceil(due.length / EVENT_BATCH_SIZE) }, async (_, i) => {
        const batch = due.slice(i * EVENT_BATCH_SIZE, (i + 1) * EVENT_BATCH_SIZE);
        const result = await read(batch)
          .catch(async () => {
            if (signal?.aborted) return null;
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            return signal?.aborted ? null : read(batch);
          })
          .catch(() => null);
        for (const id of batch) {
          const event = result ? record(result[id]) : {};
          if (result && Object.keys(event).length && !("error" in event))
            eventCache.set(id, { event, at: Date.now() });
          else if (report && !signal?.aborted) report.eventsFailed = true;
        }
      }),
    );
    const kept = Date.now() - EVENT_KEPT_MS;
    return Object.fromEntries(
      ids.flatMap((id) => {
        const entry = eventCache.get(id);
        return entry && entry.at > kept ? [[id, entry.event]] : [];
      }),
    );
  };
  const singleEvent = marketId ? events([marketId]) : undefined;
  const singleBook = marketId
    ? json<Book>(
        `${upstreamUrl("indexer")}/orderbook/${encodeURIComponent(marketId)}?limit=2000`,
      ).catch(() => UNAVAILABLE_BOOK)
    : undefined;
  // The list's books come in one projection, overlapping the market list.
  const batchPromise = marketId
    ? Promise.resolve(null)
    : json<{ books: Record<string, Book> }>(
        `${upstreamUrl("indexer")}/orderbooks?view=levels`,
      ).catch(() => null);
  const marketResponse = marketId
    ? {
        markets: [
          await json<Record<string, unknown>>(
            `${upstreamUrl("indexer")}/markets/${encodeURIComponent(marketId)}`,
          ),
        ],
      }
    : await json<{ markets: Record<string, unknown>[] }>(`${upstreamUrl("indexer")}/markets`);
  // Sibling asset markets share one immutable event (a Polymarket or Kalshi market). Read its
  // metadata/probability once so one event cannot randomly diverge per asset.
  const representative = new Map<string, string>();
  for (const market of marketResponse.markets) {
    const condition = text(market.eventConditionId).toLowerCase();
    if (!representative.has(condition)) representative.set(condition, text(market.id));
  }
  const ids = [...representative.values()];
  const read: Promise<Record<string, unknown>> = singleEvent
    ? singleEvent.then((found) => ({ [ids[0] ?? ""]: found[marketId ?? ""] }))
    : events(ids);
  const attachments = new Map<string, Promise<Record<string, unknown>>>();
  for (const [condition, id] of representative)
    attachments.set(
      condition,
      read.then((found) => record(found[id])),
    );
  const batch = await batchPromise;
  return Promise.all(
    marketResponse.markets.map(async (market): Promise<MarketView> => {
      assertShareUnits(market);
      const id = text(market.id);
      if (!PUBLIC_ID.test(id)) throw new Error("Invalid market id");
      const venue = parseVenue(market.venue);
      const base = parseBase(market);
      const fees = parseFees(market);
      const makerRebateBps = parseRebate(market);
      const quoteToken = address(market.quoteToken, "quote token");
      const condition = text(market.eventConditionId).toLowerCase();
      const [attached, book] = await Promise.all([
        attachments.get(condition) ?? Promise.resolve({}),
        singleBook ?? Promise.resolve(batch?.books?.[id] ?? UNAVAILABLE_BOOK),
      ]);
      const attachedRecord = record(attached);
      const metadata = record(record(attachedRecord.metadata).normalized);
      const source: EventSource = EVENT_SOURCES.includes(market.eventSource as EventSource)
        ? (market.eventSource as EventSource)
        : "polymarket";
      const probability = record(attachedRecord.probability);
      let probabilityView: MarketView["probability"] = {
        ask: null,
        bid: null,
        observedAt: null,
        quality: "disconnected",
        value: null,
      };
      try {
        probabilityView = expireCachedProbability(
          parseProbabilityMessage(
            { topic: `probability.${text(market.eventConditionId)}`, value: probability },
            text(market.eventConditionId),
          ),
        );
      } catch {
        /* Unverified reference data must not become a usable probability. */
      }
      if (probabilityView.value === null)
        probabilityView = metadataProbability(attachedRecord) ?? probabilityView;
      // A capped response cannot establish best prices or total depth on both sides.
      const usableOrders = book.truncated || book.unavailable ? [] : book.orders;
      const yes = aggregateBook(usableOrders, 0, market);
      const no = aggregateBook(usableOrders, 1, market);
      const yesMid =
        yes.bestBid !== null && yes.bestAsk !== null && yes.bestAsk >= yes.bestBid
          ? (yes.bestBid + yes.bestAsk) / 2
          : null;
      const noMid =
        no.bestBid !== null && no.bestAsk !== null && no.bestAsk >= no.bestBid
          ? (no.bestBid + no.bestAsk) / 2
          : null;
      const display = marketTokenDisplay(
        base,
        { symbol: text(market.quoteSymbol) || null, name: text(market.quoteName) || null },
        venue.chainId,
        text(record(metadata.asset).symbol, "STOCK"),
      );
      return {
        shareDecimals: market.shareDecimals,
        quoteTokenDecimals: market.quoteTokenDecimals,
        protocolVersion: market.protocolVersion,
        priceFormat: market.priceFormat,
        baseStep: text(market.baseStep),
        minNotional: text(market.minNotional, "0"),
        priceTickRawX18: text(market.priceTickRawX18, "1"),
        fees,
        makerRebateBps,
        bookQuality: book.unavailable ? "unavailable" : book.truncated ? "truncated" : "available",
        base: {
          ...base,
          symbol: base.symbol ?? display.ticker,
          ...(display.assetMetadata ? { metadata: display.assetMetadata } : {}),
        },
        cutoff: isoSeconds(market.tradingCutoff),
        createdAt: text(market.createdAt) || null,
        description: text(
          metadata.rules,
          "Immutable conditional stock market with manual resolution.",
        ),
        eventImpact: yesMid !== null && noMid !== null ? yesMid - noMid : null,
        id,
        slug: text(market.slug, id),
        underlying: typeof market.underlying === "string" ? market.underlying : null,
        venue,
        lifecycle: lifecycle(market.state),
        mapping: {
          conditionId: text(market.eventConditionId),
          noIndex: text(market.eventNoIndex),
          source,
          sourceUrl: text(metadata.canonicalUrl, `https://${source}.com`),
          yesIndex: text(market.eventYesIndex),
        },
        no,
        ordinaryReference: null,
        probability: probabilityView,
        question: text(metadata.question, `Conditional market ${id.slice(0, 8)}`),
        event: {
          endTime: Number.isFinite(Date.parse(text(metadata.endTime)))
            ? new Date(text(metadata.endTime)).toISOString()
            : null,
          ...(text(metadata.seriesTicker) ? { series: text(metadata.seriesTicker) } : {}),
          ...(text(metadata.eventTicker) ? { eventTicker: text(metadata.eventTicker) } : {}),
          result: metadata.result === "yes" || metadata.result === "no" ? metadata.result : null,
        },
        // The venue's artwork as normalized (Polymarket's image, Kalshi's market or series
        // image), else a Polymarket payload's own fields.
        imageUrl: venueImageUrl(
          httpsImageUrl(metadata.imageUrl) ??
            polymarketImageUrl(record(attachedRecord.metadata).rawPayload),
        ),
        quoteToken,
        residual: null,
        ticker: display.ticker,
        assetKey: display.assetKey,
        ...(display.assetMetadata ? { assetMetadata: display.assetMetadata } : {}),
        ...(display.quoteTokenMetadata ? { quoteTokenMetadata: display.quoteTokenMetadata } : {}),
        tradingOpen: isoSeconds(market.tradingOpen),
        volume24h: displayAmount(market.volume24h, market.quoteTokenDecimals),
        yes,
      };
    }),
  );
}

export const marketsApi = { liveMarkets };
