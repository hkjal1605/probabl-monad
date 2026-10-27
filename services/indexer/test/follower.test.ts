import { expect, setSystemTime, test } from "bun:test";
import { conditionalStocksAbi } from "@conditional-stocks/evm-client";
import {
  type Address,
  encodeEventTopics,
  type Hex,
  type Log,
  type PublicClient,
  zeroHash,
} from "viem";
import { ChainFollower } from "../src/follower.ts";
import { logRangeLimit, mapLimit } from "../src/rpc.ts";

const hash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const header = (n: bigint) => ({
  number: n,
  hash: hash(n),
  parentHash: n > 0n ? hash(n - 1n) : zeroHash,
  timestamp: n,
  logsBloom: `0x${"0".repeat(512)}` as Hex,
  transactions: [],
});
const exchange = "0x00000000000000000000000000000000000000e1" as Address;
const quote = "0x00000000000000000000000000000000000000a1" as Address;

test("sizes eth_getLogs to the provider's stated limit, fills small gaps by header, ignores lagging heads", async () => {
  const spans: bigint[] = [];
  let latest = 10_010n;
  const client = {
    getBlock: async (args?: { blockNumber?: bigint; blockTag?: string }) =>
      header(args?.blockTag === "finalized" ? 10_000n : (args?.blockNumber ?? latest)),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      const span = toBlock - fromBlock + 1n;
      spans.push(span);
      if (span > 1_000n)
        throw new Error(
          `Log response size exceeded. Based on your parameters, this block range should work: [0x${fromBlock.toString(16)}, 0x${(fromBlock + 999n).toString(16)}]`,
        );
      return [];
    },
  } as unknown as PublicClient;
  const follower = new ChainFollower({
    client,
    exchange,
    quote,
    deploymentBlock: 1n,
    domain: "stub",
    logRange: 5_000n,
    pollMs: 60_000,
  });
  await follower.start();
  follower.stop();
  expect(follower.base.block).toBe(10_000n);
  expect(follower.confirmed.block).toBe(10_010n);
  // Two rejected 5,000-block chunks, then exactly ten 1,000-block requests; the ten blocks past
  // the finalized one were read by header only (no transactions, so no eth_getLogs).
  expect(spans.filter((span) => span > 1_000n)).toHaveLength(2);
  expect(spans.filter((span) => span === 1_000n)).toHaveLength(10);
  expect(spans).toHaveLength(12);

  latest = 10_005n;
  await follower.tick();
  expect(follower.confirmed.block).toBe(10_010n);
});

test("reads provider range limits from error messages", () => {
  expect(logRangeLimit(new Error("this block range should work: [0x10, 0x73]"), 5_000n)).toEqual({
    blocks: 100n,
    stated: true,
  });
  expect(logRangeLimit(new Error("eth_getLogs is limited to a 10,000 range"), 50_000n)).toEqual({
    blocks: 10_000n,
    stated: true,
  });
  expect(logRangeLimit(new Error("please limit the query to at most 1000 blocks"), 5_000n)).toEqual(
    { blocks: 1_000n, stated: true },
  );
  expect(logRangeLimit(new Error("query returned more than 10000 results"), 4_000n)).toEqual({
    blocks: 2_000n,
    stated: false,
  });
  expect(logRangeLimit(new Error("execution reverted"), 4_000n)).toBeUndefined();
});

test("maps with bounded concurrency in order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
    peak = Math.max(peak, ++active);
    await Bun.sleep(n);
    active--;
    return n * 10;
  });
  expect(result).toEqual([50, 10, 40, 20, 30]);
  expect(peak).toBe(2);
});

/** A simulated chain behind one endpoint: blocks `seconds` apart, a fixed finalized block, and
 * headers with one transaction and the given logsBloom. Calls are recorded by kind. */
function endpoint(options: { seconds?: bigint; finalized?: bigint; bloom?: (n: bigint) => Hex }) {
  const calls: string[] = [];
  const state = { head: 100n, finalized: options.finalized ?? 100n };
  const block = (n: bigint) => ({
    ...header(n),
    timestamp: 1_000_000n + n * (options.seconds ?? 2n),
    logsBloom: options.bloom?.(n) ?? (`0x${"0".repeat(512)}` as Hex),
    transactions: ["0x01"],
  });
  const client = {
    getBlock: async (args?: { blockNumber?: bigint; blockTag?: string; blockHash?: Hex }) => {
      calls.push(args?.blockTag ?? (args?.blockNumber !== undefined ? "number" : "latest"));
      return block(
        args?.blockTag === "finalized" ? state.finalized : (args?.blockNumber ?? state.head),
      );
    },
    getLogs: async () => {
      calls.push("logs");
      return [];
    },
    getBlockNumber: async () => {
      calls.push("blockNumber");
      return state.head;
    },
  } as unknown as PublicClient;
  return { client, calls, state };
}
const follow = (
  client: PublicClient,
  extra: Partial<ConstructorParameters<typeof ChainFollower>[0]> = {},
) =>
  new ChainFollower({ client, exchange, quote, deploymentBlock: 100n, domain: "stub", ...extra });
const pacing = (f: ChainFollower) => f as unknown as { delay(advanced: boolean): number };

test("paces head polls by the chain's own block interval", async () => {
  const chain = endpoint({ seconds: 2n });
  const f = follow(chain.client);
  await f.start();
  f.stop();
  chain.state.head++;
  expect(await f.tick()).toBe(true);
  expect(f.interval()).toBe(2_000); // Learned from the first new block.
  for (let i = 0; i < 4; i++) {
    chain.state.head += 3n;
    expect(await f.tick()).toBe(true);
  }
  expect(await f.tick()).toBe(false); // No new block.
  expect(f.interval()).toBe(2_000);
  // Due just before the next block after one arrived, then a quarter interval while waiting.
  expect(pacing(f).delay(true)).toBe(Math.round(f.interval() * 0.95));
  expect(pacing(f).delay(false)).toBe(Math.round(f.interval() / 4));
  expect(pacing(follow(chain.client, { pollMs: 700 })).delay(true)).toBe(700);
});

test("backs off finalized-head reads while finality stands still", async () => {
  const chain = endpoint({});
  const f = follow(chain.client, { finalityMs: 1_000, pollMs: 60_000 });
  const t0 = Date.now();
  try {
    setSystemTime(t0);
    await f.start();
    f.stop();
    chain.calls.length = 0;
    const reads = () => chain.calls.filter((c) => c === "finalized").length;
    for (let s = 1; s <= 20; s++) {
      setSystemTime(t0 + s * 1_000);
      chain.state.head++;
      await f.tick();
    }
    // 1 s, then 2, 4, 8 and 8 s apart: 4 reads in 20 s instead of 20.
    expect(reads()).toBe(4);
    // Once it advances, reads return to the base interval.
    chain.state.finalized = chain.state.head - 2n;
    setSystemTime(t0 + 23_000);
    await f.tick();
    expect(reads()).toBe(5);
    expect(f.base.block).toBe(chain.state.finalized);
    setSystemTime(t0 + 24_000);
    await f.tick();
    expect(reads()).toBe(6);
  } finally {
    setSystemTime();
  }
});

test("moves to an endpoint that is ahead when its head stalls", async () => {
  const stuck = endpoint({}),
    fresh = endpoint({});
  const f = follow(stuck.client, { endpoints: [stuck.client, fresh.client] });
  const t0 = Date.now();
  try {
    setSystemTime(t0);
    await f.start();
    f.stop();
    fresh.state.head = 105n;
    for (const s of [10, 20]) {
      setSystemTime(t0 + s * 1_000);
      expect(await f.tick()).toBe(false);
    }
    // Other endpoints are only consulted once the head has stood still for the stall window.
    expect(fresh.calls).not.toContain("blockNumber");
    setSystemTime(t0 + 31_000);
    expect(await f.tick()).toBe(false);
    expect(fresh.calls).toContain("blockNumber");
    expect(await f.tick()).toBe(true);
    expect(f.confirmed.block).toBe(105n);
  } finally {
    setSystemTime();
  }
});

test("skips blocks with an empty bloom once the endpoint is seen to compute blooms", async () => {
  // Bit 0 only: a non-empty bloom that rules the exchange out.
  const other = `0x${"0".repeat(510)}01` as Hex;
  let bloom: Hex = `0x${"0".repeat(512)}`;
  const chain = endpoint({ bloom: () => bloom });
  const f = follow(chain.client, { pollMs: 60_000 });
  await f.start();
  f.stop();
  const logsPerBlock = async () => {
    chain.calls.length = 0;
    chain.state.head++;
    await f.tick();
    return chain.calls.filter((c) => c === "logs").length;
  };
  // Blooms may be zeroed by the chain: untrusted until one is seen computed.
  expect(await logsPerBlock()).toBe(1);
  bloom = other;
  expect(await logsPerBlock()).toBe(0);
  bloom = `0x${"0".repeat(512)}`;
  expect(await logsPerBlock()).toBe(0);
});

test("a poke polls at once and waiters resolve on the block they wait for", async () => {
  let latest = 20n;
  let polls = 0;
  const client = {
    getBlock: async (args?: { blockNumber?: bigint; blockTag?: string }) => {
      if (args?.blockTag === undefined && args?.blockNumber === undefined) polls++;
      return header(args?.blockTag === "finalized" ? 10n : (args?.blockNumber ?? latest));
    },
    getLogs: async () => [],
  } as unknown as PublicClient;
  // A long fixed interval: without a poke the follower would not poll again during the test.
  const follower = new ChainFollower({
    client,
    exchange,
    quote,
    deploymentBlock: 1n,
    domain: "stub",
    pollMs: 60_000,
  });
  await follower.start();
  expect(follower.confirmed.block).toBe(20n);
  await follower.reached(20n, 1_000); // already there
  const before = polls;
  latest = 22n;
  const waiting = follower.reached(22n, 5_000);
  const started = Date.now();
  follower.poke();
  await waiting;
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(follower.confirmed.block).toBe(22n);
  expect(polls).toBe(before + 1);
  // A block that never comes: the wait times out instead of hanging.
  await expect(follower.reached(99n, 50)).rejects.toThrow("did not reach block 99");
  // Stopping releases every waiter.
  const pending = follower.reached(100n, 60_000);
  follower.stop();
  await expect(pending).rejects.toThrow("stopped");
  follower.poke(); // a no-op once stopped
});

test("a log's zero blockTimestamp (Robinhood Chain's nodes send 0x0) falls back to the header", async () => {
  const follower = new ChainFollower({
    client: {
      getBlock: async ({ blockHash }: { blockHash: Hex }) => ({
        hash: blockHash,
        timestamp: 1_800_000_123n,
      }),
    } as unknown as PublicClient,
    exchange,
    quote,
    deploymentBlock: 1n,
    domain: "stub",
  });
  const log = {
    address: exchange,
    topics: encodeEventTopics({ abi: conditionalStocksAbi, eventName: "PauseSet" }),
    // PauseSet(paused = true, reason = 0).
    data: `0x${"0".repeat(63)}1${"0".repeat(64)}` as Hex,
    blockNumber: 7n,
    blockHash: hash(7n),
    logIndex: 0,
    transactionHash: hash(70n),
    transactionIndex: 0,
    removed: false,
    blockTimestamp: "0x0",
  } as unknown as Log;
  const blocks = await (
    follower as unknown as {
      blocksOf(logs: Log[], stamps: Map<Hex, bigint>): Promise<{ block: { timestamp: bigint } }[]>;
    }
  ).blocksOf([log], new Map());
  expect(blocks[0]?.block.timestamp).toBe(1_800_000_123n);
});
