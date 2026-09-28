/** Testnet asset faucet. A dedicated, separately funded wallet (never the deployer or a
 * governance key) sends every signed-in wallet a small, fixed amount of gas and of each listed
 * token exactly once. Claims are serialized, resumable per asset, and rate limited. */
import type { Database } from "@conditional-stocks/db";
import type { IndexerService } from "@conditional-stocks/indexer";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  type PublicClient,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Authenticate } from "./auth/routes.ts";

/** Anvil, Robinhood Chain testnet and Base Sepolia. */
export const FAUCET_CHAINS: readonly number[] = [31337, 46630, 84532];
/** Whole units per claim by symbol; other listed tokens (stocks) send one token. */
const AMOUNTS: Readonly<Record<string, string>> = { ETH: "0.002", USDC: "500", USDG: "500" };
const HOURLY_CLAIMS = 60;

export function mountFaucet(
  app: Hono,
  options: {
    secret: string | undefined;
    chainId: number;
    client: PublicClient;
    indexer: IndexerService;
    db: Database;
    domain: string;
    authenticate: Authenticate;
  },
) {
  const { client, indexer, db, domain, authenticate } = options;
  const signer =
    options.secret && FAUCET_CHAINS.includes(options.chainId)
      ? privateKeyToAccount(options.secret.trim() as Hex)
      : null;

  app.get("/v1/faucet/status", async (c) => {
    c.header("Cache-Control", "no-store");
    const owner = c.req.query("owner");
    if (!signer) return c.json({ available: false, claimed: false });
    const claim = owner ? await db.faucetClaim(domain, getAddress(owner)) : undefined;
    return c.json({
      available: true,
      claimed: Boolean(claim?.completedAt),
      faucet: signer.address,
    });
  });

  app.post("/v1/faucet/claim", async (c) => {
    const owner = getAddress(await authenticate(c.req.header("authorization")));
    if (!signer) throw new HTTPException(503, { message: "The testnet faucet is not available" });
    if (owner === signer.address)
      throw new HTTPException(400, { message: "The faucet cannot claim from itself" });
    return c.json(
      await db.locked(`faucet:${domain}`, async (queries) => {
        const previous = await queries.faucetClaim(domain, owner);
        if (previous?.completedAt)
          throw new HTTPException(409, {
            message: "Testnet assets were already claimed for this wallet",
          });
        if (!previous && (await queries.faucetClaimsSince(domain, 3600)) >= HOURLY_CLAIMS)
          throw new HTTPException(429, {
            message: "The testnet faucet is busy. Please try again in a few minutes.",
          });
        const s = indexer.trading();
        const assets: { symbol: string; token: Address | null; amount: bigint }[] = [
          { symbol: "ETH", token: null, amount: parseUnits(AMOUNTS.ETH!, 18) },
          ...[...s.pools.entries()].map(([token, pool]) => {
            const symbol = indexer.tokens.identity.get(token)?.symbol ?? token;
            return { symbol, token, amount: parseUnits(AMOUNTS[symbol] ?? "1", pool.decimals) };
          }),
        ].filter((a) => !previous?.delivered.includes(a.symbol));
        const sent: { symbol: string; amount: string }[] = [];
        const unavailable: string[] = [];
        let nonce = await client.getTransactionCount({
          address: signer.address,
          blockTag: "pending",
        });
        const pending: { symbol: string; hash: Hex; amount: bigint }[] = [];
        for (const a of assets) {
          const balance = a.token
            ? await client.readContract({
                address: a.token,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [signer.address],
              })
            : await client.getBalance({ address: signer.address });
          if (balance < a.amount * (a.token ? 1n : 2n)) {
            unavailable.push(a.symbol); // Run dry: skip, never fail everyone else's assets.
            continue;
          }
          const request = await client.prepareTransactionRequest({
            account: signer,
            chain: client.chain,
            nonce: nonce++,
            ...(a.token
              ? {
                  to: a.token,
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "transfer",
                    args: [owner, a.amount],
                  }),
                }
              : { to: owner, value: a.amount }),
          });
          pending.push({
            symbol: a.symbol,
            amount: a.amount,
            hash: await client.sendRawTransaction({
              serializedTransaction: await signer.signTransaction(request as never),
            }),
          });
        }
        for (const p of pending) {
          const receipt = await client.waitForTransactionReceipt({ hash: p.hash, timeout: 60_000 });
          if (receipt.status !== "success") continue;
          await db.recordFaucetDelivery(domain, owner, [p.symbol], p.hash, false);
          sent.push({ symbol: p.symbol, amount: p.amount.toString() });
        }
        if (!sent.length && !previous?.delivered.length)
          throw new HTTPException(503, {
            message: "The testnet faucet is empty. Please try again later.",
          });
        await db.recordFaucetDelivery(domain, owner, [], null, true);
        return { owner, sent, unavailable, transactions: pending.map((p) => p.hash) };
      }),
    );
  });
  return signer?.address ?? null;
}
