import { protocolConfig } from "@/config/protocol";
import type { PayoutCreditView } from "@/types/api";
import { requestJson } from "./api";
import { parseStreamWallet } from "./index-stream";
export interface PayoutPage {
  vault: string;
  payouts: PayoutCreditView[];
  nextCursor: string | null;
}
export const getPositions = async (owner: string, signal: AbortSignal) =>
  parseStreamWallet(
    await requestJson<unknown>(`/positions/${encodeURIComponent(owner)}`, { signal, auth: true }),
    owner,
  );
export async function getPayouts(owner: string, signal: AbortSignal) {
  const page = await requestJson<PayoutPage>(`/payouts/${encodeURIComponent(owner)}`, {
    signal,
    auth: true,
  });
  if (page.vault.toLowerCase() !== protocolConfig.exchange.toLowerCase())
    throw new Error("Payout vault configuration does not match the indexer");
  if (page.nextCursor) throw new Error("Unexpected pagination from the indexer");
  return page;
}
