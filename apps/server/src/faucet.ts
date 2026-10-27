/** Testnet asset faucet. A dedicated wallet (never the deployer or a governance key) gives every
 * signed-in member a fixed set of test assets exactly once: the quote token, every listed token
 * and the extra `tokens` given (testnet tokens anyone can mint, so the wallet only pays gas), plus
 * gas when `gasEth` is set. Where the chain has Multicall3 one transaction mints every token.
 * Claims are serialized, resumable per asset, and rate limited. */
import type { Database } from "@conditional-stocks/db";
import type { IndexerService } from "@conditional-stocks/indexer";
import { nativeCurrency, TESTNET_CHAIN_IDS } from "@conditional-stocks/shared/chains";
import { SPOT_BATCH_SIZE } from "@conditional-stocks/shared/spot-prices";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  type PublicClient,
  parseAbi,
  parseEventLogs,
  parseUnits,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Auth } from "./auth/routes.ts";
import type { SpotPriceSource } from "./market-data/robinhood.ts";

/** Anvil, Robinhood Chain testnet, Base Sepolia and Monad testnet. */
export const FAUCET_CHAINS: readonly number[] = TESTNET_CHAIN_IDS;
/** Whole quote tokens per claim. */
export const FAUCET_QUOTE_UNITS = 10_000;
/** Dollars of every other token per claim, at its reference price. */
export const FAUCET_ASSET_USD = 1_000;
/** Whole tokens of a token without a reference price. */
const UNPRICED_UNITS = 10;
const HOURLY_CLAIMS = 60;
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const multicallAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);

export interface FaucetToken {
  token: Address;
  symbol: string;
  decimals: number;
}

/** Whole tokens worth `usd` at `priceUsd`, to two significant digits (UNPRICED_UNITS without a
 * price), in base units. */
export function faucetUnits(usd: number, priceUsd: number | null, decimals: number) {
  const units =
    priceUsd && Number.isFinite(priceUsd) && priceUsd > 0
      ? Number((usd / priceUsd).toPrecision(2))
      : UNPRICED_UNITS;
  const amount = parseUnits(units.toFixed(Math.min(decimals, 12)), decimals);
  return amount > 0n ? amount : 1n;
}

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
    prices: SpotPriceSource;
    /** Testnet tokens to give besides the listed ones. */
    tokens?: readonly Address[];
    /** Native gas per claim, in the chain's native currency (MON on Monad; "0" or unset: none). */
    gasEth?: string | undefined;
  },
) {
  const { client, indexer, db, domain, auth, prices } = options;
  const signer =
    options.secret && FAUCET_CHAINS.includes(options.chainId)
      ? privateKeyToAccount(options.secret.trim() as Hex)
      : null;
  const gas = options.gasEth ? parseUnits(options.gasEth, 18) : 0n;
  // Gas is recorded under the native symbol: on Monad "ETH" is a listed token, MON the gas.
  const native = nativeCurrency(options.chainId).symbol;
  const extra = [...new Set((options.tokens ?? []).map((token) => getAddress(token)))];
  /** Symbol and decimals of the extra tokens, read once. */
  let described: Promise<FaucetToken[]> | null = null;
  const describe = () => {
    described ??= Promise.all(
      extra.map(async (token) => {
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
        ]);
        return { token, symbol: symbol.slice(0, 32), decimals };
      }),
    ).catch((error) => {
      described = null;
      throw error;
    });
    return described;
  };
  /** Every token a claim gives, the quote first. */
  const tokens = async (): Promise<FaucetToken[]> => {
    const s = indexer.trading();
    const listed = [...s.pools.entries()].map(([token, pool]) => ({
      token,
      symbol: indexer.tokens.identity.get(token)?.symbol ?? token,
      decimals: pool.decimals,
    }));
    const all = [...listed, ...(await describe())].filter(
      (t, i, list) => list.findIndex((other) => isAddressEqual(other.token, t.token)) === i,
    );
    return all.sort(
      (a, b) =>
        Number(isAddressEqual(b.token, s.quote)) - Number(isAddressEqual(a.token, s.quote)) ||
        a.symbol.localeCompare(b.symbol),
    );
  };
  /** Each token's claim amount: FAUCET_QUOTE_UNITS of the quote, FAUCET_ASSET_USD of others. */
  const amounts = async (list: FaucetToken[]) => {
    const quote = indexer.trading().quote;
    const priced = list.filter((t) => !isAddressEqual(t.token, quote));
    const usd = new Map<string, number | null>();
    // An unavailable price only sizes that token by UNPRICED_UNITS.
    for (let i = 0; i < priced.length; i += SPOT_BATCH_SIZE)
      await prices
        .getPrices(
          priced.slice(i, i + SPOT_BATCH_SIZE).map(({ token, symbol }) => ({ token, symbol })),
        )
        .then((response) => {
          for (const price of response.prices) usd.set(price.token.toLowerCase(), price.priceUsd);
        })
        .catch(() => undefined);
    return list.map((t) => ({
      ...t,
      amount: isAddressEqual(t.token, quote)
        ? parseUnits(String(FAUCET_QUOTE_UNITS), t.decimals)
        : faucetUnits(FAUCET_ASSET_USD, usd.get(t.token.toLowerCase()) ?? null, t.decimals),
    }));
  };
  let multicall: Promise<boolean> | null = null;
  const hasMulticall = () =>
    (multicall ??= client
      .getCode({ address: MULTICALL3 })
      .then((code) => Boolean(code && code !== "0x"))
      .catch(() => {
        multicall = null;
        return false;
      }));

  app.get("/v1/faucet/status", async (c) => {
    c.header("Cache-Control", "no-store");
    // Availability and what a claim gives are public; whether a wallet claimed is its member's
    // to read.
    const requested = c.req.query("owner");
    const owner = requested ? (await auth.member(c, requested)).owner : null;
    if (!signer) return c.json({ available: false, claimed: false });
    const [claim, list] = await Promise.all([
      owner ? db.faucetClaim(domain, owner) : undefined,
      tokens().catch(() => []),
    ]);
    return c.json({
      available: true,
      claimed: Boolean(claim?.completedAt),
      faucet: signer.address,
      tokens: list.map(({ token, symbol }) => ({ token, symbol })),
      quoteUnits: FAUCET_QUOTE_UNITS,
      assetUsd: FAUCET_ASSET_USD,
      gasEth: options.gasEth ?? "0",
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
            message: "Test tokens were already sent to this wallet",
          });
        if (!previous && (await queries.faucetClaimsSince(domain, 3600)) >= HOURLY_CLAIMS)
          throw new HTTPException(429, {
            message: "The testnet faucet is busy. Please try again in a few minutes.",
          });
        const due = (await amounts(await tokens())).filter(
          (t) => !previous?.delivered.includes(t.symbol),
        );
        const sent: { symbol: string; token: Address | null; amount: string; decimals: number }[] =
          [];
        const unavailable: string[] = [];
        const transactions: Hex[] = [];
        let nonce = await client.getTransactionCount({
          address: signer.address,
          blockTag: "pending",
        });
        const send = async (request: { to: Address; data?: Hex; value?: bigint }) => {
          const prepared = await client.prepareTransactionRequest({
            account: signer,
            chain: client.chain,
            nonce: nonce++,
            ...request,
          });
          const hash = await client.sendRawTransaction({
            serializedTransaction: await signer.signTransaction(prepared as never),
          });
          transactions.push(hash);
          return hash;
        };
        const mint = (t: (typeof due)[number]) =>
          encodeFunctionData({ abi: mintAbi, functionName: "mint", args: [owner, t.amount] });
        /** Tokens the receipt shows minted to the owner. */
        const minted = (logs: { address: Address; topics: Hex[]; data: Hex }[]) =>
          new Set(
            parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: logs as never })
              .filter((log) => log.args.from === zeroAddress && isAddressEqual(log.args.to, owner))
              .map((log) => log.address.toLowerCase()),
          );
        const pending: { hash: Hex; tokens: typeof due }[] = [];
        if (gas > 0n && !previous?.delivered.includes(native)) {
          // Run dry: skip gas, never fail the tokens.
          if ((await client.getBalance({ address: signer.address })) < gas * 2n)
            unavailable.push(native);
          else {
            const hash = await send({ to: owner, value: gas });
            const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
            if (receipt.status === "success") {
              await db.recordFaucetDelivery(domain, owner, [native], hash, false);
              sent.push({ symbol: native, token: null, amount: gas.toString(), decimals: 18 });
            } else unavailable.push(native);
          }
        }
        if (due.length && (await hasMulticall()))
          pending.push({
            hash: await send({
              to: MULTICALL3,
              data: encodeFunctionData({
                abi: multicallAbi,
                functionName: "aggregate3",
                // A token that cannot be minted is skipped, not fatal to the rest.
                args: [
                  due.map((t) => ({ target: t.token, allowFailure: true, callData: mint(t) })),
                ],
              }),
            }),
            tokens: due,
          });
        else
          for (const t of due)
            pending.push({ hash: await send({ to: t.token, data: mint(t) }), tokens: [t] });
        for (const p of pending) {
          const receipt = await client.waitForTransactionReceipt({ hash: p.hash, timeout: 60_000 });
          let ok: typeof due = [];
          if (receipt.status === "success" && p.tokens.length === 1) ok = p.tokens;
          else if (receipt.status === "success") {
            // A batch skips tokens that cannot be minted: each counts once its mint shows, as a
            // Transfer from zero or (a token without events) its balance rising in that block.
            const logged = minted(receipt.logs);
            const quiet = p.tokens.filter((t) => !logged.has(t.token.toLowerCase()));
            const balanceAt = (t: (typeof due)[number], blockNumber: bigint) =>
              client
                .readContract({
                  address: t.token,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [owner],
                  blockNumber,
                })
                .catch(() => null);
            const rose = new Set(
              (
                await Promise.all(
                  quiet.map(async (t) => {
                    const [before, after] = await Promise.all([
                      balanceAt(t, receipt.blockNumber - 1n),
                      balanceAt(t, receipt.blockNumber),
                    ]);
                    return before !== null && after !== null && after - before >= t.amount
                      ? t.token
                      : null;
                  }),
                )
              ).filter((token) => token !== null),
            );
            ok = p.tokens.filter((t) => logged.has(t.token.toLowerCase()) || rose.has(t.token));
          }
          for (const t of p.tokens) if (!ok.includes(t)) unavailable.push(t.symbol);
          if (!ok.length) continue;
          await db.recordFaucetDelivery(
            domain,
            owner,
            ok.map((t) => t.symbol),
            p.hash,
            false,
          );
          for (const t of ok)
            sent.push({
              symbol: t.symbol,
              token: t.token,
              amount: t.amount.toString(),
              decimals: t.decimals,
            });
        }
        if (!sent.length && !previous?.delivered.length)
          throw new HTTPException(503, {
            message: "The testnet faucet could not send tokens. Please try again later.",
          });
        await db.recordFaucetDelivery(domain, owner, [], null, true);
        return { owner, sent, unavailable, transactions };
      }),
    );
  });
  return signer?.address ?? null;
}
