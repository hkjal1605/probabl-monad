import { api } from "@/services/protocol-api-service";
import { walletTradesStore } from "@/stores/useWalletTradesStore";
import { fetchResource } from "@/utils/fetchResource";
export const fetchWalletTrades = (key: string, force = false) =>
  fetchResource(walletTradesStore, key, (signal) => api.walletTrades(key, signal), force);
