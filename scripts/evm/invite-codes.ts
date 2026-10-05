/** Issues launch invite codes as the market admin (codes with no referrer), through the API.
 *
 *   bun --env-file=.local/anvil.env scripts/evm/invite-codes.ts [count] [wallets-per-code] [note]
 *
 * The signing key is SEED_ADMIN_PRIVATE_KEY locally, or INVITE_ADMIN_PRIVATE_KEY (the market
 * admin's key) on a live deployment. Codes print one per line, as XXXX-XXXX. */
import { type Hex, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const key = (process.env.INVITE_ADMIN_PRIVATE_KEY ?? process.env.SEED_ADMIN_PRIVATE_KEY)?.trim();
if (!key || !isHex(key) || key.length !== 66)
  throw new Error(
    "Set INVITE_ADMIN_PRIVATE_KEY (or SEED_ADMIN_PRIVATE_KEY) to the market admin key",
  );
const api = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const origin = (process.env.API_AUTH_ORIGINS ?? "").split(",")[0]?.trim();
if (!origin) throw new Error("Set API_AUTH_ORIGINS: sign-in names an allowed app origin");
const [count = "5", maxUses = "1", note = "launch"] = process.argv.slice(2);
const admin = privateKeyToAccount(key as Hex);

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
const { codes } = await call<{ codes: string[] }>(
  "/v1/admin/invites",
  { count: Number(count), maxUses: Number(maxUses), note },
  token,
);
// Codes only: the session ends with this process (the token is never printed).
await call("/v1/auth/logout", {}, token);
console.info(codes.join("\n"));
