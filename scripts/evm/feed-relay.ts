/** Local only: keeps the Δ-vault's mock Chainlink feed at the API's reference price of the
 * vault's stock, as a real feed would, so the vault's price band follows the market. It signs
 * with its own development key, never the admin's, whose transactions it would race.
 *
 *   bun --env-file=.local/anvil.env scripts/evm/feed-relay.ts */
import { deltaVaultAbi } from "@conditional-stocks/evm-client";
import { createPublicClient, createWalletClient, type Hex, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required: run with --env-file=.local/anvil.env`);
  return value;
};
const rpc = required("RPC_URL"),
  api = required("API_URL"),
  feed = required("DELTA_VAULT_FEED") as `0x${string}`,
  vault = required("DELTA_VAULT_ADDRESSES").split(",")[0] as `0x${string}`;
const chain = { ...foundry, rpcUrls: { default: { http: [rpc] } } };
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== foundry.id)
  throw new Error("The feed relay runs on anvil only");
const wallet = createWalletClient({
  account: privateKeyToAccount(required("FEED_RELAY_PRIVATE_KEY") as Hex),
  chain,
  transport: http(rpc),
});
const feedAbi = parseAbi([
  "function set(int256 answer, uint256 startedAt, uint256 updatedAt)",
  "function answer() view returns (int256)",
]);
const [quote, base] = await Promise.all([
  client.readContract({ address: vault, abi: deltaVaultAbi, functionName: "QUOTE" }),
  client.readContract({ address: vault, abi: deltaVaultAbi, functionName: "BASE" }),
]);

let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopped = true));
while (!stopped) {
  try {
    const response = await fetch(`${api}/v1/spot-prices?tokens=${quote},${base}`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json()) as { prices?: { priceUsd?: number | null }[] };
    const usd = body.prices?.[1]?.priceUsd;
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
      const answer = BigInt(Math.round(usd * 1e8));
      const now = (await client.getBlock()).timestamp;
      const hash = await wallet.writeContract({
        address: feed,
        abi: feedAbi,
        functionName: "set",
        args: [answer, now, now],
      });
      await client.waitForTransactionReceipt({ hash });
    }
  } catch {
    // Reference prices may be briefly unavailable; try again shortly.
  }
  await Bun.sleep(15_000);
}
