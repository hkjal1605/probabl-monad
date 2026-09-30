/** API process: the chain index (live replica, finalized persistence, read routes) and the
 * `/v1` product API in one process, sharing one RPC poller and one in-memory replica. */

import { createDatabase } from "@conditional-stocks/db";
import { conditionalStocksAbi } from "@conditional-stocks/evm-client";
import { IndexerService } from "@conditional-stocks/indexer";
import { MarketDataError } from "@conditional-stocks/market-data";
import { requestLogging } from "@conditional-stocks/shared/http";
import { RedisCache } from "@conditional-stocks/shared/redis-cache";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { createPublicClient, defineChain, fallback, getAddress, http } from "viem";
import { mountAdmin } from "./admin/routes.ts";
import { mountAuthentication } from "./auth/routes.ts";
import { browserCors } from "./common/browser-cors.ts";
import { logger } from "./common/logger.ts";
import { mountCustody } from "./custody/routes.ts";
import { mountDeltaVaults } from "./delta-vaults/routes.ts";
import { mountFaucet } from "./faucet.ts";
import { PolymarketIngestorClient } from "./integrations/polymarket.ts";
import { PythSpotPrices } from "./market-data/pyth.ts";
import { CachedProbability, mountMarketData } from "./market-data/routes.ts";
import { DelegatedTrading, tradingSigner } from "./trading/delegated.ts";
import { createOrderPlan } from "./trading/plan.ts";
import { mountTrading } from "./trading/routes.ts";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
// Comma-separated endpoints: requests fail over to the next one, so no single provider is a
// point of failure.
const rpcUrls = required("RPC_URL")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const exchange = getAddress(required("EXCHANGE_ADDRESS"));
const chain = defineChain({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: rpcUrls } },
});
const transports = rpcUrls.map((url) =>
  http(url, { batch: { batchSize: 100, wait: 5 }, retryCount: 2, timeout: 15_000 }),
);
const client = createPublicClient({
  chain,
  // Concurrent contract reads share one Multicall3 eth_call (deployless: works on any chain).
  batch: { multicall: { deployless: true, batchSize: 16_384, wait: 5 } },
  transport: transports.length > 1 ? fallback(transports) : transports[0]!,
});
for (const transport of transports) {
  const id = await createPublicClient({ transport }).getChainId();
  if (id !== chainId) throw new Error("An RPC_URL endpoint serves a different chain than CHAIN_ID");
}
const quote = await client.readContract({
  address: exchange,
  abi: conditionalStocksAbi,
  functionName: "quote",
});

const db = createDatabase({
  connectionString: required("DATABASE_URL"),
  max: 8,
  applicationName: "probabl-api",
});
await db.verify();
const origins = required("API_AUTH_ORIGINS")
  .split(",")
  .map((value) => new URL(value.trim()).origin);

const indexer = new IndexerService({
  client,
  exchange,
  quote,
  deploymentBlock: BigInt(required("DEPLOYMENT_BLOCK")),
  chainId,
  db,
  ...(process.env.FINALITY_DEPTH ? { finalityDepth: BigInt(process.env.FINALITY_DEPTH) } : {}),
  ...(process.env.POLL_MS ? { pollMs: Number(process.env.POLL_MS) } : {}),
  onError: (error) => logger.error("indexer.error", { error }),
});
await indexer.start();
const domain = indexer.domain;

const app = new Hono();
app.use("*", browserCors(origins));
app.use("*", requestLogging(logger, { quietPaths: ["/health", "/ready"] }));
app.use("*", async (c, next) =>
  bodyLimit({
    maxSize: /^\/v1\/admin\/evidence\/(creation|resolution)\/prepare$/.test(c.req.path)
      ? 36 * 1024 * 1024
      : 64_000,
  })(c, next),
);
app.onError(
  (error) =>
    new Response(JSON.stringify({ error: { message: error.message } }), {
      status:
        error instanceof HTTPException
          ? error.status
          : error instanceof MarketDataError
            ? error.status
            : 400,
      headers: { "content-type": "application/json" },
    }),
);

indexer.mount(app);
app.get("/ready", async (c) => {
  try {
    const s = indexer.custody();
    await db.ping();
    const healthy = !s.config.paused;
    return c.json({ healthy, chain: "evm" }, healthy ? 200 : 503);
  } catch {
    return c.json({ healthy: false, chain: "evm" }, 503);
  }
});
/** Advisory UI status; mutating endpoints validate chain state again. */
app.get("/v1/system/readiness", (c) => {
  c.header("Cache-Control", "no-store");
  const checkedAt = Date.now();
  try {
    const s = indexer.trading();
    let reason = s.config.paused ? "paused" : "ready";
    const id = c.req.query("marketId");
    if (reason === "ready" && id) {
      const m = indexer.market(id, s);
      if (!m) return c.json({ error: { message: "Unknown market" } }, 404);
      const now = BigInt(Math.floor(checkedAt / 1000));
      reason =
        m.state !== 2
          ? m.state === 1
            ? "scheduled"
            : "closed"
          : m.cutoff <= now
            ? "closed"
            : m.open > now
              ? "scheduled"
              : "ready";
      if (reason === "ready" && indexer.tokens.live.get(m.base)?.paused) reason = "halted";
    }
    return c.json({ healthy: reason === "ready", reason, checkedAt, chain: "evm" });
  } catch {
    c.header("Retry-After", "2");
    return c.json({ healthy: false, reason: "unavailable", checkedAt, chain: "evm" }, 503);
  }
});

const polymarket = () => {
  const url = process.env.POLYMARKET_INGESTOR_URL,
    token = process.env.POLYMARKET_INTERNAL_TOKEN;
  if (!url || !token)
    throw new HTTPException(503, { message: "Polymarket ingestor is not configured" });
  return new PolymarketIngestorClient(url, token);
};
// Redis shares probability ticks across API processes; without it, reads go to the ingestor.
let cacheWarning = 0;
const probabilityCache = new RedisCache(
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  `probabl:probability:${domain}`,
  () => {
    if (Date.now() - cacheWarning < 30_000) return;
    cacheWarning = Date.now();
    logger.warn("probability.cache.unavailable");
  },
);
const probabilities = new CachedProbability(probabilityCache, (condition) =>
  polymarket().probability(condition),
);
mountMarketData(app, {
  indexer,
  prices: new PythSpotPrices(
    chainId,
    process.env.PYTH_HERMES_URL || undefined,
    fetch,
    process.env.PYTH_HERMES_API_KEY || undefined,
  ),
  probabilities,
  polymarket,
});
mountDeltaVaults(app, {
  client,
  indexer,
  // Comma-separated Δ-vault addresses served by this API.
  vaults: (process.env.DELTA_VAULT_ADDRESSES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => getAddress(value)),
  probability: async (condition) => {
    const midpoint = ((await probabilities.get(condition)) as { midpointX6?: unknown }).midpointX6;
    return typeof midpoint === "string" && /^[0-9]{1,7}$/.test(midpoint) ? BigInt(midpoint) : null;
  },
});
const authenticate = mountAuthentication(app, db, client, { chainId, exchange }, domain, origins);
const signer = tradingSigner(
  process.env.TRADING_DELEGATE_PRIVATE_KEY,
  process.env.TRADING_DELEGATE_ADDRESS,
);
const prepare = createOrderPlan(indexer);
mountTrading(app, {
  indexer,
  client,
  authenticate,
  prepare,
  signer,
  delegated: signer ? new DelegatedTrading({ indexer, db, domain, client, signer, prepare }) : null,
});
mountCustody(app, indexer, client, authenticate);
mountAdmin(app, { db, indexer, client, chainId, domain, authenticate, polymarket });
const faucet = mountFaucet(app, {
  secret: process.env.FAUCET_PRIVATE_KEY,
  chainId,
  client,
  indexer,
  db,
  domain,
  authenticate,
});
if (faucet) logger.info("faucet.enabled", { faucet });

const prune = setInterval(
  () => void db.pruneExpired().catch((error) => logger.error("prune.failed", { error })),
  600_000,
);
const server = Bun.serve({
  idleTimeout: 60,
  hostname: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 3000),
  fetch: app.fetch,
});
logger.info("api.listening", { url: server.url.toString(), chainId, exchange });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(prune);
    void server
      .stop()
      .then(() => indexer.stop())
      .then(() => db.close())
      .then(() => process.exit(0));
  });
