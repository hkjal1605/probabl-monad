import { type Client, createClient, defineChain, type Hex, http } from "viem";
import { getTransactionReceipt, waitForTransactionReceipt } from "viem/actions";
import { protocolConfig } from "@/config/protocol";

let client: Client | undefined;
/** The deployment's own RPC (receipts, token balances), never the wallet's. A bare client used
 * with viem's standalone actions (`readContract(rpc(), …)`), which keeps the rest of viem's public
 * client (ENS, signatures, simulation, filters) out of the bundle. */
export const rpc = (): Client =>
  (client ??= createClient({
    chain: defineChain({
      id: protocolConfig.chainId,
      name: protocolConfig.chainName,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [protocolConfig.rpcUrl] } },
    }),
    transport: http(protocolConfig.rpcUrl, { batch: true }),
  }));

/** Waits (up to 3 minutes) for a transaction's receipt on the deployment's RPC. */
export const waitForReceipt = (hash: Hex) =>
  waitForTransactionReceipt(rpc(), { hash, timeout: 180_000 });

export async function transactionReceipt(hash: string) {
  const receipt = await getTransactionReceipt(rpc(), { hash: hash as Hex }).catch(() => null);
  if (!receipt) throw new Error("Transaction is not confirmed yet.");
  return { status: receipt.status, blockNumber: receipt.blockNumber };
}
