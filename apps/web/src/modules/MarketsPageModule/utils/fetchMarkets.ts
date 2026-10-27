import { retainBookDisplays } from "@/lib/markets/refresh";
import { type MarketsReadReport, marketsApi } from "@/services/markets-api-service";
import { marketsStore } from "@/stores/useMarketsStore";
import { fetchResource } from "@/utils/fetchResource";

/** A read that could not get some markets' events is repeated this long after, once. */
const EVENT_RETRY_MS = 20_000;
const retries = new Map<string, ReturnType<typeof setTimeout>>();

export const fetchMarkets = (key: string, force = false) =>
  fetchResource(
    marketsStore,
    key,
    async (signal) => {
      const report: MarketsReadReport = { eventsFailed: false };
      const markets = await marketsApi.liveMarkets(key === "all" ? undefined : key, signal, report);
      if (report.eventsFailed && !retries.has(key))
        retries.set(
          key,
          setTimeout(() => {
            retries.delete(key);
            void fetchMarkets(key, true);
          }, EVENT_RETRY_MS),
        );
      // A market page's first read keeps what the market list already shows of it.
      return retainBookDisplays(marketsStore.get(key).data ?? marketsStore.get("all").data, {
        markets,
      });
    },
    force,
  );
