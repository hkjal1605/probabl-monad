import { getPriceHistory } from "@/services/price-history";
import { priceHistoryStore } from "@/stores/usePriceHistoryStore";
import { fetchResource } from "@/utils/fetchResource";
export const fetchPriceHistory = (marketId: string, force = false) =>
  fetchResource(priceHistoryStore, marketId, (signal) => getPriceHistory(marketId, signal), force);
