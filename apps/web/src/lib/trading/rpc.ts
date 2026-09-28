import { createPublicClient, defineChain, type Hex, http, type PublicClient } from "viem";
import { protocolConfig } from "@/config/protocol";

let client: PublicClient | undefined;
/** Reads from the deployment's own RPC (receipts, token balances), never the wallet's. */
export const publicClient = (): PublicClient =>
  (client ??= createPublicClient({
    chain: defineChain({
      id: protocolConfig.chainId,
      name: protocolConfig.chainName,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [protocolConfig.rpcUrl] } },
    }),
    transport: http(protocolConfig.rpcUrl, { batch: true }),
  }));

export async function transactionReceipt(hash: string) {
  const receipt = await publicClient()
    .getTransactionReceipt({ hash: hash as Hex })
    .catch(() => null);
  if (!receipt) throw new Error("Transaction is not confirmed yet.");
  return { status: receipt.status, blockNumber: receipt.blockNumber };
}
