import type { PriceHistory } from "@/services/price-history";
import { createResourceStore } from "./createResourceStore";
export const priceHistoryStore = createResourceStore<PriceHistory>("price-history");
