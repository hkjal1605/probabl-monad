import { getAddress } from "viem";

/** The deployment this console administers. On-chain roles, never these settings, authorize. */
export const adminConfig = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Anvil",
  exchange: getAddress(
    process.env.NEXT_PUBLIC_EXCHANGE_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  ),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "",
  polygonConditionalTokens: process.env.NEXT_PUBLIC_POLYGON_CONDITIONAL_TOKENS_ADDRESS ?? "",
} as const;
