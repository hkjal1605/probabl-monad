/** The stocks a user's world can fix on: every feed of the deployment's feed list
 * (`WORLD_FEEDS_PATH`, as `scripts/evm/deploy-mock-feeds.ts` writes it, or
 * deployments/<chainId>-mock-feeds.json) that the world vault quotes against, named from the
 * asset catalog. Spot comes from the API's reference prices, else the feed's latest round,
 * cached for a few seconds: a preview reads at most one of each per stock. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";
import { type Address, getAddress, isAddress, type PublicClient, parseAbi } from "viem";
import type { WorldUnderlying } from "./opinion.ts";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
const SPOT_TTL_MS = 5_000;

/** Every feed listed for the deployment, as world underlyings. */
export function loadWorldUnderlyings(chainId: number, path?: string): WorldUnderlying[] {
  const file =
    path ??
    [
      resolve(process.cwd(), `deployments/${chainId}-mock-feeds.json`),
      resolve(import.meta.dir, `../../../../deployments/${chainId}-mock-feeds.json`),
    ].find((p) => existsSync(p));
  if (!file || !existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[];
  const out = new Map<string, WorldUnderlying>();
  for (const raw of Array.isArray(list) ? list : []) {
    const symbol = typeof raw.symbol === "string" ? raw.symbol : "";
    const asset = catalogAsset(symbol);
    if (!asset?.underlying || typeof raw.feed !== "string" || !isAddress(raw.feed)) continue;
    if (asset.kind === "stablecoin") continue;
    const decimals = Number(raw.decimals ?? 8);
    out.set(asset.underlying, {
      underlying: asset.underlying,
      symbol: asset.underlying.split(":")[1]!,
      name:
        asset.kind === "crypto"
          ? asset.name.replace(/^(Wrapped|Coinbase Wrapped) /, "")
          : asset.name,
      kind: asset.kind === "etf" ? "etf" : asset.kind === "crypto" ? "crypto" : "stock",
      logo: asset.logo ?? null,
      feed: getAddress(raw.feed),
      token: typeof raw.token === "string" && isAddress(raw.token) ? getAddress(raw.token) : null,
      decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : 8,
    });
  }
  // Crypto names read better plainly: "Bitcoin", "Ethereum".
  for (const u of out.values())
    if (u.kind === "crypto") u.name = catalogAsset(u.symbol)?.name ?? u.name;
  return [...out.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export class WorldSpots {
  private readonly cache = new Map<Address, { usd: number | null; at: number }>();

  constructor(
    private readonly options: {
      client: PublicClient;
      /** The API's reference prices (USD per share) of a batch of tokens, by token. */
      reference?: (tokens: { token: Address; symbol: string }[]) => Promise<Map<Address, number>>;
    },
  ) {}

  /** Every stock's spot at once: one reference batch, a feed read for the ones it lacks. */
  async all(list: WorldUnderlying[]): Promise<Map<string, number | null>> {
    const now = Date.now();
    const stale = list.filter((u) => {
      const hit = this.cache.get(u.feed);
      return !hit || now - hit.at >= SPOT_TTL_MS;
    });
    if (stale.length && this.options.reference) {
      const tokens = stale.flatMap((u) => (u.token ? [{ token: u.token, symbol: u.symbol }] : []));
      const prices = tokens.length
        ? await this.options.reference(tokens.slice(0, 50)).catch(() => new Map<Address, number>())
        : new Map<Address, number>();
      for (const u of stale) {
        const usd = u.token ? prices.get(u.token) : undefined;
        if (usd !== undefined) this.cache.set(u.feed, { usd, at: now });
      }
    }
    // The rest from their feeds (the reference batch already answered what it could).
    await Promise.all(list.map((u) => this.usd(u, true)));
    return new Map(list.map((u) => [u.underlying, this.cache.get(u.feed)?.usd ?? null]));
  }

  /** The spot in dollars, or null when no source has one. */
  async usd(u: WorldUnderlying, feedOnly = false): Promise<number | null> {
    const hit = this.cache.get(u.feed);
    if (hit && Date.now() - hit.at < SPOT_TTL_MS) return hit.usd;
    let usd: number | null = null;
    if (!feedOnly && u.token && this.options.reference)
      usd =
        (
          await this.options
            .reference([{ token: u.token, symbol: u.symbol }])
            .catch(() => new Map<Address, number>())
        ).get(u.token) ?? null;
    if (usd === null)
      try {
        const r = (await this.options.client.readContract({
          address: u.feed,
          abi: feedAbi,
          functionName: "latestRoundData",
        })) as readonly bigint[];
        const answer = Number(r[1]!) / 10 ** u.decimals;
        usd = answer > 0 ? answer : null;
      } catch {
        usd = null;
      }
    this.cache.set(u.feed, { usd, at: Date.now() });
    return usd;
  }
}
