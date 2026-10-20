/** Approves every Δ-vault of deployments/<chainId>-vault-plan.json as an RFQ maker (docs/rfq.md),
 * signing in to the API as the market admin, and writes each vault's API key to RFQ_KEYS_PATH
 * (mode 600): a JSON map of vault to key, plus VK_RFQ_API_KEYS in plan order for the keeper. The
 * API shows a key only once, so a vault approved earlier whose key the file lacks is revoked and
 * approved again. Resumable; run it where the keeper runs, as the keys must not travel.
 *
 *   MARKET_ADMIN_PRIVATE_KEY=… CHAIN_ID=46630 [AUTOMATION_API_URL=http://127.0.0.1:3000]
 *   [AUTOMATION_AUTH_ORIGIN=http://localhost:3002] [RFQ_KEYS_PATH=.local/vault-keeper/rfq-keys.json]
 *   bun scripts/evm/approve-rfq-makers.ts */
import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { type Address, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const root = resolve(import.meta.dir, "../..");
const chainId = Number(required("CHAIN_ID"));
const plan = (await Bun.file(resolve(root, `deployments/${chainId}-vault-plan.json`)).json()) as {
  vaults: { symbol: string; vault?: Address }[];
};
const api = (process.env.AUTOMATION_API_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
const origin = process.env.AUTOMATION_AUTH_ORIGIN?.trim() || "http://localhost:3002";
const keysPath = resolve(
  root,
  process.env.RFQ_KEYS_PATH?.trim() || ".local/vault-keeper/rfq-keys.json",
);
const admin = privateKeyToAccount(required("MARKET_ADMIN_PRIVATE_KEY") as Hex);

async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: unknown };
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(json.error ?? response.status)}`);
  return json;
}

const { challengeId, message } = await request<{ challengeId: string; message: string }>(
  "/v1/auth/challenge",
  { address: admin.address, origin },
);
const { token } = await request<{ token: string }>("/v1/auth/verify", {
  address: admin.address,
  challengeId,
  signature: await admin.signMessage({ message }),
});

const keys = (await Bun.file(keysPath)
  .json()
  .catch(() => ({}))) as Record<string, string>;
const save = async () => {
  const ordered = plan.vaults.flatMap((v) => (v.vault && keys[v.vault] ? [keys[v.vault]] : []));
  await Bun.write(keysPath, `${JSON.stringify(keys, null, 2)}\n`);
  await Bun.write(keysPath.replace(/\.json$/, ".env"), `VK_RFQ_API_KEYS=${ordered.join(",")}\n`);
  await Promise.all([chmod(keysPath, 0o600), chmod(keysPath.replace(/\.json$/, ".env"), 0o600)]);
};
const { makers } = await request<{
  makers: { id: string; wallet: Address; status: string }[];
}>("/v1/admin/rfq/makers", undefined, token);

let approved = 0;
for (const v of plan.vaults) {
  if (!v.vault) throw new Error(`${v.symbol} has no deployed vault yet`);
  const vault = getAddress(v.vault);
  if (keys[vault]) continue;
  for (const m of makers)
    if (getAddress(m.wallet) === vault && m.status === "active")
      await request(`/v1/admin/rfq/makers/${m.id}/revoke`, {}, token);
  const { apiKey } = await request<{ apiKey: string }>(
    "/v1/admin/rfq/makers",
    { label: `Δ-vault ${v.symbol}`, wallet: vault },
    token,
  );
  keys[vault] = apiKey;
  approved++;
  await save();
}
await save();
console.info(
  `${approved} vault(s) approved; ${Object.keys(keys).length} keys in ${keysPath} and VK_RFQ_API_KEYS in ${keysPath.replace(/\.json$/, ".env")}`,
);
