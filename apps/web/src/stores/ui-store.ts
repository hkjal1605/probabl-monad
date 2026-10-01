import { createStore } from "zustand/vanilla";
import type { MarketCategory } from "@/lib/markets/presentation";

export type DiscoveryFilters = {
  category: MarketCategory;
  lifecycle: "active" | "resolving" | "all";
  sort: "newest" | "oldest";
  view: "Feed" | "Columns" | "Matrix";
};
/** A trade another page hands the market's order ticket: data only, never signed or submitted. */
export type OrderPrefill =
  | {
      /** Sell held claims. */
      intent: "close";
      marketId: string;
      branch: "YES" | "NO";
      /** Base token quantity. */
      quantity: string;
      nonce: number;
    }
  | {
      /** Buy the branch's stock, the amount left to the trader. */
      intent: "buy";
      marketId: string;
      branch: "YES" | "NO";
      nonce: number;
    };
export const defaultFilters: DiscoveryFilters = {
  category: "All",
  lifecycle: "active",
  sort: "newest",
  view: "Feed",
};

export function createUiStore() {
  return createStore<{
    filters: DiscoveryFilters;
    setFilters: (patch: Partial<DiscoveryFilters>) => void;
    prefill: OrderPrefill | null;
    setPrefill: (prefill: OrderPrefill | null) => void;
  }>()((set) => ({
    filters: { ...defaultFilters },
    setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
    prefill: null,
    setPrefill: (prefill) => set({ prefill }),
  }));
}
