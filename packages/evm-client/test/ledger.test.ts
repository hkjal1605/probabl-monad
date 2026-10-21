import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type Address,
  encodeFunctionData,
  keccak256,
  parseSignature,
  signatureToCompactSignature,
  stringToBytes,
  zeroAddress,
  zeroHash,
} from "viem";
import { conditionalStocksAbi } from "../src/abi.ts";
import { underlyingId } from "../src/identity.ts";
import {
  accountOf,
  applyTransaction,
  creditOf,
  decodeLog,
  deserializeState,
  emptyState,
  encodeCheckpoint,
  restoreState,
  StaleCheckpointError,
  serializeState,
  tradeDetails,
  transactions,
} from "../src/ledger.ts";
import {
  makerRebate,
  packMakers,
  packOrder,
  packPlan,
  packQuoteTerms,
  parseOrderKey,
  QUOTE_TYPES,
  quoteDomain,
  resolutionHash,
} from "../src/protocol.ts";
import * as tx from "../src/transactions.ts";
import { type Anvil, accounts, deployProtocol, startAnvil, tokenAbi } from "./anvil.ts";

const T0 = 1_800_000_000n;
const TICK = 10_000n;
const STEP = 10n ** 15n;
const NVDA = 10n ** 18n;

let node: Anvil;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
const users = accounts.slice(1, 5).map((a) => a.address);

async function send(index: number, envelope: tx.Envelope) {
  const wallet = node.wallet(index);
  const hash = await wallet.sendTransaction({
    to: envelope.to,
    data: envelope.data,
    account: accounts[index]!,
  } as never);
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return receipt;
}

function order(
  maker: Address,
  o: {
    branch: number;
    side: number;
    funding: number;
    tif: number;
    ticks: bigint;
    qty: bigint;
    fee?: number;
    market?: number;
  },
  delegate?: Address,
) {
  return {
    maker,
    ...(delegate ? { delegate } : {}),
    marketId: String(o.market ?? 1),
    quantity: o.qty.toString(),
    limitPriceRawX18: (o.ticks * TICK).toString(),
    expiry: (T0 + 86_400n).toString(),
    maxFeeBps: o.fee ?? 100,
    branch: o.branch,
    side: o.side,
    fundingKind: o.funding,
    tif: o.tif,
  };
}

async function nextSeq(branch: number, market = 1) {
  const book = (await node.client.readContract({
    address: protocol.exchange,
    abi: conditionalStocksAbi,
    functionName: "book",
    args: [market],
  })) as { seqYes: number; seqNo: number };
  return BigInt(branch === 0 ? book.seqYes : book.seqNo);
}

async function place(
  index: number,
  o: ReturnType<typeof order>,
  makers: bigint[] = [],
  ioc = false,
) {
  const seq = await nextSeq(o.branch, Number(o.marketId));
  const now = (await node.client.getBlock()).timestamp;
  const plan = packPlan(seq, now + 60n, ioc && makers.length ? STEP : 0n);
  const fn = o.delegate ? "placeFor" : "place";
  const args = o.delegate
    ? [o.maker, packOrder(o, TICK), plan, packMakers(makers)]
    : [packOrder(o, TICK), plan, packMakers(makers)];
  const receipt = await send(index, {
    to: protocol.exchange,
    data: encodeFunctionData({ abi: conditionalStocksAbi, functionName: fn, args } as never),
    value: "0",
  });
  return { receipt, seq };
}

/** A quote signed by account `index` for `taker`, filled up to `fill` by the placement. */
async function signedQuote(
  index: number,
  taker: Address,
  q: {
    branch: number;
    side: number;
    funding: number;
    ticks: bigint;
    qty: bigint;
    market?: number;
  },
  nonce: bigint,
  fill = q.qty,
) {
  const now = (await node.client.getBlock()).timestamp;
  const terms = packQuoteTerms(
    {
      marketId: q.market ?? 1,
      branch: q.branch,
      side: q.side,
      fundingKind: q.funding,
      expiry: now + 60n,
      priceRawX18: q.ticks * TICK,
      quantity: q.qty,
    },
    TICK,
  );
  const signature = await accounts[index]!.signTypedData({
    domain: quoteDomain(31337, protocol.exchange),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: { taker, terms, nonce },
  });
  const { r, yParityAndS } = signatureToCompactSignature(parseSignature(signature));
  return { terms, nonce, fill, r, vs: yParityAndS };
}

/** An immediate-or-cancel order of account `index` taking `quotes` (and `makers` after them). */
async function placeWithQuotes(
  index: number,
  o: ReturnType<typeof order>,
  quotes: Awaited<ReturnType<typeof signedQuote>>[],
  makers: bigint[] = [],
) {
  const seq = await nextSeq(o.branch, Number(o.marketId));
  const now = (await node.client.getBlock()).timestamp;
  return send(index, {
    to: protocol.exchange,
    data: encodeFunctionData({
      abi: conditionalStocksAbi,
      functionName: "placeWithQuotes",
      args: [o.maker, packOrder(o, TICK), packPlan(seq, now + 60n, 0n), packMakers(makers), quotes],
    }),
    value: "0",
  });
}

beforeAll(async () => {
  node = await startAnvil();
  protocol = await deployProtocol(node);
  const { exchange, usdc, stock } = protocol;
  await send(0, tx.listPool(exchange, stock, underlyingId("US:NVDA")));
  const uri = "ipfs://metadata";
  await send(
    0,
    tx.createMarket(
      exchange,
      {
        base: stock,
        condition: keccak256(stringToBytes("condition")),
        yesIndex: 1,
        noIndex: 2,
        rulesHash: keccak256(stringToBytes("rules")),
        metadataHash: keccak256(stringToBytes(uri)),
        open: T0 - 10n,
        cutoff: T0 + 30n * 86_400n,
        tick: TICK,
        step: STEP,
        maxSteps: 1_000_000n,
        minNotional: 1_000_000n,
        maxOrder: 100_000_000_000n,
        maxWallet: 1_000_000_000_000n,
        maxMarket: 10_000_000_000_000n,
        makerBps: 7,
        takerBps: 13,
      },
      uri,
    ),
  );
  await send(
    0,
    tx.lifecycle(
      exchange,
      1,
      0,
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ),
  );
  await send(
    0,
    tx.configure(exchange, {
      marketAdmin: accounts[0]!.address,
      guardian: accounts[0]!.address,
      resolutionAdmin: accounts[0]!.address,
    }),
  );
  for (const [i, user] of users.entries()) {
    const w = node.wallet(i + 1);
    for (const [token, amount] of [
      [usdc, 1_000_000n * 10n ** 6n],
      [stock, 10_000n * NVDA],
    ] as const) {
      await send(0, {
        to: token,
        data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [user, amount] }),
        value: "0",
      });
      await send(i + 1, tx.approve(token, exchange, amount));
      await send(i + 1, tx.deposit(exchange, token, amount));
    }
    void w;
  }
}, 60_000);

afterAll(() => node?.stop());

/** The replica rebuilt from every exchange log so far. */
async function replay() {
  const logs = await node.client.getLogs({
    address: protocol.exchange,
    fromBlock: 0n,
    toBlock: "latest",
  });
  const blocks = new Map<bigint, bigint>();
  for (const log of logs)
    if (!blocks.has(log.blockNumber!))
      blocks.set(
        log.blockNumber!,
        (await node.client.getBlock({ blockNumber: log.blockNumber! })).timestamp,
      );
  const state = emptyState(protocol.usdc);
  const events = logs.map((log) => decodeLog(log, blocks.get(log.blockNumber!)!));
  for (const batch of transactions(events)) applyTransaction(state, batch);
  return { state, events };
}

/** Every owner's held stock claims (cost basis) are its claims plus those its resting
 * claim-funded sells reserve, and never fewer than the priced ones. */
function expectBasesMatchClaims(state: ReturnType<typeof emptyState>) {
  const reserved = new Map<string, bigint>();
  for (const o of state.orders.values())
    if (o.status === "open" && o.fundingKind === 1 && o.side === 1) {
      const key = `${o.market}:${o.branch}:${o.owner}`;
      reserved.set(key, (reserved.get(key) ?? 0n) + o.remaining);
    }
  const keys = new Set([...state.bases.keys(), ...state.accounts.keys(), ...reserved.keys()]);
  for (const key of keys) {
    const basis = state.bases.get(key);
    const held = (state.accounts.get(key)?.base ?? 0n) + (reserved.get(key) ?? 0n);
    expect([key, basis?.held ?? 0n]).toEqual([key, held]);
    if (basis) expect(basis.priced <= basis.held && basis.cost >= 0n).toBe(true);
  }
}

describe("ledger replica", () => {
  test("replaying the log reproduces every on-chain balance, order and book", async () => {
    const { exchange, usdc, stock } = protocol;
    const [alice, bob, carol, dave] = users as [Address, Address, Address, Address];
    // Makers get a third of each taker fee back; the rate changes between fills below.
    await send(0, tx.setMakerRebate(exchange, 1, 3_333));
    // Positions and resting liquidity of every funding kind and side.
    await send(2, tx.position(exchange, "split", 1, 1, 50n * NVDA));
    await send(3, tx.position(exchange, "split", 1, 0, 50_000n * 10n ** 6n));
    const ask1 = await place(
      2,
      order(bob, { branch: 0, side: 1, funding: 1, tif: 0, ticks: 20_000n, qty: 3n * NVDA }),
    );
    const ask2 = await place(
      4,
      order(dave, { branch: 0, side: 1, funding: 0, tif: 0, ticks: 20_100n, qty: 2n * NVDA }),
    );
    const bid1 = await place(
      3,
      order(carol, { branch: 1, side: 0, funding: 1, tif: 0, ticks: 15_000n, qty: 4n * NVDA }),
    );
    const bid2 = await place(
      1,
      order(alice, { branch: 1, side: 0, funding: 0, tif: 0, ticks: 14_990n, qty: 4n * NVDA }),
    );
    // Whole-funded IOC buy across two asks with a partial remainder released.
    await place(
      1,
      order(alice, { branch: 0, side: 0, funding: 0, tif: 1, ticks: 20_100n, qty: 6n * NVDA }),
      [ask1.seq, ask2.seq],
      true,
    );
    // Whole-funded GTC sell across both bids with a resting remainder, at a half rebate.
    await send(0, tx.setMakerRebate(exchange, 1, 5_000));
    await place(
      4,
      order(dave, { branch: 1, side: 1, funding: 0, tif: 0, ticks: 14_000n, qty: 9n * NVDA }),
      [bid1.seq, bid2.seq],
    );
    // Claim-funded taker sell into a fresh bid; improvement-free exact prices; no rebate.
    await send(0, tx.setMakerRebate(exchange, 1, 0));
    await send(1, tx.position(exchange, "split", 1, 1, 5n * NVDA));
    const bid3 = await place(
      3,
      order(carol, {
        branch: 0,
        side: 0,
        funding: 0,
        tif: 0,
        ticks: 19_000n,
        qty: NVDA + STEP * 7n,
      }),
    );
    await place(
      1,
      order(alice, { branch: 0, side: 1, funding: 1, tif: 1, ticks: 18_000n, qty: NVDA }),
      [bid3.seq],
      true,
    );
    await send(0, tx.setMakerRebate(exchange, 1, 2_500));
    // Delegation: charge, delegated resting order, revocation.
    await send(
      1,
      tx.approveDelegate(
        exchange,
        dave,
        {
          market: 0,
          expiresAt: T0 + 7n * 86_400n,
          maxOrderQuote: 10_000n * 10n ** 6n,
          totalQuote: 20_000n * 10n ** 6n,
          maxOrderBase: 100n * 10n ** 18n,
          totalBase: 1_000n * 10n ** 18n,
          maxFeeBps: 100,
          permissions: 3,
        },
        T0,
      ),
    );
    const delegated = await place(
      4,
      order(
        alice,
        { branch: 1, side: 0, funding: 0, tif: 0, ticks: 10_000n, qty: 2n * NVDA },
        dave,
      ),
    );
    // RFQ quotes (at the 25% rebate): Alice buys from Bob's claim-funded quote and Dave's
    // credit-funded one, then sells claim-funded into Bob's credit-funded bid quote; a replayed
    // quote fills nothing.
    const bought = [
      await signedQuote(
        2,
        alice,
        { branch: 0, side: 1, funding: 1, ticks: 20_300n, qty: 2n * NVDA },
        1n,
      ),
      await signedQuote(
        4,
        alice,
        { branch: 0, side: 1, funding: 0, ticks: 20_400n, qty: 5n * NVDA },
        1n,
        NVDA,
      ),
    ];
    await placeWithQuotes(
      1,
      order(alice, { branch: 0, side: 0, funding: 0, tif: 1, ticks: 20_500n, qty: 3n * NVDA }),
      bought,
    );
    await placeWithQuotes(
      1,
      order(alice, { branch: 0, side: 0, funding: 0, tif: 1, ticks: 20_500n, qty: NVDA }),
      [bought[0]!],
    );
    await placeWithQuotes(
      1,
      order(alice, { branch: 0, side: 1, funding: 1, tif: 1, ticks: 19_500n, qty: NVDA }),
      [
        await signedQuote(
          2,
          alice,
          { branch: 0, side: 0, funding: 0, ticks: 19_800n, qty: NVDA },
          2n,
        ),
      ],
    );
    // Atomic requote: cancel and place in one transaction.
    const bid4 = await place(
      3,
      order(carol, { branch: 0, side: 0, funding: 1, tif: 0, ticks: 17_000n, qty: NVDA }),
    );
    const requote = order(carol, {
      branch: 0,
      side: 0,
      funding: 1,
      tif: 0,
      ticks: 17_100n,
      qty: 2n * NVDA,
    });
    const at = (await node.client.getBlock()).timestamp;
    await send(3, {
      to: exchange,
      data: encodeFunctionData({
        abi: conditionalStocksAbi,
        functionName: "replace",
        args: [
          (1n << 40n) | bid4.seq,
          packOrder(requote, TICK),
          packPlan(await nextSeq(0), at + 60n, 0n),
          0n,
        ],
      }),
      value: "0",
    });
    // Cancellation, invalidation, claim transfer, withdrawal.
    await send(3, tx.cancel(exchange, (1n << 40n) | bid3.seq));
    await send(4, tx.cancel(exchange, (1n << 40n) | (1n << 32n) | delegated.seq));
    await send(2, tx.invalidateOrders(exchange));
    await send(2, tx.transferClaim(exchange, 1, 0, 1, carol, NVDA / 2n));
    await send(1, tx.withdraw(exchange, usdc, 1_000n * 10n ** 6n, alice));
    // Resolution and redemption.
    await send(0, tx.lifecycle(exchange, 1, 1, keccak256(stringToBytes("ended"))));
    const evidence = keccak256(stringToBytes("evidence"));
    const uri = "https://evidence.example";
    await send(
      0,
      tx.lifecycle(exchange, 1, 3, resolutionHash(31337, exchange, 1, 1, 0, evidence, uri)),
    );
    await send(0, tx.resolve(exchange, 1, 1, 0, evidence, uri));
    await send(2, tx.redeem(exchange, 1, 1, 2n * NVDA, 0n));
    await send(0, tx.claimFees(exchange, 1, 0, 0, bob, 1n));

    // Extension governance is replayed without state changes (and never stops the index).
    const selector = "0x12345678";
    for (const [functionName, args] of [
      ["proposeExtension", [[selector], stock]],
      ["cancelExtension", [selector]],
    ] as const)
      await send(0, {
        to: exchange,
        data: encodeFunctionData({ abi: conditionalStocksAbi, functionName, args } as never),
        value: "0",
      });

    // Replay.
    const replayed = await replay();
    const events = replayed.events;
    const state = deserializeState(serializeState(replayed.state)); // Checkpoints round-trip.
    // Every fill, split, merge, transfer, redemption, fee claim and cancellation above keeps
    // each owner's cost basis on exactly the stock claims it holds.
    expectBasesMatchClaims(state);
    // Compact checkpoints too, and legacy ones remain readable.
    expect(serializeState(restoreState(encodeCheckpoint(state)))).toBe(serializeState(state));
    expect(serializeState(restoreState(serializeState(state)))).toBe(serializeState(state));
    expect(encodeCheckpoint(state).length).toBeLessThan(serializeState(state).length);

    const read = (functionName: string, args: unknown[]) =>
      node.client.readContract({
        address: exchange,
        abi: conditionalStocksAbi,
        functionName,
        args,
      } as never) as Promise<Record<string, bigint | number | boolean>>;
    for (const user of [alice, bob, carol, dave, accounts[0]!.address]) {
      for (const token of [usdc, stock])
        expect(creditOf(state, user, token)).toBe(
          (await read("credit", [user, token])) as unknown as bigint,
        );
      for (const branch of [0, 1]) {
        const onchain = await read("account", [1, branch, user]);
        const replica = accountOf(state, 1, branch, user);
        expect([replica.quote, replica.base, replica.notional]).toEqual([
          BigInt(onchain.quote!),
          BigInt(onchain.base!),
          BigInt(onchain.notional!),
        ]);
      }
    }
    expect(state.pools.get(stock)!.underlying).toBe(underlyingId("US:NVDA"));
    expect(state.pools.get(usdc)!.underlying).toBe(
      (await read("underlying", [usdc])) as unknown as `0x${string}`,
    );
    expect(state.pools.get(stock)!.underlying).toBe(
      (await read("underlying", [stock])) as unknown as `0x${string}`,
    );
    const market = state.markets.get(1)!;
    const rates = await read("feeRates", [1]);
    expect([market.makerBps, market.takerBps, market.rebateBps]).toEqual([7, 13, 2_500]);
    expect([market.makerBps, market.takerBps, market.rebateBps]).toEqual([
      Number(rates.makerBps),
      Number(rates.takerBps),
      Number(rates.rebateBps),
    ]);
    // Each trade records the rebate its maker got: the rate in force at that fill, applied to
    // the taker's fee (balances and fee pools above match the chain only if every one is right).
    const rebateRates = [3_333, 3_333, 5_000, 5_000, 0];
    const trades = events.filter((e) => e.name === "Trade");
    expect(trades.length).toBe(rebateRates.length);
    for (const [i, e] of trades.entries()) {
      const fees = BigInt(e.args.fees as bigint);
      const takerFee =
        tradeDetails(state, e).takerSide === 0 ? fees & ((1n << 128n) - 1n) : fees >> 128n;
      expect(e.args.makerRebate).toBe(makerRebate(takerFee, rebateRates[i]!));
      expect(tradeDetails(state, e).makerRebate).toBe(String(e.args.makerRebate));
    }
    expect(trades.filter((e) => (e.args.makerRebate as bigint) > 0n).length).toBe(4);
    // Quote fills name their maker and price; their rebates follow the same rate (25%).
    const quoted = events.filter((e) => e.name === "QuoteFilled");
    expect(quoted.map((e) => [tradeDetails(state, e).maker, tradeDetails(state, e).price])).toEqual(
      [
        [bob, (20_300n * TICK).toString()],
        [dave, (20_400n * TICK).toString()],
        [bob, (19_800n * TICK).toString()],
      ],
    );
    for (const e of quoted) {
      const fees = BigInt(e.args.fees as bigint);
      const takerFee =
        tradeDetails(state, e).takerSide === 0 ? fees & ((1n << 128n) - 1n) : fees >> 128n;
      expect(e.args.makerRebate).toBe(makerRebate(takerFee, 2_500));
      expect(e.args.makerRebate as bigint).toBeGreaterThan(0n);
    }
    const book = await read("book", [1]);
    expect([market.openNotional, market.seq[0], market.seq[1]]).toEqual([
      BigInt(book.openNotional!),
      BigInt(book.seqYes!),
      BigInt(book.seqNo!),
    ]);
    expect(market.state).toBe(6);
    const backing = await read("backing", [1]);
    expect([market.backing.quote, market.backing.base]).toEqual([
      BigInt(backing.quote!),
      BigInt(backing.base!),
    ]);
    for (const branch of [0, 1]) {
      const fees = await read("fees", [1, branch]);
      expect([market.fees[branch]!.quote, market.fees[branch]!.base]).toEqual([
        BigInt(fees.quote!),
        BigInt(fees.base!),
      ]);
    }
    for (const token of [usdc, stock]) {
      const pool = await read("pool", [token]);
      expect(state.pools.get(token)!.liability).toBe(BigInt(pool.liability!));
      const balance = await node.client.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [exchange],
      });
      expect(balance).toBe(state.pools.get(token)!.liability);
    }
    for (const [key, o] of state.orders) {
      const [onchain] = (await node.client.readContract({
        address: exchange,
        abi: conditionalStocksAbi,
        functionName: "order",
        args: [BigInt(key)],
      })) as unknown as [{ remaining: bigint }, Address];
      expect(o.status === "open" ? o.remaining : 0n).toBe(BigInt(onchain.remaining));
      expect(parseOrderKey(key).seq).toBe(o.seq);
    }
    const grant = (await read("grant", [alice, dave])) as unknown as {
      remainingQuote: bigint;
      remainingBase: bigint;
    };
    expect(state.grants.get(`${alice}:${dave}`)!.remainingQuote).toBe(BigInt(grant.remainingQuote));
    expect(state.grants.get(`${alice}:${dave}`)!.remainingBase).toBe(BigInt(grant.remainingBase));
    expect(state.orders.size).toBeGreaterThan(5);
    expect(zeroAddress).not.toBe(exchange);
  }, 60_000);
});

describe("stock claims' cost basis", () => {
  test("prices bought claims by the quote paid, through every kind of trade", async () => {
    const { exchange } = protocol;
    const [alice, bob, carol, dave] = users as [Address, Address, Address, Address];
    const M = 2;
    // A market with a 1% taker fee, no maker fee and half of each taker fee back to the maker,
    // so every amount below is exact.
    const now = (await node.client.getBlock()).timestamp;
    await send(
      0,
      tx.createMarket(
        exchange,
        {
          base: protocol.stock,
          condition: keccak256(stringToBytes("basis")),
          yesIndex: 1,
          noIndex: 2,
          rulesHash: keccak256(stringToBytes("rules")),
          metadataHash: keccak256(stringToBytes("ipfs://basis")),
          open: now - 10n,
          cutoff: now + 30n * 86_400n,
          tick: TICK,
          step: STEP,
          maxSteps: 1_000_000n,
          minNotional: 1_000_000n,
          maxOrder: 100_000_000_000n,
          maxWallet: 1_000_000_000_000n,
          maxMarket: 10_000_000_000_000n,
          makerBps: 0,
          takerBps: 100,
        },
        "ipfs://basis",
      ),
    );
    await send(0, tx.lifecycle(exchange, M, 0, zeroHash));
    await send(0, tx.setMakerRebate(exchange, M, 5_000));
    const usd = (n: number) => BigInt(Math.round(n * 1e6));
    const nvda = (n: number) => BigInt(Math.round(n * 1000)) * STEP;
    const ticks = (price: number) => usd(price) / TICK;
    const yes = (o: Omit<Parameters<typeof order>[1], "branch" | "market">) => ({
      ...o,
      branch: 0,
      market: M,
    });

    // Bob splits 10 NVDA: YES and NO claims with no price.
    await send(2, tx.position(exchange, "split", M, 1, nvda(10)));
    // Alice (taker, whole-funded) buys 2 YES at 20 from Bob's claim-funded ask: she gets 1.98
    // (1% fee in claims) for 40; Bob's 2 leave him and the maker's 0.01 rebate comes back.
    const bobAsk = await place(
      2,
      order(bob, yes({ side: 1, funding: 1, tif: 0, ticks: ticks(20), qty: nvda(3) })),
    );
    await place(
      1,
      order(alice, yes({ side: 0, funding: 0, tif: 1, ticks: ticks(20), qty: nvda(2) })),
      [bobAsk.seq],
      true,
    );
    // ...and 1 YES at 22 from Dave's whole-funded ask: 0.99 for 22. Dave keeps 1 NO, unpriced.
    const daveAsk = await place(
      4,
      order(dave, yes({ side: 1, funding: 0, tif: 0, ticks: ticks(22), qty: nvda(1) })),
    );
    await place(
      1,
      order(alice, yes({ side: 0, funding: 0, tif: 1, ticks: ticks(22), qty: nvda(1) })),
      [daveAsk.seq],
      true,
    );
    // Alice sells 1 held YES (claim-funded) at 25 into Carol's resting bid: Carol pays 25 less
    // her 0.125 rebate (half of Alice's 0.25 fee); Alice's average holds.
    const carolBids = [
      await place(
        3,
        order(carol, yes({ side: 0, funding: 0, tif: 0, ticks: ticks(25), qty: nvda(1) })),
      ),
      await place(
        3,
        order(carol, yes({ side: 0, funding: 0, tif: 0, ticks: ticks(25), qty: nvda(1) })),
      ),
    ];
    await place(
      1,
      order(alice, yes({ side: 1, funding: 1, tif: 1, ticks: ticks(25), qty: nvda(1) })),
      [carolBids[0]!.seq],
      true,
    );
    // A whole-funded sell of 1 YES leaves her YES alone and gives her 1 NO, unpriced.
    await place(
      1,
      order(alice, yes({ side: 1, funding: 0, tif: 1, ticks: ticks(25), qty: nvda(1) })),
      [carolBids[1]!.seq],
      true,
    );
    // A claim-funded ask that is cancelled moves nothing.
    const resting = await place(
      1,
      order(alice, yes({ side: 1, funding: 1, tif: 0, ticks: ticks(30), qty: nvda(0.5) })),
    );
    await send(1, tx.cancel(exchange, (BigInt(M) << 40n) | resting.seq));
    // A split (3), a merge (0.5) and a transfer to Dave (0.47).
    await send(1, tx.position(exchange, "split", M, 1, nvda(3)));
    await send(1, tx.position(exchange, "merge", M, 1, nvda(0.5)));
    await send(1, tx.transferClaim(exchange, M, 0, 1, dave, nvda(0.47)));
    // RFQ: Dave buys 1 YES at 21 from Bob's claim-funded quote (0.99 for 21; Bob's 1 leaves him,
    // 0.005 rebate back); Alice sells 1 held YES at 24 into Bob's whole-funded bid quote (Bob pays
    // 24 less his 0.12 rebate).
    await placeWithQuotes(
      4,
      order(dave, yes({ side: 0, funding: 0, tif: 1, ticks: ticks(21), qty: nvda(1) })),
      [
        await signedQuote(
          2,
          dave,
          { branch: 0, side: 1, funding: 1, ticks: ticks(21), qty: nvda(1), market: M },
          11n,
        ),
      ],
    );
    await placeWithQuotes(
      1,
      order(alice, yes({ side: 1, funding: 1, tif: 1, ticks: ticks(24), qty: nvda(1) })),
      [
        await signedQuote(
          2,
          alice,
          { branch: 0, side: 0, funding: 0, ticks: ticks(24), qty: nvda(1), market: M },
          12n,
        ),
      ],
    );

    const { state } = await replay();
    expectBasesMatchClaims(state);
    const basis = (owner: Address, branch: 0 | 1) => state.bases.get(`${M}:${branch}:${owner}`);
    /** Average entry, raw quote per whole share (as the exchange prices). */
    const average = (owner: Address, branch: 0 | 1) => {
      const b = basis(owner, branch)!;
      return (b.cost * 10n ** 18n) / b.priced;
    };

    // Alice bought 1.98 for 40 and 0.99 for 22: 62 for 2.97 (20.8754 each). Two sells of 1, a
    // merge of 0.5 and a transfer of 0.47 took priced and split claims out in proportion; the
    // split's 3 are unpriced. Each outflow keeps the average to within rounding.
    const a = basis(alice, 0)!;
    expect(a.held).toBe(nvda(2.97 - 1 + 3 - 0.5 - 0.47 - 1));
    expect(Number(a.priced) / Number(a.held)).toBeCloseTo(1.97 / 4.97, 9);
    expect(Number(average(alice, 0))).toBeCloseTo(Number((usd(62) * 10n ** 18n) / nvda(2.97)), -1);
    // Her NO claims: 1 from the whole-funded sell and 3 split, less 0.5 merged; none priced.
    expect(basis(alice, 1)).toEqual({ held: nvda(3.5), priced: 0n, cost: 0n });
    // Carol, a resting buyer: 2 claims for 2 x 24.875 (her rebates come off).
    expect(basis(carol, 0)).toEqual({ held: nvda(2), priced: nvda(2), cost: usd(49.75) });
    // Bob: 10 split, 2 sold to Alice (+0.01 rebate), 1 still reserved in his ask, 1 sold by quote
    // (+0.005 rebate), then 1 bought by quote for 24 - 0.12.
    expect(basis(bob, 0)).toEqual({
      held: nvda(10 - 2 + 0.01 - 1 + 0.005 + 1),
      priced: nvda(1),
      cost: usd(23.88),
    });
    // Dave: a 0.005 rebate and 0.47 transferred (unpriced), and 0.99 bought for 21.
    expect(basis(dave, 0)).toEqual({
      held: nvda(0.005 + 0.47 + 0.99),
      priced: nvda(0.99),
      cost: usd(21),
    });
    expect(basis(dave, 1)).toEqual({ held: nvda(1), priced: 0n, cost: 0n });
    // The checkpoint keeps the basis; an older one is rebuilt from the deployment block.
    expect(restoreState(encodeCheckpoint(state)).bases).toEqual(state.bases);
    expect(() => restoreState(encodeCheckpoint(state).replace('{"v":5', '{"v":4'))).toThrow(
      StaleCheckpointError,
    );
  }, 60_000);
});
