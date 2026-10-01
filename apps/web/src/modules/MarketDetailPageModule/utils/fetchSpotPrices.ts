import { SPOT_BATCH_SIZE, type SpotPricesResponse } from "@conditional-stocks/shared/spot-prices";
import { protocolConfig } from "@/config/protocol";
import { API_URL } from "@/services/constants";
import { fetchSpotPrices as readPrices } from "@/services/spot-prices";
import { spotPricesStore } from "@/stores/useSpotPricesStore";
import { fetchResource } from "@/utils/fetchResource";

export const fetchSpotPrices = (key: string, force = false) =>
  fetchResource(
    spotPricesStore,
    key,
    async (signal): Promise<SpotPricesResponse> => {
      const tokens = key.split(","),
        tasks = [];
      // Give the shared SSE subscription its first image before falling back to HTTP.
      if (!force && tokens.length <= SPOT_BATCH_SIZE && typeof EventSource !== "undefined") {
        const revision = spotPricesStore.get(key).revision;
        const receivedImage = () =>
          spotPricesStore.get(key).revision !== revision &&
          spotPricesStore.get(key).data !== undefined;
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            unsubscribe();
            signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 1500);
          const unsubscribe = spotPricesStore.store.subscribe(() => {
            if (receivedImage()) finish();
          });
          signal.addEventListener("abort", finish, { once: true });
          if (signal.aborted || receivedImage()) finish();
        });
        signal.throwIfAborted();
        const streamed = spotPricesStore.get(key).data;
        if (receivedImage() && streamed) return streamed;
      }
      for (let i = 0; i < tokens.length; i += SPOT_BATCH_SIZE)
        tasks.push(
          readPrices(protocolConfig.chainId, tokens.slice(i, i + SPOT_BATCH_SIZE), {
            base: API_URL,
            signal,
          }),
        );
      const batches = await Promise.all(tasks);
      return {
        source: "robinhood",
        displayOnly: true,
        chainId: protocolConfig.chainId,
        asOf: Math.max(...batches.map((b) => b.asOf)),
        prices: batches.flatMap((b) => b.prices),
      };
    },
    force,
  );
