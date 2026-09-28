import { getAddress } from "viem";

/** The deployment this build trades against. The wallet must be on `chainId`. */
export const protocolConfig = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Anvil",
  exchange: getAddress(
    process.env.NEXT_PUBLIC_EXCHANGE_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  ),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "",
} as const;
