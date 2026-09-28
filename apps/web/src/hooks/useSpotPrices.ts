"use client";
import { isEvmAddress, SPOT_BATCH_SIZE } from "@conditional-stocks/shared/spot-prices";
import { useEffect, useState } from "react";
import { protocolConfig } from "@/config/protocol";
import { fetchSpotPrices } from "@/modules/MarketDetailPageModule/utils/fetchSpotPrices";
import { API_URL } from "@/services/constants";
import { parseSpotPricesResponse, spotPricesUrl } from "@/services/spot-prices";
import { subscribeSpot } from "@/services/spot-stream";
import { spotPricesStore } from "@/stores/useSpotPricesStore";
import type { MarketView } from "@/types/api";
import { useResource } from "./useResource";

export function useSpotPrices(markets: MarketView[]) {
  const tokens = [...new Set(markets.flatMap((m) => [m.base.token, m.quoteToken]))]
    .filter(isEvmAddress)
    .sort();
  const key = tokens.join(",");
  const query = useResource(spotPricesStore, key, (force) => fetchSpotPrices(key, force), !!key);
  const [now, setNow] = useState(Date.now);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the sorted token list itself.
  useEffect(() => {
    if (!key || tokens.length > SPOT_BATCH_SIZE) return;
    const url = new URL(spotPricesUrl(tokens, API_URL));
    url.pathname += "/stream";
    return subscribeSpot(
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
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return { ...query, now };
}
