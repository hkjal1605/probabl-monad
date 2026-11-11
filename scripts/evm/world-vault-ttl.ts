/** Sets how long a world vault's quotes may live (`Limits.maxTtl`, seconds), leaving its other
 * limits as they are on chain. A quote on an open request lives minutes while its taker chooses
 * (the keeper's `quotes.openTtlSeconds`), and the vault refuses a fill whose quote outlives
 * `maxTtl`, so the keeper never signs a longer one.
 *
 * The curator signs it: the payload is printed, or on a testnet `--apply` sends it with
 * CURATOR_PRIVATE_KEY.
 *
 *   CHAIN_ID=46630 RPC_URL=… WORLD_VAULT=0x… [CURATOR_PRIVATE_KEY=…]
 *   bun scripts/evm/world-vault-ttl.ts <seconds> [--apply] [--mainnet] */
import {
  WORLD_VAULT_ROLES,
  type WorldVaultLimits,
  worldVaultAbi,
  worldVaultCalls,
} from "@conditional-stocks/evm-client";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MAINNETS = new Set([8453, 4663]);
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
if (MAINNETS.has(chainId) && !process.argv.includes("--mainnet"))
  throw new Error("This chain is a mainnet: pass --mainnet explicitly");
const apply = process.argv.includes("--apply");
if (apply && MAINNETS.has(chainId))
  throw new Error("--apply is for testnets: sign a mainnet change separately");
const maxTtl = Number(process.argv.slice(2).find((a) => /^[0-9]+$/.test(a)));
// The contract's own bound is a day; a quote that lives longer than an hour is a mistake.
if (!Number.isInteger(maxTtl) || maxTtl < 5 || maxTtl > 3_600)
  throw new Error("Give the longest quote lifetime in seconds, from 5 to 3600");

const rpc = required("RPC_URL");
const chain = defineChain({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== chainId) throw new Error("RPC serves a different chain");
const vault = getAddress(required("WORLD_VAULT"));
const read = { address: vault, abi: worldVaultAbi } as const;
const current = (await client.readContract({
  ...read,
  functionName: "limits",
})) as WorldVaultLimits;
if (Number(current.maxTtl) === maxTtl) {
  console.info(`The vault's quotes already live at most ${maxTtl} seconds.`);
  process.exit(0);
}
const limits: WorldVaultLimits = {
  maxTtl,
  cutoffBuffer: Number(current.cutoffBuffer),
  maxTenor: Number(current.maxTenor),
  maxLegs: Number(current.maxLegs),
  maxFeeBps: Number(current.maxFeeBps),
  marginBps: Number(current.marginBps),
  eventOnly: current.eventOnly,
};
const call = worldVaultCalls(vault).setLimits(limits);
console.info(`maxTtl ${Number(current.maxTtl)} → ${maxTtl} seconds on ${vault}`);
if (!apply) {
  console.info("From a curator of the vault:");
  console.info(JSON.stringify({ chainId, ...call }, null, 2));
  process.exit(0);
}
const account = privateKeyToAccount(required("CURATOR_PRIVATE_KEY") as Hex);
const curator = await client.readContract({
  ...read,
  functionName: "hasRole",
  args: [WORLD_VAULT_ROLES.curator, account.address],
});
if (!curator) throw new Error("CURATOR_PRIVATE_KEY is not a curator of this vault");
await client.call({ account: account.address, to: call.to, data: call.data });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const hash = await wallet.sendTransaction({ to: call.to, data: call.data, chain } as never);
const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`setLimits reverted (${hash})`);
const after = (await client.readContract({ ...read, functionName: "limits" })) as WorldVaultLimits;
console.info(
  `Applied in ${hash}: the vault's quotes live at most ${Number(after.maxTtl)} seconds.`,
);
