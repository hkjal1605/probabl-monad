import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Address, encodeFunctionData, keccak256, stringToBytes, zeroAddress } from "viem";
import { conditionalStocksAbi } from "../src/abi.ts";
import { underlyingId } from "../src/identity.ts";
import {
  accountOf,
  applyTransaction,
  creditOf,
  decodeLog,
  deserializeState,
  emptyState,
  serializeState,
  transactions,
} from "../src/ledger.ts";
import { packMakers, packOrder, packPlan, parseOrderKey, resolutionHash } from "../src/protocol.ts";
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
  },
  delegate?: Address,
) {
  return {
    maker,
    ...(delegate ? { delegate } : {}),
    marketId: "1",
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

async function nextSeq(branch: number) {
  const book = (await node.client.readContract({
    address: protocol.exchange,
    abi: conditionalStocksAbi,
    functionName: "book",
    args: [1],
  })) as { seqYes: number; seqNo: number };
  return BigInt(branch === 0 ? book.seqYes : book.seqNo);
}

async function place(
  index: number,
  o: ReturnType<typeof order>,
  makers: bigint[] = [],
  ioc = false,
) {
  const seq = await nextSeq(o.branch);
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
    tx.configure(
      exchange,
      {
        marketAdmin: accounts[0]!.address,
        guardian: accounts[0]!.address,
        resolutionAdmin: accounts[0]!.address,
      },
      7,
      13,
    ),
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

describe("ledger replica", () => {
  test("replaying the log reproduces every on-chain balance, order and book", async () => {
    const { exchange, usdc, stock } = protocol;
    const [alice, bob, carol, dave] = users as [Address, Address, Address, Address];
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
    // Whole-funded GTC sell across both bids with a resting remainder.
    await place(
      4,
      order(dave, { branch: 1, side: 1, funding: 0, tif: 0, ticks: 14_000n, qty: 9n * NVDA }),
      [bid1.seq, bid2.seq],
    );
    // Claim-funded taker sell into a fresh bid; improvement-free exact prices.
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
    const logs = await node.client.getLogs({ address: exchange, fromBlock: 0n, toBlock: "latest" });
    const blocks = new Map<bigint, bigint>();
    for (const log of logs)
      if (!blocks.has(log.blockNumber!))
        blocks.set(
          log.blockNumber!,
          (await node.client.getBlock({ blockNumber: log.blockNumber! })).timestamp,
        );
    let state = emptyState(usdc);
    const events = logs.map((log) => decodeLog(log, blocks.get(log.blockNumber!)!));
    for (const batch of transactions(events)) applyTransaction(state, batch);
    state = deserializeState(serializeState(state)); // Checkpoints round-trip exactly.

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
    const grant = (await read("grant", [alice, dave])) as unknown as { remainingQuote: bigint };
    expect(state.grants.get(`${alice}:${dave}`)!.remainingQuote).toBe(BigInt(grant.remainingQuote));
    expect(state.orders.size).toBeGreaterThan(5);
    expect(zeroAddress).not.toBe(exchange);
  }, 60_000);
});
