"use client";
import { useEffect, useReducer } from "react";
import { apiUrl } from "@/services/constants";
import { parseQuotePrices, QUOTE_PRICES_PATH, readQuotePrices } from "@/services/quote-prices";
import { subscribePrices } from "@/services/spot-stream";
import { quotePricesStore } from "@/stores/useQuotePricesStore";
import { fetchResource } from "@/utils/fetchResource";
import { useResource } from "./useResource";

const KEY = "all";
const fetchQuotePrices = (force = false) =>
  fetchResource(quotePricesStore, KEY, (signal) => readQuotePrices(signal), force);

/** The RFQ makers' current prices, live from the API's stream (read over HTTP while it is down).
 * `fresh`: the copy is younger than the API keeps prices. */
export function useQuotePrices() {
  const query = useResource(quotePricesStore, KEY, fetchQuotePrices);
  useEffect(
    () =>
      subscribePrices(
        apiUrl(`${QUOTE_PRICES_PATH}/stream`),
        (value) => {
          try {
            quotePricesStore.setData(KEY, parseQuotePrices(value));
            quotePricesStore.patch(KEY, { streamUntil: Date.now() + 30_000 });
          } catch {
            quotePricesStore.patch(KEY, { streamUntil: 0 });
          }
        },
        () => quotePricesStore.patch(KEY, { streamUntil: 0 }),
      ),
    [],
  );
  // Fresh until the API's ttl after this copy arrived: one timer at that moment.
  const freshUntil = query.data ? query.dataUpdatedAt + query.data.ttlMs : 0;
  const [, expired] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const left = freshUntil - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(expired, left + 1);
    return () => clearTimeout(timer);
  }, [freshUntil]);
  return { ...query, fresh: Date.now() <= freshUntil };
}
