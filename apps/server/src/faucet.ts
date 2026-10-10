/** Testnet asset faucet. A dedicated, separately funded wallet (never the deployer or a
 * governance key) sends every signed-in wallet a small, fixed amount of gas and of each listed
 * token exactly once. Claims are serialized, resumable per asset, and rate limited. */
import type { Database } from "@conditional-stocks/db";
import type { IndexerService } from "@conditional-stocks/indexer";
import { nativeCurrency, TESTNET_CHAIN_IDS } from "@conditional-stocks/shared/chains";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  type PublicClient,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Auth } from "./auth/routes.ts";

/** Anvil, Robinhood Chain testnet, Base Sepolia and Monad testnet. */
export const FAUCET_CHAINS: readonly number[] = TESTNET_CHAIN_IDS;
/** Whole units per claim by symbol, as on the Solana testnet; other listed tokens (stocks) send
 * one token. ETH is gas where it is the native currency and an asset on Monad; MON pays for
 * about ten Monad transactions, where gas is charged on the limit. */
const AMOUNTS: Readonly<Record<string, string>> = {
  ETH: "0.002",
  MON: "0.2",
  USDC: "500",
  USDG: "500",
  SPY: "0.5",
  OPENAI: "0.5",
  SPACEX: "5",
  KALSHI: "0.5",
  ANTHROPIC: "0.5",
  BTC: "0.005",
  SOL: "1",
};
/** Asset amounts that differ from their native-currency namesake (ETH gas on Ethereum chains). */
const ASSET_AMOUNTS: Readonly<Record<string, string>> = { ETH: "0.1" };
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
    auth: Auth;
  },
) {
  const { client, indexer, db, domain, auth } = options;
  const signer =
    options.secret && FAUCET_CHAINS.includes(options.chainId)
      ? privateKeyToAccount(options.secret.trim() as Hex)
      : null;

  app.get("/v1/faucet/status", async (c) => {
    c.header("Cache-Control", "no-store");
    // Availability is public; whether a wallet claimed is its member's to read.
    const requested = c.req.query("owner");
    const owner = requested ? (await auth.member(c, requested)).owner : null;
    if (!signer) return c.json({ available: false, claimed: false });
    const claim = owner ? await db.faucetClaim(domain, owner) : undefined;
    return c.json({
      available: true,
      claimed: Boolean(claim?.completedAt),
      faucet: signer.address,
    });
  });

  app.post("/v1/faucet/claim", async (c) => {
    const { owner } = await auth.trader(c);
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
        const native = nativeCurrency(options.chainId).symbol;
        const assets: { symbol: string; token: Address | null; amount: bigint }[] = [
          { symbol: native, token: null, amount: parseUnits(AMOUNTS[native] ?? "0", 18) },
          ...[...s.pools.entries()].map(([token, pool]) => {
            const symbol = indexer.tokens.identity.get(token)?.symbol ?? token;
            const amount = ASSET_AMOUNTS[symbol] ?? AMOUNTS[symbol] ?? "1";
            return { symbol, token, amount: parseUnits(amount, pool.decimals) };
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
