import { type IndexerService, marketIdentity, venueOf } from "@conditional-stocks/indexer";
import { type Hex, isHex32, noOutcome, yesOutcome } from "@conditional-stocks/market-data";
import type { RedisCache } from "@conditional-stocks/shared/redis-cache";
import {
  isEvmAddress,
  SPOT_BATCH_SIZE,
  tokenPriceUsd,
} from "@conditional-stocks/shared/spot-prices";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { type Address, getAddress } from "viem";
import type { PolymarketIngestorClient } from "../integrations/polymarket.ts";
import type { PythSpotPrices } from "./pyth.ts";

export const PROBABILITY_CACHE_TTL_SECONDS = 60;

/** Validated probability ticks shared through Redis by every API process. */
export class CachedProbability {
  constructor(
    private readonly cache: RedisCache,
    private readonly load: (condition: Hex) => Promise<unknown>,
  ) {}
  get(condition: string) {
    if (!isHex32(condition)) throw new Error("Invalid condition ID");
    const canonical = condition.toLowerCase() as Hex;
    return this.cache.get(canonical, PROBABILITY_CACHE_TTL_SECONDS, async () => {
      const tick = (await this.load(canonical)) as Record<string, unknown> | null;
      if (!tick || tick.conditionId !== canonical)
        throw new Error("Probability condition mismatch");
      if (tick.quality !== "valid" || tick.isStale !== false)
        throw new Error("Probability is not currently valid");
      return tick;
    });
  }
}

function tokensQuery(value: string | undefined): Address[] {
  const tokens = [...new Set((value ?? "").split(",").filter(Boolean))];
  if (!tokens.length || tokens.length > SPOT_BATCH_SIZE || tokens.some((t) => !isEvmAddress(t)))
    throw new HTTPException(400, {
      message: `Supply 1-${SPOT_BATCH_SIZE} token addresses in tokens`,
    });
  return tokens.map((t) => getAddress(t));
}

export function mountMarketData(
  app: Hono,
  options: {
    indexer: IndexerService;
    prices: PythSpotPrices;
    probabilities: CachedProbability;
    polymarket: () => PolymarketIngestorClient;
  },
) {
  const { indexer, prices, probabilities } = options;
  const identify = (tokens: Address[]) =>
    tokens.map((token) => ({ token, symbol: indexer.tokens.identity.get(token)?.symbol ?? null }));
  let streams = 0;

  app.get("/v1/spot-prices", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await prices.getPrices(identify(tokensQuery(c.req.query("tokens")))));
  });
  app.get("/v1/spot-prices/stream", (c) => {
    const tokens = tokensQuery(c.req.query("tokens"));
    if (streams >= 2000) return c.json({ error: "Stream capacity reached" }, 503);
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      streams++;
      try {
        while (!stream.aborted) {
          try {
            await stream.writeSSE({
              event: "prices",
              data: JSON.stringify(await prices.getPrices(identify(tokens))),
            });
          } catch {
            await stream.writeSSE({ event: "unavailable", data: "{}" });
          }
          await stream.sleep(15_000);
        }
      } finally {
        streams--;
      }
    });
  });

  /** Reference prices of a market's quote and base token, plus the base token's USD price per
   * whole token (per-share reference x the issuer's live UI multiplier). */
  app.get("/v1/markets/:id/spot-prices", async (c) => {
    c.header("Cache-Control", "no-store");
    const s = indexer.trading();
    const m = indexer.market(c.req.param("id"), s);
    if (!m) throw new HTTPException(404, { message: "Unknown market" });
    const response = await prices.getPrices(identify([s.quote, m.base]));
    const live = indexer.tokens.live.get(m.base);
    const multiplierValue = Number(live?.multiplier ?? 10n ** 18n) / 1e18;
    const base = response.prices[1]!;
    return c.json({
      ...response,
      marketId: marketIdentity(s, m).id,
      venue: venueOf(indexer.deployment, m.id),
      quote: response.prices[0],
      base: {
        ...base,
        multiplierValue,
        paused: live?.paused ?? false,
        tokenPriceUsd: tokenPriceUsd(base, multiplierValue, response.asOf * 1000),
      },
    });
  });

  const marketCondition = (id: string) => {
    const m = indexer.market(id);
    if (!m) throw new HTTPException(404, { message: "Unknown market" });
    return m;
  };
  app.get("/v1/markets/:id/polymarket", async (c) => {
    const m = marketCondition(c.req.param("id"));
    const metadata = await options.polymarket().metadata(m.condition);
    if (
      metadata.normalized.conditionId.toLowerCase() !== m.condition.toLowerCase() ||
      yesOutcome(metadata.normalized).indexSet !== String(m.yesIndex) ||
      noOutcome(metadata.normalized).indexSet !== String(m.noIndex)
    )
      throw new HTTPException(409, {
        message: "External snapshot does not match immutable market orientation",
      });
    return c.json({
      informationalOnly: true,
      localMarketId: String(m.id),
      metadata,
      probability: await probabilities.get(m.condition).catch(() => null),
      settlementAuthority: "manual-admin-only",
    });
  });
  app.get("/v1/markets/:id/probability", async (c) => {
    const m = marketCondition(c.req.param("id"));
    return c.json({
      informationalOnly: true,
      probability: await probabilities.get(m.condition),
      settlementAuthority: "manual-admin-only",
    });
  });

  let probabilityStreams = 0;
  app.get("/v1/probabilities/:conditionId/stream", (c) => {
    const condition = c.req.param("conditionId").toLowerCase();
    if (!isHex32(condition)) return c.json({ error: "Invalid condition ID" }, 400);
    if (probabilityStreams >= 2000) return c.json({ error: "Stream capacity reached" }, 503);
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      probabilityStreams++;
      try {
        while (!stream.aborted) {
          try {
            await stream.writeSSE({
              event: "probability",
              data: JSON.stringify({
                topic: `probability.${condition}`,
                value: await probabilities.get(condition),
              }),
            });
          } catch {
            if (stream.aborted) break;
            await stream.writeSSE({ event: "unavailable", data: "{}" });
          }
          for (let i = 0; i < 4 && !stream.aborted; i++) {
            await stream.sleep(15_000);
            if (!stream.aborted) await stream.writeSSE({ event: "heartbeat", data: "{}" });
          }
        }
      } finally {
        probabilityStreams--;
      }
    });
  });
}
