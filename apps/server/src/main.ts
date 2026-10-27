/** API process: the chain index (live replica, finalized persistence, read routes) and the
 * `/v1` product API in one process, sharing one RPC poller and one in-memory replica. */

import { createDatabase } from "@conditional-stocks/db";
import {
  conditionalStocksAbi,
  DEPLOYLESS_BATCH_SIZE,
  QUOTE_TYPES,
  quoteDomain,
} from "@conditional-stocks/evm-client";
import { IndexerService } from "@conditional-stocks/indexer";
import { MarketDataError } from "@conditional-stocks/market-data";
import { nativeCurrency } from "@conditional-stocks/shared/chains";
import { requestLogging } from "@conditional-stocks/shared/http";
import { RedisCache } from "@conditional-stocks/shared/redis-cache";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { websocket } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import { BaseError, createPublicClient, defineChain, fallback, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mountAdmin } from "./admin/routes.ts";
import { mountAuthentication } from "./auth/routes.ts";
import { browserCors } from "./common/browser-cors.ts";
import { logger } from "./common/logger.ts";
import { mountCustody } from "./custody/routes.ts";
import { mountDeltaVaults } from "./delta-vaults/routes.ts";
import { mountFaucet } from "./faucet.ts";
import { EventMarketsClient } from "./integrations/event-markets.ts";
import { mountInvites } from "./invites/routes.ts";
import { CoinbaseCryptoPrices } from "./market-data/coinbase.ts";
import { PriceRecorder } from "./market-data/history.ts";
import { RobinhoodSpotPrices } from "./market-data/robinhood.ts";
import { CachedProbability, mountMarketData } from "./market-data/routes.ts";
import { Referrals } from "./referrals/service.ts";
import { RfqHub } from "./rfq/hub.ts";
import { MAX_MAKER_FRAME } from "./rfq/protocol.ts";
import { mountRfq } from "./rfq/routes.ts";
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
  nativeCurrency: nativeCurrency(chainId),
  rpcUrls: { default: { http: rpcUrls } },
});
const transports = rpcUrls.map((url) =>
  http(url, { batch: { batchSize: 100, wait: 5 }, retryCount: 2, timeout: 15_000 }),
);
const client = createPublicClient({
  chain,
  // Concurrent contract reads share Multicall3 eth_calls (deployless: works on any chain), each
  // within the initcode limit.
  batch: { multicall: { deployless: true, batchSize: DEPLOYLESS_BATCH_SIZE, wait: 5 } },
  transport: transports.length > 1 ? fallback(transports) : transports[0]!,
});
// The chain follower reads through one endpoint at a time (each failing over to the rest) and
// moves to another when its head stalls: a node that answers but stopped syncing is not fatal.
const endpoints =
  transports.length > 1
    ? transports.map((_, i) =>
        createPublicClient({
          chain,
          transport: fallback([...transports.slice(i), ...transports.slice(0, i)]),
        }),
      )
    : undefined;
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
const whole = (name: string, fallback: number, max: number) => {
  const value = Number(process.env[name]?.trim() || fallback);
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(`${name} must be a whole number up to ${max}`);
  return value;
};
/** Referral program: 15% of referees' net fees for 6 months; members create 5 codes. */
const referralConfig = {
  shareBps: whole("REFERRAL_SHARE_BPS", 1_500, 10_000),
  months: whole("REFERRAL_MONTHS", 6, 120),
};
const codeQuota = whole("INVITE_CODES_PER_MEMBER", 5, 10_000);
// INVITE_ONLY=0 lets every signed-in wallet trade without an invite (invites still join).
const inviteOnly = process.env.INVITE_ONLY?.trim() !== "0";
// Proxies in front of the API (each appending X-Forwarded-For): rate limits key on the client.
const trustedHops = whole("TRUST_PROXY_HOPS", 0, 5);

const indexer = new IndexerService({
  client,
  ...(endpoints ? { endpoints } : {}),
  exchange,
  quote,
  deploymentBlock: BigInt(required("DEPLOYMENT_BLOCK")),
  chainId,
  db,
  ...(process.env.FINALITY_DEPTH ? { finalityDepth: BigInt(process.env.FINALITY_DEPTH) } : {}),
  ...(process.env.POLL_MS ? { pollMs: Number(process.env.POLL_MS) } : {}),
  ...(process.env.FINALITY_MS ? { finalityMs: Number(process.env.FINALITY_MS) } : {}),
  onError: (error) => logger.error("indexer.error", { error }),
});
await indexer.start();
const domain = indexer.domain;

const app = new Hono();
// Requests in flight, which a shutdown lets finish (see the signal handler below).
let inflight = 0;
app.use("*", async (_c, next) => {
  inflight++;
  try {
    await next();
  } finally {
    inflight--;
  }
});
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
    new Response(
      JSON.stringify({
        error: {
          // A chain client error's full text names the RPC endpoint (which can carry a key).
          message: error instanceof BaseError ? error.shortMessage : error.message,
          // Gates name why (e.g. "invite-required"), so the app can offer the right step.
          ...(error instanceof HTTPException &&
          typeof (error.cause as { code?: unknown } | undefined)?.code === "string"
            ? { code: (error.cause as { code: string }).code }
            : {}),
        },
      }),
      {
        status:
          error instanceof HTTPException
            ? error.status
            : error instanceof MarketDataError
              ? error.status
              : 400,
        headers: { "content-type": "application/json" },
      },
    ),
);

const auth = mountAuthentication(app, {
  db,
  client,
  deployment: { chainId, exchange },
  domain,
  origins,
  // Plain-HTTP local development only: browsers keep `__Host-`/Secure cookies for HTTPS.
  secureCookie: process.env.SESSION_COOKIE_INSECURE !== "1",
  trustedHops,
  codeQuota,
  inviteOnly,
});
// A wallet's own portfolio, orders, trades and stream need its member session; the same reads
// without an owner (books, market trades, the market stream) stay public.
const ownerGate =
  (owner: (c: Parameters<Parameters<typeof app.use>[1]>[0]) => string | undefined) =>
  async (
    c: Parameters<Parameters<typeof app.use>[1]>[0],
    next: Parameters<Parameters<typeof app.use>[1]>[1],
  ) => {
    const wallet = owner(c);
    if (wallet !== undefined) await auth.member(c, wallet);
    await next();
  };
for (const path of ["/positions/:owner", "/balances/:owner", "/payouts/:owner"])
  app.use(
    path,
    ownerGate((c) => c.req.param("owner")),
  );
app.use(
  "/orders",
  ownerGate((c) => c.req.query("maker")),
);
app.use(
  "/trades",
  ownerGate((c) => c.req.query("owner")),
);
app.use(
  "/stream",
  ownerGate((c) => c.req.query("owner")),
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

/** The Polymarket and Kalshi ingestor (POLYMARKET_INGESTOR_URL predates Kalshi). */
const events = () => {
  const url = process.env.POLYMARKET_INGESTOR_URL,
    token = process.env.POLYMARKET_INTERNAL_TOKEN;
  if (!url || !token) throw new HTTPException(503, { message: "Event ingestor is not configured" });
  return new EventMarketsClient(url, token);
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
  events().probability(condition),
);
const prices = new RobinhoodSpotPrices(
  chainId,
  process.env.ROBINHOOD_PRICES_URL || undefined,
  fetch,
  undefined,
  new CoinbaseCryptoPrices(),
);
mountMarketData(app, { indexer, prices, probabilities, events, db });
const recorder = new PriceRecorder({
  indexer,
  prices,
  db,
  // The RFQ hub is created below; the recorder first reads it a minute after start.
  quotes: () => rfq?.prices() ?? [],
  onError: (error) => logger.warn("prices.record.failed", { error }),
});
recorder.start();
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
  auth,
});
const signer = tradingSigner(
  process.env.TRADING_DELEGATE_PRIVATE_KEY,
  process.env.TRADING_DELEGATE_ADDRESS,
);
const prepare = createOrderPlan(indexer);
/** RFQ: approved makers quote market orders over a WebSocket with signed prices, which the
 * order's own transaction fills. The orders go through delegated trading, so the stream exists
 * only with it. */
const rfqWindowMs = whole("RFQ_QUOTE_WINDOW_MS", 500, 5_000);
const rfqMinQuoteSeconds = whole("RFQ_MIN_QUOTE_SECONDS", 3, 300);
const rfq = signer
  ? new RfqHub({
      windowMs: rfqWindowMs,
      maxSessionsPerMaker: whole("RFQ_CONNECTIONS_PER_KEY", 2, 20) || 1,
      welcome: () => ({
        chainId,
        exchange,
        signing: { domain: quoteDomain(chainId, exchange), types: QUOTE_TYPES },
        minQuoteSeconds: rfqMinQuoteSeconds,
      }),
    })
  : null;
const delegated =
  signer &&
  new DelegatedTrading({
    indexer,
    db,
    domain,
    client,
    signer,
    prepare,
    rfq: rfq && {
      hub: rfq,
      chainId,
      minQuoteSeconds: rfqMinQuoteSeconds,
      log: (level, event, fields) => logger[level](event, fields),
    },
  });
mountTrading(app, { indexer, client, auth, prepare, signer, delegated, rfq });
mountRfq(app, {
  db,
  domain,
  auth,
  hub: rfq,
  marketAdmin: () => {
    try {
      return indexer.trading().config.marketAdmin;
    } catch {
      return null;
    }
  },
  trustedHops,
});
mountCustody(app, indexer, client, auth);
mountAdmin(app, { db, indexer, client, chainId, domain, authenticate: auth.bearer, events });
const faucet = mountFaucet(app, {
  secret: process.env.FAUCET_PRIVATE_KEY,
  chainId,
  client,
  indexer,
  db,
  domain,
  auth,
  prices,
  tokens: (process.env.FAUCET_TOKENS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => getAddress(value)),
  gasEth: process.env.FAUCET_GAS_ETH?.trim() || undefined,
});
if (faucet) logger.info("faucet.enabled", { faucet });
const payoutKey = process.env.REFERRAL_PAYOUT_PRIVATE_KEY?.trim();
// A dedicated, separately funded wallet that pays claimed referral rewards (never a role key).
const payout = payoutKey ? privateKeyToAccount(payoutKey as `0x${string}`) : null;
const referrals = new Referrals({
  db,
  indexer,
  client,
  domain,
  config: referralConfig,
  payout,
  probability: async (condition) => {
    const midpoint = ((await probabilities.get(condition)) as { midpointX6?: unknown }).midpointX6;
    return typeof midpoint === "string" && /^[0-9]{1,7}$/.test(midpoint) ? BigInt(midpoint) : null;
  },
  onError: (event, error) => logger.error(event, { error }),
});
referrals.start();
mountInvites(app, {
  db,
  auth,
  referrals,
  marketAdmin: () => {
    try {
      return indexer.trading().config.marketAdmin;
    } catch {
      return null;
    }
  },
});
logger.info("referrals.enabled", {
  ...referralConfig,
  codeQuota,
  inviteOnly,
  payout: payout?.address ?? null,
});

const prune = setInterval(
  () => void db.pruneExpired().catch((error) => logger.error("prune.failed", { error })),
  600_000,
);
const server = Bun.serve({
  idleTimeout: 60,
  hostname: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 3000),
  // The socket peer, for per-client rate limits; the server, to upgrade RFQ streams.
  fetch: (request, bun) => app.fetch(request, { ip: bun.requestIP(request)?.address, server: bun }),
  websocket: {
    ...websocket,
    maxPayloadLength: MAX_MAKER_FRAME,
    // A maker that stops reading is dropped rather than buffered for.
    backpressureLimit: 1 << 20,
    closeOnBackpressureLimit: true,
    idleTimeout: 120,
    sendPings: true,
  },
});
logger.info("api.listening", { url: server.url.toString(), chainId, exchange });
/** Stops accepting connections, lets in-flight requests finish (up to `timeoutMs`), then closes
 * what is left. Bun's own graceful stop never settles once the server has closed a WebSocket (as
 * RFQ revocations and this shutdown do; Bun 1.3.14), so the drain counts requests itself. */
async function drain(timeoutMs: number) {
  void server.stop();
  rfq?.closeAll();
  const until = Date.now() + timeoutMs;
  while (inflight > 0 && Date.now() < until) await Bun.sleep(50);
  await server.stop(true);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(prune);
    recorder.stop();
    referrals.stop();
    // Under pm2's 90 s kill timeout, with room for the index to flush after.
    void drain(60_000)
      .then(() => indexer.stop())
      .then(() => db.close())
      .then(() => process.exit(0));
  });
