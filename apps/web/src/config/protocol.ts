import { getAddress } from "viem";

export interface Deployment {
  chainId: number;
  chainName: string;
  exchange: `0x${string}`;
  rpcUrl: string;
  explorerUrl: string;
}

/** Deployments this build trades against: today one, from the NEXT_PUBLIC_* settings. Every
 * market names its deployment through its venue; wallet sessions are per deployment. */
export const deployments: readonly Deployment[] = [
  {
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
    chainName: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Anvil",
    exchange: getAddress(
      process.env.NEXT_PUBLIC_EXCHANGE_ADDRESS ?? "0x0000000000000000000000000000000000000000",
    ),
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545",
    explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "",
  },
];

/** The wallet's deployment: funding, trading permissions, the faucet and sign-in use it. */
export const protocolConfig = deployments[0]!;

/** Δ-vaults of the wallet's deployment this build lets users deposit into. Pinned at build
 * time like the exchange: the API describes vaults but never chooses where funds go. */
export const deltaVaults: readonly `0x${string}`[] = (process.env.NEXT_PUBLIC_DELTA_VAULTS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => getAddress(value));

/** The deployment a venue's transactions go to. */
export function venueDeployment(venue: { chainId: number; exchange: string }): Deployment {
  const deployment = deployments.find(
    (d) => d.chainId === venue.chainId && d.exchange.toLowerCase() === venue.exchange.toLowerCase(),
  );
  if (!deployment)
    throw new Error("This market trades on a deployment this app is not set up for.");
  return deployment;
}

/** Block explorer of a venue's deployment ("" when none is configured); safe while rendering. */
export const explorerFor = (venue: { chainId: number } | undefined) =>
  deployments.find((d) => d.chainId === venue?.chainId)?.explorerUrl ?? "";
