/** Tops up the referral payout wallet from a treasury wallet by exactly what it is short: the
 * rewards owed (unlocking or unlocked, not yet paid) less what it holds, per token, as the API's
 * admin overview reports them. A dry run unless `--execute`.
 *
 *   bun --env-file=.local/anvil.env scripts/evm/fund-referrals.ts [--execute]
 *
 * The overview needs the market admin's sign-in (INVITE_ADMIN_PRIVATE_KEY, or SEED_ADMIN_PRIVATE_KEY
 * locally); the tokens come from REFERRAL_FUNDER_PRIVATE_KEY (the treasury; locally the seed
 * admin). Collecting protocol fees into the treasury is a separate step. */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  type Hex,
  http,
  isHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const execute = process.argv.includes("--execute");
const keyOf = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      if (!isHex(value) || value.length !== 66) throw new Error(`${name} is not a private key`);
      return value as Hex;
    }
  }
  throw new Error(`Set ${names.join(" or ")}`);
};
const admin = privateKeyToAccount(keyOf("INVITE_ADMIN_PRIVATE_KEY", "SEED_ADMIN_PRIVATE_KEY"));
const funder = privateKeyToAccount(keyOf("REFERRAL_FUNDER_PRIVATE_KEY", "SEED_ADMIN_PRIVATE_KEY"));
const api = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const origin = (process.env.API_AUTH_ORIGINS ?? "").split(",")[0]?.trim();
const rpc = process.env.RPC_URL;
const chainId = Number(process.env.CHAIN_ID);
if (!origin || !rpc || !Number.isInteger(chainId))
  throw new Error("Set API_AUTH_ORIGINS, RPC_URL and CHAIN_ID");
const chain = defineChain({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account: funder, chain, transport: http(rpc) });

async function call<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`${path}: ${json.error?.message ?? response.status}`);
  return json;
}

const { challengeId, message } = await call<{ challengeId: string; message: string }>(
  "/v1/auth/challenge",
  { address: admin.address, origin },
);
const { token } = await call<{ token: string }>("/v1/auth/verify", {
  address: admin.address,
  challengeId,
  signature: await admin.signMessage({ message }),
});
const overview = await call<{
  payoutWallet: string | null;
  gas: string | null;
  tokens: { token: string; symbol: string | null; decimals: number | null; shortfall: string }[];
}>("/v1/admin/referrals", undefined, token);
await call("/v1/auth/logout", {}, token);
if (!overview.payoutWallet) throw new Error("The API has no referral payout wallet configured");
const payout = getAddress(overview.payoutWallet);
if (payout === funder.address) throw new Error("The funder must not be the payout wallet");

console.info(`Payout wallet ${payout} · gas ${formatUnits(BigInt(overview.gas ?? "0"), 18)} ETH`);
const due = overview.tokens.filter((t) => BigInt(t.shortfall) > 0n);
if (!due.length) console.info("Nothing is short: every owed reward is covered.");
for (const t of due) {
  const amount = BigInt(t.shortfall),
    symbol = t.symbol ?? t.token;
  const held = await client.readContract({
    address: getAddress(t.token),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [funder.address],
  });
  const shown = t.decimals === null ? `${amount} (raw)` : formatUnits(amount, t.decimals);
  if (held < amount) {
    console.warn(`${symbol}: short ${shown}, but the funder holds less. Skipped.`);
    continue;
  }
  if (!execute) {
    console.info(`${symbol}: would send ${shown} to the payout wallet`);
    continue;
  }
  const hash = await wallet.sendTransaction({
    to: getAddress(t.token),
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payout, amount] }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${symbol} transfer reverted (${hash})`);
  console.info(`${symbol}: sent ${shown} (${hash})`);
}
if (!execute && due.length) console.info("Dry run. Pass --execute to send.");
