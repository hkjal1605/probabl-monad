import { MAX_FEE_BPS } from "@conditional-stocks/evm-client";
import type { AdminDeployment } from "@conditional-stocks/evm-client/admin";
import {
  assertEvidenceIntegrity,
  buildCreationEvidence,
  canonicalStringify,
  type EventMarket,
} from "@conditional-stocks/market-data";
import { catalogUnderlying } from "@conditional-stocks/shared/token-catalog";
import { getAddress, isAddress } from "viem";
import type { EvidenceView } from "./admin-api";
import { inspectToken, readDeployment, type TokenCheck, type TokenInfo } from "./chain";

export type { TokenInfo } from "./chain";
/** Asset markets per batch (e.g. NVDA and TSLA of one Polymarket or Kalshi event). */
export const MAX_BATCH_MARKETS = 20;
const U32 = (1n << 32n) - 1n,
  U64 = (1n << 64n) - 1n,
  U96 = (1n << 96n) - 1n,
  U128 = (1n << 128n) - 1n,
  WAD = 10n ** 18n;
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
/** Quantities (step, max quantity) are raw base-token units; notionals are quote raw units. */
export interface MarketCaps {
  baseStep: string;
  priceTickRawX18: string;
  minNotional: string;
  maxOrderQuantity: string;
  maxOrderNotional: string;
  maxWalletOpenNotional: string;
  maxMarketOpenNotional: string;
}
/** Fee rates in whole bps (0 to `MAX_FEE_BPS`), fixed at creation: resting orders pay the maker
 * rate and orders that fill on arrival the taker rate, on what they receive. */
export interface MarketFees {
  makerFeeBps: string;
  takerFeeBps: string;
}
/** One market for one asset: its stock token, caps and fee rates. */
export interface MarketRow {
  base: TokenInfo;
  caps: MarketCaps;
  fees: MarketFees;
}
/** A stored venue snapshot (Polymarket or Kalshi) the batch's markets share. */
export interface MarketSource {
  normalized: EventMarket;
  rawHash: `0x${string}`;
  snapshotId: string;
}
export interface SharedMarketFields {
  tradingOpen: string;
  tradingCutoff: string;
  metadataUri: string;
  sourceUrls: string;
}
export type CreationConfigBody = Record<string, string>;
export interface BatchPlan {
  base: TokenInfo;
  quote: TokenInfo;
  envelope: ReturnType<typeof buildCreationEvidence>;
  body: {
    attachments: never[];
    config: CreationConfigBody;
    metadataSnapshotId: string;
    sourceUrls: string[];
  };
}
export type BatchResult =
  | { phase: "pending" }
  | { phase: "preparing" }
  | { phase: "uncertain"; message: string }
  | { phase: "prepared"; packet: EvidenceView };

/** One stock token address per market; a token may belong to only one market of the batch. */
export function parseAssetRows(inputs: string[]): string[] {
  if (!inputs.length || inputs.length > MAX_BATCH_MARKETS)
    throw new Error(`Enter between 1 and ${MAX_BATCH_MARKETS} asset markets.`);
  const tokens = inputs.map((input, index) => {
    const value = input.trim();
    if (!isAddress(value, { strict: false }))
      throw new Error(`Market ${index + 1}: enter the stock token's contract address.`);
    return getAddress(value);
  });
  if (new Set(tokens).size !== tokens.length)
    throw new Error("A stock token appears in more than one market of this batch.");
  return tokens;
}

/** The deployment's roles and quote token, and the on-chain facts of every base token. */
export async function loadBatchTokens(tokens: string[]) {
  const parsed = parseAssetRows(tokens);
  const { roles, deployment, listed } = await readDeployment(parsed);
  const [quoteCheck, ...checks] = await Promise.all([
    inspectToken(roles.quote),
    ...parsed.map((token) => inspectToken(token)),
  ]);
  if (!quoteCheck?.ok) throw new Error("The deployment's quote token is unreadable.");
  return {
    quote: quoteCheck.token,
    checks: Object.fromEntries(parsed.map((token, i) => [token, checks[i]!])) as Record<
      string,
      TokenCheck
    >,
    listed,
    deployment,
  };
}
export type VerifiedTokens = Awaited<ReturnType<typeof loadBatchTokens>>;

/** Immutable facts a reviewed batch depends on; pause state is re-validated instead. */
export function tokenIdentity(verified: VerifiedTokens) {
  const token = (t: TokenInfo) => ({ address: t.address, decimals: t.decimals });
  return canonicalStringify({
    marketAdmin: verified.deployment.marketAdmin,
    resolutionAdmin: verified.deployment.resolutionAdmin,
    exchange: verified.deployment.exchange,
    quote: token(verified.quote),
    tokens: Object.values(verified.checks).map((check) =>
      check.ok ? token(check.token) : { address: check.address, error: true },
    ),
  });
}

/** Why a base token cannot be listed for trading against `quote`. An unlisted token needs a
 * catalogued underlying: it becomes part of every market's chain-independent identity. */
export function tokenProblems(check: TokenCheck, quote: TokenInfo, listed = false): string[] {
  if (!check.ok) return [check.error];
  if (check.token.address === quote.address) return ["The stock token cannot be the quote token."];
  if (check.token.paused) return ["The issuer has paused this token."];
  if (!listed && !catalogUnderlying(check.token.symbol))
    return [
      `"${check.token.symbol ?? "Unknown"}" is not in the asset catalog, so its underlying asset is unknown.`,
    ];
  return [];
}

/** Rows ready for planning (every token verified), or the problems per market. */
export function resolveRows(
  verified: VerifiedTokens,
  rows: { token: string; caps: MarketCaps; fees: MarketFees }[],
): { rows: MarketRow[]; problems: string[][] } {
  const problems: string[][] = [],
    ready: MarketRow[] = [];
  for (const row of rows) {
    const check = verified.checks[row.token] ?? {
      ok: false,
      address: row.token,
      error: "Token not verified. Load the tokens again.",
    };
    const issues = tokenProblems(check, verified.quote, verified.listed[row.token] === true);
    try {
      validateMarketCaps(row.caps);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Invalid caps");
    }
    try {
      validateMarketFees(row.fees);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Invalid fees");
    }
    problems.push(issues);
    if (!issues.length && check.ok)
      ready.push({ base: check.token, caps: row.caps, fees: row.fees });
  }
  return { rows: problems.some((list) => list.length) ? [] : ready, problems };
}

/** Human defaults: step 0.001 token, max 1000 tokens per order, tick 0.01 quote per token, and
 * 0.1 / 10k / 100k / 1M quote notional caps. Clamped to the contract's integer domains. */
export function defaultMarketCaps(baseDecimals: number, quoteDecimals: number): MarketCaps {
  for (const d of [baseDecimals, quoteDecimals])
    if (!Number.isInteger(d) || d < 0 || d > 36) throw new Error("Invalid token decimals");
  const base = 10n ** BigInt(baseDecimals),
    quote = 10n ** BigInt(quoteDecimals);
  const step = min(base >= 1000n ? base / 1000n : 1n, U96);
  const humanTick = min(ceil(WAD * quote, 100n * base), U128);
  const tick = humanTick > ceil(WAD, step) ? humanTick : ceil(WAD, step);
  return {
    baseStep: String(step),
    priceTickRawX18: String(tick),
    maxOrderQuantity: String((min(1000n * base, step * U32) / step) * step),
    minNotional: String(min(quote >= 10n ? quote / 10n : 1n, U64 / 4n)),
    maxOrderNotional: String(min(10000n * quote, U64)),
    maxWalletOpenNotional: String(min(100000n * quote, U64)),
    maxMarketOpenNotional: String(min(1000000n * quote, U64)),
  };
}

/** No fees until the admin enters them. */
export const defaultMarketFees = (): MarketFees => ({ makerFeeBps: "0", takerFeeBps: "0" });

/** Whole bps up to the exchange's cap, as `createMarket` checks them. */
export const isFeeBps = (value: string) =>
  /^(0|[1-9][0-9]{0,3})$/.test(value) && Number(value) <= MAX_FEE_BPS;

export function validateMarketFees(fees: MarketFees) {
  for (const [name, value] of Object.entries(fees))
    if (!isFeeBps(value))
      throw new Error(`${name} must be whole bps from 0 to ${MAX_FEE_BPS} (10%)`);
}

/** Mirrors the exchange's `createMarket` checks with exact integers, before any API write. */
export function validateMarketCaps(caps: MarketCaps) {
  const limits: Record<keyof MarketCaps, bigint> = {
    baseStep: U96,
    priceTickRawX18: U128,
    minNotional: U64,
    maxOrderQuantity: U96 * U32,
    maxOrderNotional: U64,
    maxWalletOpenNotional: U64,
    maxMarketOpenNotional: U64,
  };
  const c = Object.fromEntries(
    Object.entries(caps).map(([name, value]) => {
      if (!/^[1-9][0-9]*$/.test(value) || value.length > 60)
        throw new Error(`${name} must be a positive raw integer`);
      const n = BigInt(value);
      if (n > limits[name as keyof MarketCaps])
        throw new Error(`${name} exceeds the contract's integer range`);
      return [name, n];
    }),
  ) as Record<keyof MarketCaps, bigint>;
  if (c.maxOrderQuantity % c.baseStep !== 0n || c.maxOrderQuantity / c.baseStep > U32)
    throw new Error("The maximum quantity must be a multiple of the step, at most 2^32-1 steps.");
  if (
    c.maxOrderNotional < c.minNotional ||
    c.maxWalletOpenNotional < c.maxOrderNotional ||
    c.maxMarketOpenNotional < c.maxWalletOpenNotional
  )
    throw new Error("Caps must satisfy minimum ≤ order ≤ wallet ≤ market notional.");
  const product = c.baseStep * c.priceTickRawX18;
  if (product / WAD === 0n)
    throw new Error("One step at one tick must cost at least one raw quote unit.");
  const minimumPrice = (((c.minNotional - 1n) * WAD) / product + 1n) * c.priceTickRawX18;
  const notional = ceil(c.baseStep * minimumPrice, WAD);
  if (
    minimumPrice > U128 ||
    notional > c.maxOrderNotional ||
    notional * 2n > c.maxMarketOpenNotional
  )
    throw new Error("The step/tick/minimum combination cannot fit inside the market caps.");
}

export function buildBatchPlans(input: {
  rows: MarketRow[];
  quote: TokenInfo;
  source: MarketSource;
  shared: SharedMarketFields;
  deployment: AdminDeployment;
  owner: string;
  nowMs?: number;
}): BatchPlan[] {
  const { rows, quote, source, shared, deployment, owner } = input;
  const nowMs = input.nowMs ?? Date.now();
  parseAssetRows(rows.map((row) => row.base.address));
  if (owner !== deployment.marketAdmin)
    throw new Error("Connect the configured market-admin wallet to prepare this batch.");
  if (
    !/^[1-9][0-9]*$/.test(shared.tradingCutoff) ||
    BigInt(shared.tradingCutoff) <= BigInt(Math.floor(nowMs / 1000))
  )
    throw new Error("Trading cutoff must still be in the future.");
  return rows.map((row, index) => {
    const problems = tokenProblems(
      { ok: true, token: row.base },
      quote,
      deployment.basePoolListed(row.base.address),
    );
    if (problems.length) throw new Error(`Market ${index + 1}: ${problems[0]}`);
    validateMarketCaps(row.caps);
    validateMarketFees(row.fees);
    const config = {
      ...row.caps,
      ...row.fees,
      baseToken: row.base.address,
      quoteToken: quote.address,
      tradingOpen: shared.tradingOpen,
      tradingCutoff: shared.tradingCutoff,
      metadataUri: shared.metadataUri,
      rules: source.normalized.rules,
    };
    const envelope = buildCreationEvidence({
      deployment: { chainId: String(deployment.chainId), exchange: deployment.exchange },
      preparer: owner as `0x${string}`,
      preparedAt: new Date(nowMs).toISOString(),
      attachments: [],
      config,
      metadata: source.normalized,
      metadataRawHash: source.rawHash,
      metadataSnapshotId: source.snapshotId,
      sourceUrls: shared.sourceUrls
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
    });
    return {
      base: row.base,
      quote,
      envelope,
      body: {
        attachments: [],
        config,
        metadataSnapshotId: source.snapshotId,
        sourceUrls: envelope.packet.sourceUrls,
      },
    };
  });
}

export function assertBatchPacket(plan: BatchPlan, packet: EvidenceView) {
  assertEvidenceIntegrity(packet.envelope);
  const actual = packet.envelope.packet,
    expected = plan.envelope.packet;
  if (
    actual.kind !== "market-creation" ||
    canonicalStringify(actual.config) !== canonicalStringify(expected.config) ||
    canonicalStringify(actual.deployment) !== canonicalStringify(expected.deployment) ||
    canonicalStringify(actual.event) !== canonicalStringify(expected.event) ||
    canonicalStringify(actual.sourceUrls) !== canonicalStringify(expected.sourceUrls) ||
    canonicalStringify(actual.attachments) !== canonicalStringify(expected.attachments) ||
    actual.preparer !== expected.preparer
  )
    throw new Error("The returned evidence differs from this reviewed batch row.");
}

export function recoverBatchResults(
  plans: BatchPlan[],
  results: BatchResult[],
  packets: EvidenceView[],
) {
  return plans.map((plan, index): BatchResult => {
    if (results[index]?.phase === "prepared") return results[index];
    const matches = packets.filter((packet) => {
      try {
        assertBatchPacket(plan, packet);
        return packet.status !== "rejected";
      } catch {
        return false;
      }
    });
    if (matches.length > 1)
      return {
        phase: "uncertain",
        message:
          "Multiple matching packets exist. Resolve them in the review queue before proceeding.",
      };
    return matches[0]
      ? { phase: "prepared", packet: matches[0] }
      : (results[index] ?? { phase: "pending" });
  });
}

/** Only send unattempted rows. Never retry ambiguous requests automatically. */
export async function prepareMarketBatch(
  plans: BatchPlan[],
  results: BatchResult[],
  ports: {
    check(): void;
    prepare(plan: BatchPlan): Promise<EvidenceView>;
    update(index: number, result: BatchResult): void;
  },
) {
  for (const [index, plan] of plans.entries()) {
    if (results[index]?.phase !== "pending") continue;
    ports.check();
    ports.update(index, { phase: "preparing" });
    try {
      const packet = await ports.prepare(plan);
      ports.check();
      assertBatchPacket(plan, packet);
      ports.update(index, { phase: "prepared", packet });
    } catch (error) {
      ports.update(index, {
        phase: "uncertain",
        message: error instanceof Error ? error.message : "Request outcome unknown",
      });
      return;
    }
  }
}
