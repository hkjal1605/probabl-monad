import {
  findMarket,
  findNonceFloor,
  findOrder,
  insertFill,
  insertOrder,
  insertReservation,
  persistMatcherEvent,
  persistProtocolEvent,
  quoteUp,
  updateMarketInterest,
  updateOrder,
  updateReservation,
  updateWalletInterest,
  upsertNonceFloor,
  upsertProtocolState,
} from "@conditional-stocks/db/indexer/writes";
import { ponder } from "../observability.ts";

ponder.on("ConditionalExchange:OrderOpened", async ({ event, context }) => {
  if (
    !(await persistProtocolEvent(
      context.db,
      context.chain.id,
      "ConditionalExchange",
      "OrderOpened",
      event,
    ))
  ) {
    return;
  }
  const args = event.args;
  const marketRow = await findMarket(context.db, args.marketId);
  if (!marketRow) throw new Error(`order references unknown market ${args.marketId}`);

  const openNotional = quoteUp(args.quantity, args.limitPriceRawX18);
  await insertOrder(context.db, {
    id: args.orderHash,
    branch: args.branch,
    cancelReasonHash: null,
    expiry: args.expiry,
    fundingKind: args.fundingKind,
    initialReserved: args.reserved,
    limitPriceRawX18: args.limitPriceRawX18,
    maxFeeBps: args.maxFeeBps,
    feesPaid: 0n,
    maker: args.maker,
    marketId: args.marketId,
    nonce: args.nonce,
    openedBlock: event.block.number,
    openNotional,
    quantity: args.quantity,
    recipient: args.recipient,
    remaining: args.quantity,
    reserved: args.reserved,
    salt: args.salt,
    sequence: args.sequence,
    side: args.side,
    status: "open",
    timeInForce: args.tif,
    updatedBlock: event.block.number,
  });

  const activePositionId =
    args.side === 0
      ? args.branch === 0
        ? marketRow.quoteYesPositionId
        : marketRow.quoteNoPositionId
      : args.branch === 0
        ? marketRow.stockYesPositionId
        : marketRow.stockNoPositionId;
  if (args.fundingKind === 1 && activePositionId === null) {
    throw new Error(`claim-funded order references incomplete market ${args.marketId}`);
  }
  await insertReservation(context.db, {
    orderHash: args.orderHash,
    amount: args.reserved,
    assetAddress: args.side === 0 ? marketRow.quoteToken : marketRow.baseToken,
    fundingKind: args.fundingKind,
    maker: args.maker,
    marketId: args.marketId,
    tokenId: args.fundingKind === 1 ? activePositionId : null,
    updatedBlock: event.block.number,
  });
  await updateMarketInterest(context.db, args.marketId, openNotional, event.block.number);
  await updateWalletInterest(
    context.db,
    args.marketId,
    args.maker,
    openNotional,
    event.block.number,
  );
  await persistMatcherEvent(context.db, context.chain.id, event, "order-opened", {
    order: {
      branch: args.branch,
      expiry: args.expiry,
      fundingKind: args.fundingKind,
      limitPriceRawX18: args.limitPriceRawX18,
      maxFeeBps: args.maxFeeBps,
      maker: args.maker,
      marketId: args.marketId,
      nonce: args.nonce,
      quantity: args.quantity,
      recipient: args.recipient,
      salt: args.salt,
      side: args.side,
      tif: args.tif,
    },
    orderHash: args.orderHash,
    reserved: args.reserved,
    sequence: args.sequence,
    type: "order-opened",
  });
});

ponder.on("ConditionalExchange:OrderCancelled", async ({ event, context }) => {
  if (
    !(await persistProtocolEvent(
      context.db,
      context.chain.id,
      "ConditionalExchange",
      "OrderCancelled",
      event,
    ))
  ) {
    return;
  }
  const args = event.args;
  const current = await findOrder(context.db, args.orderHash);
  if (current?.status !== "open") {
    throw new Error(`cancel references non-open order ${args.orderHash}`);
  }
  if (
    current.maker.toLowerCase() !== args.maker.toLowerCase() ||
    current.remaining !== args.unfilledQuantity ||
    current.reserved !== args.releasedAmount
  ) {
    throw new Error(`cancel accounting mismatch for ${args.orderHash}`);
  }
  await updateOrder(context.db, args.orderHash, {
    cancelReasonHash: args.reasonHash,
    openNotional: 0n,
    remaining: 0n,
    reserved: 0n,
    status: "cancelled",
    updatedBlock: event.block.number,
  });
  await updateReservation(context.db, args.orderHash, {
    amount: 0n,
    updatedBlock: event.block.number,
  });
  await updateMarketInterest(
    context.db,
    current.marketId,
    -current.openNotional,
    event.block.number,
  );
  await updateWalletInterest(
    context.db,
    current.marketId,
    current.maker,
    -current.openNotional,
    event.block.number,
  );
  await persistMatcherEvent(context.db, context.chain.id, event, "order-cancelled", {
    maker: args.maker,
    orderHash: args.orderHash,
    reasonHash: args.reasonHash,
    releasedAmount: args.releasedAmount,
    type: "order-cancelled",
    unfilledQuantity: args.unfilledQuantity,
  });
});

ponder.on("ConditionalExchange:OrderFilled", async ({ event, context }) => {
  if (
    !(await persistProtocolEvent(
      context.db,
      context.chain.id,
      "ConditionalExchange",
      "OrderFilled",
      event,
    ))
  ) {
    return;
  }
  const args = event.args;
  const buy = await findOrder(context.db, args.buyOrderHash);
  const sell = await findOrder(context.db, args.sellOrderHash);
  if (!buy || !sell || buy.status !== "open" || sell.status !== "open") {
    throw new Error(`fill references non-open orders ${args.buyOrderHash}/${args.sellOrderHash}`);
  }
  if (
    buy.marketId !== args.marketId ||
    sell.marketId !== args.marketId ||
    buy.branch !== args.branch ||
    sell.branch !== args.branch ||
    args.fillQuantity > buy.remaining ||
    args.fillQuantity > sell.remaining ||
    args.fillQuantity <= 0n ||
    args.executionQuote !== (args.fillQuantity * args.executionPriceRawX18) / 10n ** 18n ||
    args.executionQuote === 0n
  ) {
    throw new Error(`fill accounting mismatch in ${event.transaction.hash}`);
  }

  const buyRemaining = buy.remaining - args.fillQuantity;
  const sellRemaining = sell.remaining - args.fillQuantity;
  const buyReserved = quoteUp(buyRemaining, buy.limitPriceRawX18);
  const buyOpenNotional = buyReserved;
  const sellOpenNotional = quoteUp(sellRemaining, sell.limitPriceRawX18);
  const sellReserved = sellRemaining;
  await updateOrder(context.db, buy.id, {
    openNotional: buyOpenNotional,
    remaining: buyRemaining,
    reserved: buyReserved,
    status: buyRemaining === 0n ? "filled" : "open",
    updatedBlock: event.block.number,
  });
  await updateOrder(context.db, sell.id, {
    openNotional: sellOpenNotional,
    remaining: sellRemaining,
    reserved: sellReserved,
    status: sellRemaining === 0n ? "filled" : "open",
    updatedBlock: event.block.number,
  });
  await updateReservation(context.db, buy.id, {
    amount: buyReserved,
    updatedBlock: event.block.number,
  });
  await updateReservation(context.db, sell.id, {
    amount: sellReserved,
    updatedBlock: event.block.number,
  });
  await updateMarketInterest(
    context.db,
    args.marketId,
    -(buy.openNotional - buyOpenNotional) - (sell.openNotional - sellOpenNotional),
    event.block.number,
  );
  await updateWalletInterest(
    context.db,
    args.marketId,
    buy.maker,
    -(buy.openNotional - buyOpenNotional),
    event.block.number,
  );
  await updateWalletInterest(
    context.db,
    args.marketId,
    sell.maker,
    -(sell.openNotional - sellOpenNotional),
    event.block.number,
  );
  await insertFill(context.db, {
    id: event.id,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    branch: args.branch,
    buyOrderHash: args.buyOrderHash,
    executionPriceRawX18: args.executionPriceRawX18,
    executionQuote: args.executionQuote,
    fillQuantity: args.fillQuantity,
    logIndex: event.log.logIndex,
    makerOrderHash: args.makerOrderHash,
    marketId: args.marketId,
    sellOrderHash: args.sellOrderHash,
    transactionHash: event.transaction.hash,
  });
  await persistMatcherEvent(context.db, context.chain.id, event, "order-filled", {
    branch: args.branch,
    buyOrderHash: args.buyOrderHash,
    executionPriceRawX18: args.executionPriceRawX18,
    executionQuote: args.executionQuote,
    fillQuantity: args.fillQuantity,
    makerOrderHash: args.makerOrderHash,
    marketId: args.marketId,
    sellOrderHash: args.sellOrderHash,
    type: "order-filled",
  });
});

ponder.on("ConditionalExchange:NonceInvalidated", async ({ event, context }) => {
  if (
    !(await persistProtocolEvent(
      context.db,
      context.chain.id,
      "ConditionalExchange",
      "NonceInvalidated",
      event,
    ))
  ) {
    return;
  }
  const args = event.args;
  const current = await findNonceFloor(context.db, args.maker);
  if ((current?.minimumNonce ?? 0n) !== args.oldMinimumNonce) {
    throw new Error(`nonce discontinuity for ${args.maker}`);
  }
  await upsertNonceFloor(context.db, {
    maker: args.maker,
    minimumNonce: args.newMinimumNonce,
    updatedBlock: event.block.number,
  });
  await persistMatcherEvent(context.db, context.chain.id, event, "nonce-invalidated", {
    maker: args.maker,
    newMinimumNonce: args.newMinimumNonce,
    oldMinimumNonce: args.oldMinimumNonce,
    type: "nonce-invalidated",
  });
});

ponder.on("ConditionalExchange:EmergencyPauseChanged", async ({ event, context }) => {
  if (
    !(await persistProtocolEvent(
      context.db,
      context.chain.id,
      "ConditionalExchange",
      "EmergencyPauseChanged",
      event,
    ))
  ) {
    return;
  }
  const args = event.args;
  await upsertProtocolState(context.db, {
    id: "v1",
    pauseCaller: args.caller,
    pauseReasonHash: args.reasonHash,
    tradingPaused: args.paused,
    updatedBlock: event.block.number,
  });
  await persistMatcherEvent(context.db, context.chain.id, event, "emergency-pause-changed", {
    paused: args.paused,
    reasonHash: args.reasonHash,
    type: "emergency-pause-changed",
  });
});

for (const [eventName, configuredField] of [
  ["SettlementConfigured", "settlement"],
  ["OrderValidatorConfigured", "validator"],
  ["IocRouterConfigured", "router"],
] as const) {
  ponder.on(`ConditionalExchange:${eventName}`, async ({ event, context }) => {
    const args = event.args as unknown as Record<string, unknown>;
    if (!(configuredField in args)) {
      throw new Error(`invalid ${eventName} arguments`);
    }
    await persistProtocolEvent(
      context.db,
      context.chain.id,
      "ConditionalExchange",
      eventName,
      event,
    );
  });
}
