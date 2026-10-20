import type { QuotePrices } from "@/services/quote-prices";
import createBoundedUseStore from "./createBoundedUseStore";
import { createResourceStore } from "./createResourceStore";

export const quotePricesStore = createResourceStore<QuotePrices>("quote-prices");
const useQuotePricesStore = createBoundedUseStore(quotePricesStore.store);
export default useQuotePricesStore;
