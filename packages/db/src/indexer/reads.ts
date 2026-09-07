import { and, asc, desc, eq, gt, inArray, lte, type ReadonlyDrizzle, sql } from "ponder";
import type { Address, Hex } from "viem";
import * as schema from "./schema.ts";
import { readReconciliationSnapshot } from "./snapshot.ts";

/** Inject Ponder's read-only connection; do not create an independent pool or bypass finality. */
export function createIndexerQueries(db: ReadonlyDrizzle<typeof schema>) {
  const readRawState = () =>
    db.query.indexerState.findFirst({ where: eq(schema.indexerState.id, "canonical") });
  const canonicalBlock = (number: bigint) =>
    db.query.chainBlock.findFirst({ where: eq(schema.chainBlock.number, number) });
  const marketById = (id: Hex) => db.query.market.findFirst({ where: eq(schema.market.id, id) });
  const orderByHash = (id: Hex) => db.query.order.findFirst({ where: eq(schema.order.id, id) });
  const transactionByHash = (hash: Hex) =>
    db.query.chainTransaction.findFirst({ where: eq(schema.chainTransaction.hash, hash) });
  const resolutionByMarket = (marketId: Hex) =>
    db.query.resolution.findFirst({ where: eq(schema.resolution.marketId, marketId) });
  const protocolState = () =>
    db.query.protocolState.findFirst({ where: eq(schema.protocolState.id, "v1") });
  const markets = () => db.select().from(schema.market).orderBy(desc(schema.market.createdBlock));
  const marketsByIds = (ids: Hex[]) =>
    ids.length
      ? db.select().from(schema.market).where(inArray(schema.market.id, ids))
      : Promise.resolve([]);
  const ordersByHashes = (hashes: Hex[]) =>
    db.select().from(schema.order).where(inArray(schema.order.id, hashes));
  const claims = (account: Address) =>
    db.select().from(schema.claimBalance).where(eq(schema.claimBalance.account, account));

  function matcherEvents(input: {
    afterBlock: bigint;
    afterTransactionIndex: number;
    afterLogIndex: number;
    confirmedThrough: bigint;
    limit: number;
  }) {
    // One composite range seek instead of filtering/sorting an OR over the event history.
    const strictlyAfterCursor = sql`(${schema.matcherEvent.blockNumber}, ${schema.matcherEvent.transactionIndex}, ${schema.matcherEvent.logIndex}) > (${input.afterBlock}, ${input.afterTransactionIndex}, ${input.afterLogIndex})`;
    return db
      .select()
      .from(schema.matcherEvent)
      .where(and(lte(schema.matcherEvent.blockNumber, input.confirmedThrough), strictlyAfterCursor))
      .orderBy(
        asc(schema.matcherEvent.blockNumber),
        asc(schema.matcherEvent.transactionIndex),
        asc(schema.matcherEvent.logIndex),
      )
      .limit(input.limit);
  }

  function orderbook(marketId: Hex, limit: number) {
    return db
      .select()
      .from(schema.order)
      .where(and(eq(schema.order.marketId, marketId), eq(schema.order.status, "open")))
      .orderBy(
        asc(schema.order.branch),
        asc(schema.order.side),
        desc(schema.order.limitPriceRawX18),
        asc(schema.order.sequence),
      )
      .limit(limit);
  }

  function orders(input: {
    maker: Address | null;
    marketId: Hex | null;
    status: string | undefined;
    limit: number;
  }) {
    return db
      .select()
      .from(schema.order)
      .where(
        and(
          input.maker ? eq(schema.order.maker, input.maker) : undefined,
          input.marketId ? eq(schema.order.marketId, input.marketId) : undefined,
          input.status ? eq(schema.order.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(schema.order.updatedBlock), desc(schema.order.sequence))
      .limit(input.limit);
  }

  function trades(marketId: Hex | null, limit: number) {
    return db
      .select()
      .from(schema.fill)
      .where(marketId ? eq(schema.fill.marketId, marketId) : undefined)
      .orderBy(desc(schema.fill.blockNumber), desc(schema.fill.logIndex))
      .limit(limit);
  }

  function reservations() {
    return db
      .select()
      .from(schema.reservation)
      .where(gt(schema.reservation.amount, 0n))
      .orderBy(asc(schema.reservation.assetAddress), asc(schema.reservation.tokenId));
  }

  function iocBook(input: {
    marketId: Hex;
    branch: number;
    side: number;
    confirmedThrough: bigint;
    timestamp: bigint;
  }) {
    return db
      .select()
      .from(schema.order)
      .where(
        and(
          eq(schema.order.marketId, input.marketId),
          eq(schema.order.branch, input.branch),
          eq(schema.order.side, input.side),
          eq(schema.order.status, "open"),
          eq(schema.order.timeInForce, 0),
          lte(schema.order.updatedBlock, input.confirmedThrough),
          gt(schema.order.expiry, input.timestamp),
        ),
      )
      .orderBy(
        input.side === 0 ? desc(schema.order.limitPriceRawX18) : asc(schema.order.limitPriceRawX18),
        asc(schema.order.sequence),
      )
      .limit(32);
  }

  function fillsByTransactions(hashes: Hex[]) {
    return db
      .select()
      .from(schema.fill)
      .where(inArray(schema.fill.transactionHash, hashes))
      .orderBy(asc(schema.fill.blockNumber), asc(schema.fill.logIndex));
  }

  async function reconciliationSnapshot(deep: boolean) {
    return readReconciliationSnapshot(db, deep);
  }

  return {
    readRawState,
    canonicalBlock,
    marketById,
    orderByHash,
    transactionByHash,
    resolutionByMarket,
    protocolState,
    markets,
    marketsByIds,
    ordersByHashes,
    claims,
    matcherEvents,
    orderbook,
    orders,
    trades,
    reservations,
    iocBook,
    fillsByTransactions,
    reconciliationSnapshot,
  };
}

export type IndexerQueries = ReturnType<typeof createIndexerQueries>;
