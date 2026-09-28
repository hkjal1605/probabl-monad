import { expect, test } from "bun:test";
import { type Address, type Hex, type PublicClient, zeroHash } from "viem";
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
