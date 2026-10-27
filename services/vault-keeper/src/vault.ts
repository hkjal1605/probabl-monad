import {
  type DeltaVaultClaims,
  type DeltaVaultExposure,
  type DeltaVaultHoldings,
  type DeltaVaultLimits,
  type DeltaVaultRisk,
  deltaVaultAbi,
  unbatched,
} from "@conditional-stocks/evm-client";
import type { Address, PublicClient } from "viem";

/** A vault's fixed addresses, read once at startup. */
export interface VaultIdentity {
  address: Address;
  exchange: Address;
  quote: Address;
  base: Address;
}
export interface VaultMarket {
  market: number;
  risk: DeltaVaultRisk;
  tick: bigint;
  cutoff: number;
  exposure: DeltaVaultExposure;
}
/** What the keeper reads of a vault to quote it. */
export interface VaultView extends VaultIdentity {
  totalSupply: bigint;
  paused: boolean;
  limits: DeltaVaultLimits;
  holdings: DeltaVaultHoldings;
  markets: VaultMarket[];
  /** Null while the vault's oracle (or L2 sequencer) cannot be trusted. */
  oraclePrice: bigint | null;
}

type Result = { status: "success"; result: unknown } | { status: "failure"; error: Error };
const claims = (c: DeltaVaultClaims): DeltaVaultClaims => ({
  yesQuote: c.yesQuote,
  noQuote: c.noQuote,
  yesBase: c.yesBase,
  noBase: c.noBase,
});

/** Markets whose terms and exposure ride along with the vault's holdings in its first read, and
 * markets per further concurrent read: about 0.6 KB each against the 24 KB a deployless multicall
 * can return (the holdings alone are about 14 KB at the 48-market cap). */
const MARKETS_IN_FIRST_READ = 8;
const MARKETS_PER_READ = 16;

/** The vault's quoting state: one eth_call up to `MARKETS_IN_FIRST_READ` markets, then concurrent
 * reads of the rest. The terms and exposure of the markets the vault registered at the previous
 * read (`known`) are read along with everything else; only a changed market set (one added,
 * settled or removed since) costs another round of reads. Each vault reads on its own: merged
 * with other vaults' reads, the first would pass the 24 KB limit. */
export async function readVaultView(
  client: PublicClient,
  vault: VaultIdentity,
  known: readonly number[],
): Promise<VaultView> {
  const read = { address: vault.address, abi: deltaVaultAbi } as const;
  const direct = unbatched(client);
  const terms = (markets: readonly number[]) =>
    markets.flatMap((market) => [
      { ...read, functionName: "market", args: [market] },
      { ...read, functionName: "exposure", args: [market] },
    ]);
  const termsOf = async (markets: readonly number[]) => {
    const chunks: number[][] = [];
    for (let i = 0; i < markets.length; i += MARKETS_PER_READ)
      chunks.push(markets.slice(i, i + MARKETS_PER_READ));
    const reads = await Promise.all(
      chunks.map(
        (chunk) =>
          direct.multicall({
            allowFailure: true,
            deployless: true,
            // One call per chunk: chunks are sized to the return limit, not viem's calldata split.
            batchSize: 0,
            contracts: terms(chunk) as never,
          }) as Promise<Result[]>,
      ),
    );
    return reads.flat();
  };
  const [results, rest] = await Promise.all([
    direct.multicall({
      allowFailure: true,
      // Deployless: works on chains without a Multicall3 deployment (anvil).
      deployless: true,
      batchSize: 0,
      contracts: [
        { ...read, functionName: "totalSupply" },
        { ...read, functionName: "paused" },
        { ...read, functionName: "limits" },
        { ...read, functionName: "holdings" },
        { ...read, functionName: "markets" },
        { ...read, functionName: "oraclePrice" },
        ...terms(known.slice(0, MARKETS_IN_FIRST_READ)),
      ] as never,
    }) as Promise<Result[]>,
    termsOf(known.slice(MARKETS_IN_FIRST_READ)),
  ]);
  const value = <T>(r: Result | undefined) => {
    if (r?.status !== "success") throw r?.error ?? new Error("Vault read failed");
    return r.result as T;
  };
  const markets = value<readonly number[]>(results[4]);
  let details = [...results.slice(6), ...rest];
  if (
    markets.length !== known.length ||
    markets.some((market, i) => market !== known[i]) ||
    details.some((r) => r.status !== "success")
  )
    details = await termsOf(markets);
  const limits = value<DeltaVaultLimits>(results[2]);
  const holdings = value<{
    quote: bigint;
    base: bigint;
    freeQuote: bigint;
    freeBase: bigint;
    markets: readonly number[];
    claims: readonly DeltaVaultClaims[];
    free: readonly DeltaVaultClaims[];
  }>(results[3]);
  const oracle = results[5];
  return {
    ...vault,
    totalSupply: value<bigint>(results[0]),
    paused: value<boolean>(results[1]),
    limits: {
      maxTtl: limits.maxTtl,
      maxOracleAge: limits.maxOracleAge,
      maxFeeBps: limits.maxFeeBps,
    },
    holdings: {
      quote: holdings.quote,
      base: holdings.base,
      freeQuote: holdings.freeQuote,
      freeBase: holdings.freeBase,
      markets: holdings.markets.map((market, i) => {
        const owned = holdings.claims[i],
          free = holdings.free[i];
        if (!owned || !free) throw new Error("Inconsistent vault holdings");
        return { market, claims: claims(owned), free: claims(free) };
      }),
    },
    markets: markets.map((market, i) => {
      const m = value<{ risk: DeltaVaultRisk; tick: bigint; cutoff: number }>(details[2 * i]);
      const e = value<DeltaVaultExposure>(details[2 * i + 1]);
      return {
        market,
        risk: {
          bandBps: m.risk.bandBps,
          cutoffBuffer: m.risk.cutoffBuffer,
          maxOrder: m.risk.maxOrder,
          maxResting: m.risk.maxResting,
          maxImbalance: m.risk.maxImbalance,
        },
        tick: m.tick,
        cutoff: m.cutoff,
        exposure: {
          imbalance: e.imbalance,
          high: e.high,
          low: e.low,
          resting: e.resting,
          crossed: e.crossed,
        },
      };
    }),
    oraclePrice: oracle?.status === "success" ? (oracle.result as bigint) : null,
  };
}
