import type { TradeView } from "@/types/api";
import createBoundedUseStore from "./createBoundedUseStore";
import { createResourceStore } from "./createResourceStore";
/** Trades of one wallet (as maker or taker), keyed by the wallet address. */
export const walletTradesStore = createResourceStore<{ trades: TradeView[] }>("wallet-trades");
const useWalletTradesStore = createBoundedUseStore(walletTradesStore.store);
export default useWalletTradesStore;
