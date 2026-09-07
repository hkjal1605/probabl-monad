import "server-only";
import {
  assertMarketUnits,
  formatPriceRawX18,
  formatTokenAmount,
  type MarketUnits,
} from "@conditional-stocks/domain";

import { protocolConfig } from "@/config/protocol";
import { isDemoMode } from "@/lib/demo/server";
import type {
  BranchBook,
  IndexedOrder,
  MarketLifecycle,
  MarketView,
  PositionView,
  ResolutionView,
  TradeView,
} from "./types";

const json = async <T>(url: string): Promise<T> => {
  if (await isDemoMode()) throw new Error("Live server reads are disabled in demo mode.");
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3_500) });
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}`);
  return response.json() as Promise<T>;
};

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
const isoSeconds = (value: unknown) => {
  const seconds = number(value);
  return seconds === null ? new Date(0).toISOString() : new Date(seconds * 1_000).toISOString();
};
function aggregateBook(
  orders: Record<string, unknown>[],
  branch: number,
  units: MarketUnits,
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
      .map(([price, quantity]) => ({
        priceExact: formatPriceRawX18(price, units),
        price: Number(formatPriceRawX18(price, units)),
        quantity: Number(formatTokenAmount(quantity, units.baseTokenDecimals)),
      }));
  };
  const bids = side(0);
  const asks = side(1);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    asks: asks.slice(0, 12),
    bestAskExact: asks[0]?.priceExact ?? null,
    bestBidExact: bids[0]?.priceExact ?? null,
    bestAsk,
    bestBid,
    bids: bids.slice(0, 12),
    depthUsd: [...bids, ...asks].reduce((total, item) => total + item.price * item.quantity, 0),
    spread: bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null,
  };
}

async function liveMarkets(): Promise<MarketView[]> {
  const marketResponse = await json<{ markets: Record<string, unknown>[] }>(
    `${protocolConfig.indexerUrl}/markets`,
  );
  return Promise.all(
    marketResponse.markets.map(async (market): Promise<MarketView> => {
      assertMarketUnits(market);
      const id = text(market.id);
      const [attached, book] = await Promise.all([
        json<Record<string, unknown>>(`${protocolConfig.apiUrl}/v1/markets/${id}/polymarket`).catch(
          () => ({}),
        ),
        json<{ orders: Record<string, unknown>[] }>(
          `${protocolConfig.indexerUrl}/orderbook/${id}`,
        ).catch(() => ({ orders: [] })),
      ]);
      const attachedRecord = record(attached);
      const metadata = record(record(attachedRecord.metadata).normalized);
      const probability = record(attachedRecord.probability);
      const midpoint = number(probability.midpointX6);
      const yes = aggregateBook(book.orders, 0, market);
      const no = aggregateBook(book.orders, 1, market);
      const yesMid =
        yes.bestBid !== null && yes.bestAsk !== null ? (yes.bestBid + yes.bestAsk) / 2 : null;
      const noMid =
        no.bestBid !== null && no.bestAsk !== null ? (no.bestBid + no.bestAsk) / 2 : null;
      return {
        baseTokenDecimals: market.baseTokenDecimals,
        quoteTokenDecimals: market.quoteTokenDecimals,
        protocolVersion: market.protocolVersion,
        priceFormat: market.priceFormat,
        baseStep: text(market.baseStep),
        baseToken: text(market.baseToken),
        cutoff: isoSeconds(market.tradingCutoff),
        description: text(
          metadata.rules,
          "Immutable conditional stock market with manual resolution.",
        ),
        eventImpact: yesMid !== null && noMid !== null ? yesMid - noMid : null,
        id,
        lifecycle: lifecycle(market.state),
        mapping: {
          conditionId: text(market.polymarketConditionId),
          noIndex: text(market.polymarketNoIndex),
          polymarketUrl: text(metadata.canonicalUrl, "https://polymarket.com"),
          yesIndex: text(market.polymarketYesIndex),
        },
        no,
        ordinaryReference: null,
        probability: {
          ask: number(probability.bestAskX6) === null ? null : Number(probability.bestAskX6) / 1e6,
          bid: number(probability.bestBidX6) === null ? null : Number(probability.bestBidX6) / 1e6,
          observedAt: probability.observedAtMs
            ? new Date(Number(probability.observedAtMs)).toISOString()
            : null,
          quality: text(
            probability.quality,
            "disconnected",
          ) as MarketView["probability"]["quality"],
          value: midpoint === null ? null : midpoint / 1e6,
        },
        question: text(metadata.question, `Conditional market ${id.slice(0, 8)}`),
        quoteToken: text(market.quoteToken),
        residual: null,
        sourceMode: "live",
        ticker: text(record(metadata.asset).symbol, "STOCK"),
        tradingOpen: isoSeconds(market.tradingOpen),
        yes,
      };
    }),
  );
}

export const serverApi = {
  markets: async (): Promise<MarketView[]> => {
    try {
      const markets = await liveMarkets();
      return markets;
    } catch {
      return [];
    }
  },
  market: async (marketId: string): Promise<MarketView | null> =>
    (await serverApi.markets()).find((market) => market.id === marketId) ?? null,
  positions: async (account: string): Promise<PositionView[]> => {
    try {
      return (
        await json<{ positions: PositionView[] }>(
          `${protocolConfig.indexerUrl}/positions/${account}`,
        )
      ).positions;
    } catch {
      return [];
    }
  },
  orders: async (account: string): Promise<IndexedOrder[]> => {
    try {
      return (
        await json<{ orders: IndexedOrder[] }>(
          `${protocolConfig.indexerUrl}/orders?maker=${account}`,
        )
      ).orders;
    } catch {
      return [];
    }
  },
  trades: async (marketId?: string): Promise<TradeView[]> => {
    try {
      return (
        await json<{ trades: TradeView[] }>(
          `${protocolConfig.indexerUrl}/trades?limit=100${marketId ? `&marketId=${marketId}` : ""}`,
        )
      ).trades;
    } catch {
      return [];
    }
  },
  resolution: async (marketId: string): Promise<ResolutionView | null> => {
    try {
      return await json<ResolutionView>(`${protocolConfig.indexerUrl}/resolutions/${marketId}`);
    } catch {
      return null;
    }
  },
};
