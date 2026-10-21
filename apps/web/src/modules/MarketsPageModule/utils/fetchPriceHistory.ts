import { getPriceHistory, type PriceHistoryRange } from "@/services/price-history";
import { priceHistoryStore } from "@/stores/usePriceHistoryStore";
import { fetchResource } from "@/utils/fetchResource";
export const fetchPriceHistory = (marketId: string, range: PriceHistoryRange, force = false) =>
  fetchResource(
    priceHistoryStore,
    `${marketId}:${range}`,
    (signal) => getPriceHistory(marketId, range, signal),
    force,
  );
