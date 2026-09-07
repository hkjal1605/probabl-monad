import { db, publicClients } from "ponder:api";
import { createIndexerQueries } from "@conditional-stocks/db/indexer/reads";
import type * as schema from "@conditional-stocks/db/indexer/schema";
import { tokenDecimals } from "@conditional-stocks/domain";
import { canonicalParse, canonicalStringify } from "@conditional-stocks/orderbook";
import { requestLogging } from "@conditional-stocks/shared/http";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Address, erc20Abi, type Hex, isAddress, isHex, zeroHash } from "viem";
import { indexerEnvironment } from "../../ponder.config.ts";
import {
  CanonicalBlockReorged,
  CanonicalBlockUnavailable,
  createCanonicalBlockReader,
} from "../canonical-block.ts";
import { logger } from "../logger.ts";
import { verifiedHead } from "../verified-head.ts";

const app = new Hono();
app.use(
  "*",
  requestLogging(logger, {
    quietPaths: [
      "/indexer/health",
      "/internal/canonical-block/:number",
      "/internal/matcher-events",
      "/internal/reconciliation-snapshot",
      "/internal/settlement-context",
      "/internal/settlement-confirmation",
    ],
  }),
);

const queries = createIndexerQueries(db);
const canonicalBlock = createCanonicalBlockReader(
  queries,
  publicClients.robinhood,
  indexerEnvironment.chainId,
);
const readRawState = queries.readRawState;
const readState = async () => {
  const state = await readRawState();
  try {
    return state
      ? await verifiedHead(state, publicClients.robinhood, indexerEnvironment)
      : undefined;
  } catch {
    throw new HTTPException(503, {
      message: "canonical indexer head unavailable, stale or reorganized",
    });
  }
};

const json = (value: unknown, status = 200): Response =>
  new Response(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
    {
      headers: { "content-type": "application/json; charset=utf-8" },
      status,
    },
  );

const canonicalJson = (value: unknown, status = 200): Response =>
  new Response(canonicalStringify(value), {
    headers: {
      "content-type": "application/vnd.conditional-stocks.canonical+json; version=2; charset=utf-8",
    },
    status,
  });

const parseBigIntParameter = (value: string | undefined, fallback: bigint): bigint => {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("invalid non-negative integer");
  return BigInt(value);
};

const parseIntParameter = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("invalid non-negative integer");
  return parsed;
};

const parseHash = (value: string): Hex | null =>
  isHex(value) && value.length === 66 ? (value.toLowerCase() as Hex) : null;

const canonicalAddress = (value: string): Address => value.toLowerCase() as Address;

const confirmationState = (
  blockNumber: bigint,
  state: typeof schema.indexerState.$inferSelect,
): "observed" | "confirmed" | "finalized" => {
  if (blockNumber <= state.finalizedBlock) return "finalized";
  if (blockNumber <= state.confirmedBlock) return "confirmed";
  return "observed";
};

app.onError((error) =>
  json(
    { error: error.message },
    error instanceof HTTPException
      ? error.status
      : error instanceof CanonicalBlockUnavailable
        ? 503
        : error instanceof CanonicalBlockReorged
          ? 503
          : 400,
  ),
);

app.get("/", (context) =>
  context.json({
    chainId: indexerEnvironment.chainId,
    name: "conditional-stocks-rh-indexer",
    runtime: "ponder",
    version: 2,
  }),
);

app.get("/indexer/health", async () => {
  let state: Awaited<ReturnType<typeof readState>>;
  try {
    state = await readState();
  } catch (error) {
    return json(
      { healthy: false, reason: error instanceof Error ? error.message : "head-unavailable" },
      503,
    );
  }
  if (!state) {
    return json({ healthy: false, reason: "not-indexed" }, 503);
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ageSeconds = now > state.indexedBlockTimestamp ? now - state.indexedBlockTimestamp : 0n;
  return json({
    chainId: indexerEnvironment.chainId,
    exchange: indexerEnvironment.contracts.exchange,
    finalityMode: indexerEnvironment.finalityMode,
    confirmationMode: indexerEnvironment.confirmationMode,
    confirmationBlockCount: indexerEnvironment.confirmationBlockCount,
    finalityBlockCount: indexerEnvironment.finalityBlockCount,
    head: state,
    headAgeSeconds: ageSeconds,
    healthy: true,
    protocolVersion: 2,
    priceFormat: "raw-unit-ratio-x18",
  });
});

app.get("/internal/matcher-events", async (context) => {
  const state = await readState();
  if (!state) return json({ error: "indexer-not-ready" }, 503);

  const afterBlock = parseBigIntParameter(
    context.req.query("afterBlock"),
    BigInt(indexerEnvironment.deploymentBlock) - 1n,
  );
  const afterTransactionIndex = parseIntParameter(context.req.query("afterTransactionIndex"), 0);
  const afterLogIndex = parseIntParameter(context.req.query("afterLogIndex"), 0);
  const requestedLimit = parseIntParameter(context.req.query("limit"), 500);
  const limit = Math.min(Math.max(requestedLimit, 1), 1_000);
  const afterBlockHash = context.req.query("afterBlockHash");

  if (afterBlockHash && afterBlock >= BigInt(indexerEnvironment.deploymentBlock)) {
    const anchor = await canonicalBlock(afterBlock, state);
    if (anchor.hash.toLowerCase() !== afterBlockHash.toLowerCase()) {
      const deploymentBlock = BigInt(indexerEnvironment.deploymentBlock);
      // No guessed common ancestor: replay from before deployment on a cursor mismatch.
      const rewindToBlock = deploymentBlock > 0n ? deploymentBlock - 1n : 0n;
      return canonicalJson(
        {
          canonicalHash: anchor.hash,
          encoding: "conditional-stocks-canonical-json-v1",
          error: "cursor-reorged",
          rewindToBlock,
          schemaVersion: 2,
        },
        409,
      );
    }
  }

  const rows = await queries.matcherEvents({
    afterBlock,
    afterTransactionIndex,
    afterLogIndex,
    confirmedThrough: state.confirmedBlock,
    limit,
  });

  return canonicalJson({
    confirmedThrough: state.confirmedBlock,
    encoding: "conditional-stocks-canonical-json-v1",
    events: rows.map((row) => ({
      cursor: {
        blockHash: row.blockHash,
        blockNumber: row.blockNumber,
        blockTimestamp: row.blockTimestamp,
        chainId: row.chainId,
        logIndex: row.logIndex,
        transactionHash: row.transactionHash,
        transactionIndex: row.transactionIndex,
      },
      event: canonicalParse(row.payload),
    })),
    finalizedThrough: state.finalizedBlock,
    hasMore: rows.length === limit,
    schemaVersion: 2,
  });
});

app.get("/markets", async () => {
  const rows = await queries.markets();
  return json({ markets: rows });
});

app.get("/internal/canonical-block/:number", async (context) => {
  const blockNumber = parseBigIntParameter(context.req.param("number"), 0n);
  const state = await readState();
  if (!state || blockNumber > state.indexedBlock) return json({ error: "block-not-indexed" }, 503);
  const row = await canonicalBlock(blockNumber, state, true);
  return json(row);
});

app.get("/markets/:marketId", async (context) => {
  const marketId = parseHash(context.req.param("marketId"));
  if (!marketId) return json({ error: "invalid-market-id" }, 400);
  const row = await queries.marketById(marketId);
  return row ? json(row) : json({ error: "market-not-found" }, 404);
});

app.get("/orderbook/:marketId", async (context) => {
  const marketId = parseHash(context.req.param("marketId"));
  if (!marketId) return json({ error: "invalid-market-id" }, 400);
  const requestedLimit = parseIntParameter(context.req.query("limit"), 500);
  const limit = Math.min(Math.max(requestedLimit, 1), 2_000);
  const rows = await queries.orderbook(marketId, limit);
  return json({ marketId, orders: rows, truncated: rows.length === limit });
});

app.get("/orders", async (context) => {
  const makerInput = context.req.query("maker");
  const marketIdInput = context.req.query("marketId");
  if (!makerInput && !marketIdInput) {
    return json({ error: "maker or marketId is required" }, 400);
  }
  if (makerInput && !isAddress(makerInput)) return json({ error: "invalid-maker" }, 400);
  const marketId = marketIdInput ? parseHash(marketIdInput) : null;
  if (marketIdInput && !marketId) return json({ error: "invalid-market-id" }, 400);
  const status = context.req.query("status");
  const requestedLimit = parseIntParameter(context.req.query("limit"), 250);
  const limit = Math.min(Math.max(requestedLimit, 1), 1_000);
  const rows = await queries.orders({
    maker: makerInput ? canonicalAddress(makerInput) : null,
    marketId,
    status,
    limit,
  });
  const state = await readState();
  return json({
    orders: rows.map((row) => ({
      ...row,
      confirmation: state ? confirmationState(row.updatedBlock, state) : "observed",
    })),
    truncated: rows.length === limit,
  });
});

app.get("/orders/:orderHash", async (context) => {
  const orderHash = parseHash(context.req.param("orderHash"));
  if (!orderHash) return json({ error: "invalid-order-hash" }, 400);
  const row = await queries.orderByHash(orderHash);
  if (!row) return json({ error: "order-not-found" }, 404);
  const state = await readState();
  return json({
    ...row,
    confirmation: state ? confirmationState(row.updatedBlock, state) : "observed",
  });
});

app.get("/trades", async (context) => {
  const marketIdInput = context.req.query("marketId");
  const marketId = marketIdInput ? parseHash(marketIdInput) : null;
  if (marketIdInput && !marketId) return json({ error: "invalid-market-id" }, 400);
  const limit = Math.min(Math.max(parseIntParameter(context.req.query("limit"), 100), 1), 1_000);
  const rows = await queries.trades(marketId, limit);
  return json({ trades: rows });
});

app.get("/transactions/:transactionHash", async (context) => {
  const transactionHash = parseHash(context.req.param("transactionHash"));
  if (!transactionHash) return json({ error: "invalid-transaction-hash" }, 400);
  const transaction = await queries.transactionByHash(transactionHash);
  if (!transaction) return json({ error: "transaction-not-found" }, 404);
  const state = await readState();
  return json({
    ...transaction,
    confirmation: state ? confirmationState(transaction.blockNumber, state) : "observed",
  });
});

app.get("/balances/:account", async (context) => {
  const input = context.req.param("account");
  if (!isAddress(input)) return json({ error: "invalid-account" }, 400);
  const account = canonicalAddress(input);
  const tokenInput = context.req.query("token");
  if (!tokenInput) {
    return json({
      claims: await queries.claims(account),
      note: "ERC-20 transfer deltas are not tracked; pass ?token=0x… for canonical balanceOf",
      wholeTokenDeltas: null,
    });
  }
  if (!isAddress(tokenInput)) return json({ error: "invalid-token" }, 400);
  const [claims, state] = await Promise.all([queries.claims(account), readState()]);
  if (!state) return json({ error: "indexer-not-ready" }, 503);
  const token = canonicalAddress(tokenInput);
  const canonicalBalance = await publicClients.robinhood.readContract({
    abi: erc20Abi,
    address: token,
    args: [account],
    blockNumber: state.indexedBlock,
    functionName: "balanceOf",
  });
  const decimals = tokenDecimals(
    await publicClients.robinhood.readContract({
      abi: erc20Abi,
      address: token,
      functionName: "decimals",
      blockNumber: state.indexedBlock,
    }),
  );
  return json({
    account,
    decimals,
    blockNumber: state.indexedBlock,
    canonicalBalance,
    claims,
    token,
    wholeTokenDelta: null,
  });
});

app.get("/positions/:account", async (context) => {
  const input = context.req.param("account");
  if (!isAddress(input)) return json({ error: "invalid-account" }, 400);
  const account = canonicalAddress(input);
  const [claims, markets] = await Promise.all([queries.claims(account), queries.markets()]);
  const balances = new Map(claims.map((claim) => [claim.positionId.toString(), claim.amount]));
  return json({
    account,
    positions: markets.map((row) => ({
      baseTokenDecimals: row.baseTokenDecimals,
      quoteTokenDecimals: row.quoteTokenDecimals,
      protocolVersion: row.protocolVersion,
      priceFormat: row.priceFormat,
      conditionId: row.conditionId,
      marketId: row.id,
      quoteNo: row.quoteNoPositionId ? (balances.get(row.quoteNoPositionId.toString()) ?? 0n) : 0n,
      quoteYes: row.quoteYesPositionId
        ? (balances.get(row.quoteYesPositionId.toString()) ?? 0n)
        : 0n,
      redeemable: row.state >= 6,
      stockNo: row.stockNoPositionId ? (balances.get(row.stockNoPositionId.toString()) ?? 0n) : 0n,
      stockYes: row.stockYesPositionId
        ? (balances.get(row.stockYesPositionId.toString()) ?? 0n)
        : 0n,
    })),
  });
});

app.get("/resolutions/:marketId", async (context) => {
  const marketId = parseHash(context.req.param("marketId"));
  if (!marketId) return json({ error: "invalid-market-id" }, 400);
  const row = await queries.resolutionByMarket(marketId);
  return row ? json(row) : json({ error: "resolution-not-found" }, 404);
});

app.get("/internal/reservations", async () => {
  const rows = await queries.reservations();
  return json({ reservations: rows });
});

app.get("/internal/ioc-book", async (context) => {
  const marketId = parseHash(context.req.query("marketId") ?? "");
  const branch = parseIntParameter(context.req.query("branch"), 2);
  const side = parseIntParameter(context.req.query("side"), 2);
  if (!marketId || branch > 1 || side > 1) return json({ error: "invalid-book" }, 400);
  const state = await readState();
  if (!state) return json({ error: "indexer-not-ready" }, 503);
  const anchor = await canonicalBlock(state.confirmedBlock, state);
  const rows = await queries.iocBook({
    marketId,
    branch,
    side,
    confirmedThrough: state.confirmedBlock,
    timestamp: anchor.timestamp,
  });
  return canonicalJson({
    cursor: {
      blockHash: anchor.hash,
      blockNumber: anchor.number,
      blockTimestamp: anchor.timestamp,
      chainId: BigInt(indexerEnvironment.chainId),
      logIndex: 0,
      transactionIndex: 0,
      transactionHash: zeroHash,
    },
    orders: rows.map((row) => ({
      remaining: row.remaining,
      sequence: row.sequence,
      order: {
        marketId: row.marketId,
        maker: row.maker,
        recipient: row.recipient,
        branch: row.branch,
        side: row.side,
        fundingKind: row.fundingKind,
        tif: row.timeInForce,
        quantity: row.quantity,
        limitPriceRawX18: row.limitPriceRawX18,
        nonce: row.nonce,
        salt: row.salt,
        maxFeeBps: row.maxFeeBps,
        expiry: row.expiry,
      },
    })),
  });
});

app.get("/internal/settlement-context", async (context) => {
  const orderHashes = context.req.queries("orderHash") ?? [];
  if (orderHashes.length === 0 || orderHashes.length > 64) {
    return json({ error: "orderHash must contain 1-64 values" }, 400);
  }
  const parsedOrderHashes = orderHashes.map(parseHash);
  if (parsedOrderHashes.some((value) => value === null)) {
    return json({ error: "invalid-order-hash" }, 400);
  }
  const anchorBlock = parseBigIntParameter(context.req.query("anchorBlock"), 0n);
  const anchorHashInput = context.req.query("anchorHash");
  const anchorHash = anchorHashInput ? parseHash(anchorHashInput) : null;
  if (anchorHashInput && !anchorHash) return json({ error: "invalid-anchor-hash" }, 400);

  const [state, orders, protocol] = await Promise.all([
    readState(),
    queries.ordersByHashes(parsedOrderHashes as Hex[]),
    queries.protocolState(),
  ]);
  if (!state) return json({ error: "indexer-not-ready" }, 503);
  const anchor =
    anchorBlock <= state.indexedBlock ? await canonicalBlock(anchorBlock, state) : undefined;
  const marketIds = [...new Set(orders.map((order) => order.marketId))];
  const markets = await queries.marketsByIds(marketIds);
  return json({
    anchorCanonical: anchorHash !== null && anchor?.hash.toLowerCase() === anchorHash.toLowerCase(),
    confirmedThrough: state.confirmedBlock,
    finalizedThrough: state.finalizedBlock,
    marketStates: markets.map((market) => ({ marketId: market.id, state: market.state })),
    orders: orders.map((order) => ({
      id: order.id,
      remaining: order.remaining,
      sequence: order.sequence,
      status: order.status,
    })),
    tradingPaused: protocol?.tradingPaused ?? false,
  });
});

app.get("/internal/settlement-confirmation", async (context) => {
  const transactionHashes = context.req.queries("transactionHash") ?? [];
  if (transactionHashes.length === 0 || transactionHashes.length > 64) {
    return json({ error: "transactionHash must contain 1-64 values" }, 400);
  }
  const parsedHashes = transactionHashes.map(parseHash);
  if (parsedHashes.some((value) => value === null)) {
    return json({ error: "invalid-transaction-hash" }, 400);
  }
  const [state, fills] = await Promise.all([
    readState(),
    queries.fillsByTransactions(parsedHashes as Hex[]),
  ]);
  if (!state) return json({ error: "indexer-not-ready" }, 503);
  return json({
    confirmed: fills.length > 0 && fills.every((fill) => fill.blockNumber <= state.confirmedBlock),
    confirmedThrough: state.confirmedBlock,
    fills: fills.map((fill) => ({
      buyOrderHash: fill.buyOrderHash,
      executionPriceRawX18: fill.executionPriceRawX18,
      fillQuantity: fill.fillQuantity,
      sellOrderHash: fill.sellOrderHash,
      transactionHash: fill.transactionHash,
    })),
  });
});

app.get("/internal/reconciliation-snapshot", async (context) => {
  const deep = context.req.query("deep") === "true";
  const snapshot = await queries.reconciliationSnapshot(deep).catch(() => {
    throw new HTTPException(503, { message: "consistent projection snapshot unavailable; retry" });
  });
  const state = await verifiedHead(snapshot.head, publicClients.robinhood, indexerEnvironment);
  return json({ ...snapshot.rows, state });
});

export default app;
