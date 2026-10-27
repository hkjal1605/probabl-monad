"use client";
import {
  isEvmAddress,
  SPOT_BATCH_SIZE,
  SPOT_MAX_CACHE_AGE_SECONDS,
  type SpotPricesResponse,
  spotMaxAgeSeconds,
} from "@conditional-stocks/shared/spot-prices";
import { useEffect, useReducer } from "react";
import { protocolConfig } from "@/config/protocol";
import { fetchSpotPrices } from "@/modules/MarketDetailPageModule/utils/fetchSpotPrices";
import { API_URL } from "@/services/constants";
import { parseSpotPricesResponse, spotPricesUrl } from "@/services/spot-prices";
import { subscribePrices } from "@/services/spot-stream";
import { spotPricesStore } from "@/stores/useSpotPricesStore";
import type { MarketView } from "@/types/api";
import { useResource } from "./useResource";

/** When the next of these prices expires (`expireSpotPrice`), ms; null if none will. */
function nextExpiry(data: SpotPricesResponse | undefined, now: number): number | null {
  let next: number | null = null;
  for (const price of data?.prices ?? []) {
    if (price.status !== "available" || price.fetchedAt === null || price.priceTimestamp === null)
      continue;
    for (const at of [
      (price.fetchedAt + SPOT_MAX_CACHE_AGE_SECONDS) * 1000,
      (price.priceTimestamp + spotMaxAgeSeconds(price)) * 1000,
    ])
      if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/** The markets' spot prices, live from the API's stream. `epoch` changes when one of them expires
 * (one timer at that moment, not a clock), so consumers re-derive only then or on new data. */
export function useSpotPrices(markets: MarketView[]) {
  const tokens = [...new Set(markets.flatMap((m) => [m.base.token, m.quoteToken]))]
    .filter(isEvmAddress)
    .sort();
  const key = tokens.join(",");
  const query = useResource(spotPricesStore, key, (force) => fetchSpotPrices(key, force), !!key);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the sorted token list itself.
  useEffect(() => {
    if (!key || tokens.length > SPOT_BATCH_SIZE) return;
    const url = new URL(spotPricesUrl(tokens, API_URL));
    url.pathname += "/stream";
    return subscribePrices(
      url.toString(),
      (value) => {
        try {
          const data = parseSpotPricesResponse(value, protocolConfig.chainId, tokens);
          spotPricesStore.setData(key, data);
          spotPricesStore.patch(key, { streamUntil: Date.now() + 30_000 });
        } catch {
          spotPricesStore.patch(key, { streamUntil: 0 });
        }
      },
      () => spotPricesStore.patch(key, { streamUntil: 0 }),
    );
  }, [key]);
  const [epoch, expired] = useReducer((n: number) => n + 1, 0);
  const expiry = nextExpiry(query.data, Date.now());
  useEffect(() => {
    if (expiry === null) return;
    const timer = setTimeout(expired, Math.max(0, expiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [expiry]);
  return { ...query, epoch };
}
