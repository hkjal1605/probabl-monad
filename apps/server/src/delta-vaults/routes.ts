import {
  address,
  type DeltaVaultClaims,
  type DeltaVaultState,
  deltaVaultAbi,
  deltaVaultErrorMessage,
  deltaVaultValue,
  readDeltaVault,
  unsigned,
} from "@conditional-stocks/evm-client";
import type { IndexerService } from "@conditional-stocks/indexer";
import { ReadCache } from "@conditional-stocks/shared/read-cache";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Address, erc20Abi, type Hex, type PublicClient } from "viem";
import type { Auth } from "../auth/routes.ts";

/** A market's YES probability (x1e6) by Polymarket condition, or null while unavailable. */
export type ProbabilityOf = (condition: Hex) => Promise<bigint | null>;

const claims = (c: DeltaVaultClaims) => ({
  yesQuote: String(c.yesQuote),
  noQuote: String(c.noQuote),
  yesBase: String(c.yesBase),
  noBase: String(c.noBase),
});

/** Δ-vault reads: each configured vault's state, a wallet's position and in-kind deposit and
 * withdrawal previews. Wallets sign deposits and withdrawals themselves: the vault prices them
 * on chain within the caller's own slippage limits, so there is nothing to prepare here. */
export function mountDeltaVaults(
  app: Hono,
  deps: {
    client: PublicClient;
    indexer: IndexerService;
    vaults: readonly Address[];
    probability: ProbabilityOf;
    auth: Auth;
  },
) {
  const reads = new ReadCache(2000, 64);
  const known = new Set(deps.vaults);
  const vaultOf = (value: string) => {
    const vault = address(value);
    if (!known.has(vault)) throw new HTTPException(404, { message: "Unknown vault" });
    return vault;
  };
  const token = (token: Address) => {
    const s = deps.indexer.trading();
    return {
      token,
      symbol: deps.indexer.tokens.identity.get(token)?.symbol ?? null,
      decimals: s.pools.get(token)?.decimals ?? null,
    };
  };

  async function view(vault: Address) {
    const v = await reads.get<DeltaVaultState>(`state:${vault}`, () =>
      readDeltaVault(deps.client, vault),
    );
    const s = deps.indexer.trading();
    const probabilities = new Map<number, bigint | null>();
    await Promise.all(
      v.markets.map(async ({ market }) => {
        const m = s.markets.get(market);
        probabilities.set(market, m ? await deps.probability(m.condition).catch(() => null) : null);
      }),
    );
    // Display only: deposits and withdrawals are in kind and never use a price.
    const value =
      v.oraclePrice === null
        ? null
        : deltaVaultValue(v.holdings, v.oraclePrice, (market) => probabilities.get(market) ?? null);
    return {
      address: v.address,
      name: v.name,
      symbol: v.symbol,
      decimals: 18,
      exchange: v.exchange,
      module: v.module,
      quote: token(v.quote),
      base: { ...token(v.base), underlying: s.pools.get(v.base)?.underlying ?? null },
      priceFeed: v.priceFeed,
      sequencerFeed: v.sequencerFeed,
      admin: v.admin,
      paused: v.paused,
      totalSupply: String(v.totalSupply),
      caps: { quote: String(v.caps.quote), base: String(v.caps.base) },
      withdrawLimitBps: v.withdrawLimitBps,
      withdrawable: String(v.withdrawable),
      limits: v.limits,
      oraclePrice: v.oraclePrice === null ? null : String(v.oraclePrice),
      value: value === null ? null : String(value),
      valuePerShare:
        value === null || v.totalSupply === 0n
          ? null
          : String((value * 10n ** 18n) / v.totalSupply),
      holdings: {
        quote: String(v.holdings.quote),
        base: String(v.holdings.base),
        freeQuote: String(v.holdings.freeQuote),
        freeBase: String(v.holdings.freeBase),
        markets: v.holdings.markets.map((h) => ({
          venueId: h.market,
          claims: claims(h.claims),
          free: claims(h.free),
        })),
      },
      markets: v.markets.map((vm) => {
        const m = s.markets.get(vm.market);
        const probability = probabilities.get(vm.market) ?? null;
        return {
          venueId: vm.market,
          market: m ? deps.indexer.view(s, m) : null,
          probability: probability === null ? null : String(probability),
          cutoff: vm.cutoff,
          risk: {
            bandBps: vm.risk.bandBps,
            cutoffBuffer: vm.risk.cutoffBuffer,
            maxOrder: String(vm.risk.maxOrder),
            maxResting: String(vm.risk.maxResting),
            maxImbalance: String(vm.risk.maxImbalance),
          },
          exposure: {
            imbalance: String(vm.exposure.imbalance),
            high: String(vm.exposure.high),
            low: String(vm.exposure.low),
            resting: String(vm.exposure.resting),
          },
          orders: vm.orders.length,
        };
      }),
    };
  }

  const preview = async <T>(read: () => Promise<T>) => {
    try {
      return await read();
    } catch (error) {
      throw new HTTPException(400, {
        message: deltaVaultErrorMessage(error, "Preview unavailable"),
      });
    }
  };

  app.get("/v1/delta-vaults", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ vaults: await Promise.all(deps.vaults.map(view)) });
  });

  app.get("/v1/delta-vaults/:vault", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await view(vaultOf(c.req.param("vault"))));
  });

  /** A wallet's shares, what they redeem for now, and its token balances and allowances. */
  app.get("/v1/delta-vaults/:vault/accounts/:owner", async (c) => {
    const vault = vaultOf(c.req.param("vault")),
      { owner } = await deps.auth.member(c, address(c.req.param("owner")));
    c.header("Cache-Control", "no-store");
    const v = await reads.get<DeltaVaultState>(`state:${vault}`, () =>
      readDeltaVault(deps.client, vault),
    );
    const read = (token: Address, functionName: "balanceOf" | "allowance") =>
      deps.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName,
        args: functionName === "balanceOf" ? [owner] : [owner, vault],
      } as never) as Promise<bigint>;
    const [shares, quoteBalance, baseBalance, quoteAllowance, baseAllowance] = await Promise.all([
      deps.client.readContract({
        address: vault,
        abi: deltaVaultAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
      read(v.quote, "balanceOf"),
      read(v.base, "balanceOf"),
      read(v.quote, "allowance"),
      read(v.base, "allowance"),
    ]);
    const redeems =
      shares === 0n
        ? null
        : await preview(() =>
            deps.client.readContract({
              address: vault,
              abi: deltaVaultAbi,
              functionName: "previewWithdraw",
              args: [shares],
            }),
          );
    return c.json({
      vault,
      owner,
      shares: String(shares),
      wallet: { quote: String(quoteBalance), base: String(baseBalance) },
      allowance: { quote: String(quoteAllowance), base: String(baseAllowance) },
      redeems: redeems && {
        quote: String(redeems[0]),
        base: String(redeems[1]),
        claims: redeems[2].map((entry, i) => ({
          venueId: v.markets[i]?.market ?? null,
          ...claims(entry),
        })),
      },
    });
  });

  /** Shares and in-kind cost of depositing up to `quote` and `base` raw units now. */
  app.get("/v1/delta-vaults/:vault/preview/deposit", async (c) => {
    await deps.auth.member(c);
    const vault = vaultOf(c.req.param("vault"));
    const maxQuote = unsigned(c.req.query("quote") ?? "0"),
      maxBase = unsigned(c.req.query("base") ?? "0");
    c.header("Cache-Control", "no-store");
    const [result, markets] = await preview(() =>
      Promise.all([
        deps.client.readContract({
          address: vault,
          abi: deltaVaultAbi,
          functionName: "previewDeposit",
          args: [maxQuote, maxBase],
        }),
        deps.client.readContract({ address: vault, abi: deltaVaultAbi, functionName: "markets" }),
      ]),
    );
    const [shares, quoteIn, baseIn, returned] = result;
    return c.json({
      shares: String(shares),
      quoteIn: String(quoteIn),
      baseIn: String(baseIn),
      returned: returned.map((entry, i) => ({ venueId: markets[i] ?? null, ...claims(entry) })),
    });
  });

  /** Tokens and unpaired claims `shares` withdraw for now. */
  app.get("/v1/delta-vaults/:vault/preview/withdraw", async (c) => {
    await deps.auth.member(c);
    const vault = vaultOf(c.req.param("vault"));
    const shares = unsigned(c.req.query("shares"), 2n ** 256n - 1n);
    c.header("Cache-Control", "no-store");
    const [result, markets] = await preview(() =>
      Promise.all([
        deps.client.readContract({
          address: vault,
          abi: deltaVaultAbi,
          functionName: "previewWithdraw",
          args: [shares],
        }),
        deps.client.readContract({ address: vault, abi: deltaVaultAbi, functionName: "markets" }),
      ]),
    );
    const [quoteOut, baseOut, returned] = result;
    return c.json({
      quoteOut: String(quoteOut),
      baseOut: String(baseOut),
      claims: returned.map((entry, i) => ({ venueId: markets[i] ?? null, ...claims(entry) })),
    });
  });
}
