import type { Database } from "@conditional-stocks/db";
import { type IndexerService, marketIdentity, venueOf } from "@conditional-stocks/indexer";
import { type Hex, isHex32, noOutcome, yesOutcome } from "@conditional-stocks/market-data";
import { ReadCache } from "@conditional-stocks/shared/read-cache";
import type { RedisCache } from "@conditional-stocks/shared/redis-cache";
import {
  isEvmAddress,
  SPOT_BATCH_SIZE,
  tokenPriceUsd,
} from "@conditional-stocks/shared/spot-prices";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { type Address, getAddress } from "viem";
import type { EventMarketsClient } from "../integrations/event-markets.ts";
import { HISTORY_RANGES, type HistoryRange, priceHistory } from "./history.ts";
import type { SpotPriceSource } from "./robinhood.ts";

export const PROBABILITY_CACHE_TTL_SECONDS = 60;
/** Markets per `/v1/events` read. */
export const EVENT_BATCH_SIZE = 50;
/** How long one market's event may take in a batch (the app gives the whole read 10 s). */
const EVENT_DEADLINE_MS = 6_000;
/** Conditions per shared probability stream: 50 keep its request line under 4 KB. */
export const PROBABILITY_BATCH_SIZE = 50;

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
    prices: SpotPriceSource;
    probabilities: CachedProbability;
    events: () => EventMarketsClient;
    db: Pick<Database, "priceHistory" | "firstPriceMinute">;
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

  // A market's recorded prices change once a minute: one read per market, range and minute
  // serves every viewer.
  const histories = new ReadCache(60_000, 512);
  app.get("/v1/markets/:id/price-history", async (c) => {
    const range = c.req.query("range") ?? "all";
    if (!Object.hasOwn(HISTORY_RANGES, range))
      throw new HTTPException(400, { message: "range is one of 1d, 1w, 1m, all" });
    const s = indexer.trading();
    const m = indexer.market(c.req.param("id"), s);
    if (!m) throw new HTTPException(404, { message: "Unknown market" });
    const history = await histories.get(`${m.id}:${range}:${Math.floor(Date.now() / 60_000)}`, () =>
      priceHistory(options.db, indexer.domain, m.id, range as HistoryRange),
    );
    c.header("Cache-Control", "public, max-age=30");
    return c.json({ marketId: marketIdentity(s, m).id, range, ...history });
  });

  const marketCondition = (id: string) => {
    const m = indexer.market(id);
    if (!m) throw new HTTPException(404, { message: "Unknown market" });
    return m;
  };
  // Metadata changes at most once per ingestor poll (minutes); every market list refresh reads
  // it for every condition, so one read per condition serves all of them for a while.
  const metadataReads = new ReadCache(30_000, 1_024);
  // A market's event (Polymarket or Kalshi): its metadata and latest probability.
  const eventOf = async (id: string) => {
    const m = marketCondition(id);
    const probability = probabilities.get(m.condition).catch(() => null);
    const metadata = await metadataReads.get(m.condition.toLowerCase(), () =>
      options.events().metadata(m.condition),
    );
    if (
      metadata.normalized.conditionId.toLowerCase() !== m.condition.toLowerCase() ||
      yesOutcome(metadata.normalized).indexSet !== String(m.yesIndex) ||
      noOutcome(metadata.normalized).indexSet !== String(m.noIndex)
    )
      throw new HTTPException(409, {
        message: "External snapshot does not match immutable market orientation",
      });
    return {
      informationalOnly: true,
      localMarketId: String(m.id),
      source: metadata.normalized.source,
      metadata,
      probability: await probability,
      settlementAuthority: "manual-admin-only",
    };
  };
  // The `/polymarket` path predates Kalshi.
  for (const path of ["/v1/markets/:id/event", "/v1/markets/:id/polymarket"])
    app.get(path, async (c) => c.json(await eventOf(c.req.param("id") ?? "")));
  // Many markets' events in one read (a market list reads one market per event), each its event
  // or the reason it has none.
  app.get("/v1/events", async (c) => {
    const ids = [...new Set((c.req.query("markets") ?? "").split(",").filter(Boolean))];
    if (!ids.length || ids.length > EVENT_BATCH_SIZE)
      throw new HTTPException(400, {
        message: `Supply 1-${EVENT_BATCH_SIZE} market ids in markets`,
      });
    // A slow source answers for its own market only; the app keeps its last copy and reads it
    // again later, rather than the whole batch outlasting its request.
    const events = await Promise.all(
      ids.map((id) =>
        Promise.race([
          eventOf(id),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Event read timed out")), EVENT_DEADLINE_MS),
          ),
        ]).catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Event unavailable",
        })),
      ),
    );
    return c.json({ events: Object.fromEntries(ids.map((id, i) => [id, events[i]])) });
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
  /** Each condition's probability every minute, as a `probability` event (`unavailable` with its
   * condition when it has none), with heartbeats in between. */
  const streamProbabilities = (c: Context, conditions: string[]) => {
    if (probabilityStreams >= 2000) return c.json({ error: "Stream capacity reached" }, 503);
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      probabilityStreams++;
      try {
        while (!stream.aborted) {
          const ticks = await Promise.allSettled(conditions.map((id) => probabilities.get(id)));
          for (const [i, tick] of ticks.entries()) {
            if (stream.aborted) break;
            const condition = conditions[i];
            await stream.writeSSE(
              tick.status === "fulfilled"
                ? {
                    event: "probability",
                    data: JSON.stringify({ topic: `probability.${condition}`, value: tick.value }),
                  }
                : { event: "unavailable", data: JSON.stringify({ conditionId: condition }) },
            );
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
  };
  // A page's conditions share one stream, so the cards on it hold one connection, not one each.
  app.get("/v1/probabilities/stream", (c) => {
    const conditions = [
      ...new Set((c.req.query("conditions") ?? "").toLowerCase().split(",").filter(Boolean)),
    ];
    if (
      !conditions.length ||
      conditions.length > PROBABILITY_BATCH_SIZE ||
      !conditions.every(isHex32)
    )
      return c.json(
        { error: `Supply 1-${PROBABILITY_BATCH_SIZE} condition IDs in conditions` },
        400,
      );
    return streamProbabilities(c, conditions);
  });
  app.get("/v1/probabilities/:conditionId/stream", (c) => {
    const condition = c.req.param("conditionId").toLowerCase();
    if (!isHex32(condition)) return c.json({ error: "Invalid condition ID" }, 400);
    return streamProbabilities(c, [condition]);
  });
}
