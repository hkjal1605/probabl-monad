import { expect, test } from "bun:test";
import { encodeFunctionData, type Hex, multicall3Abi } from "viem";
import { conditionalStocksAbi } from "../src/abi.ts";
import { type ContractCall, DEPLOYLESS_BATCH_SIZE, deploylessChunks } from "../src/multicall.ts";

const exchange = "0x00000000000000000000000000000000000000e1";
const bytes = (hex: Hex) => (hex.length - 2) / 2;
/** Encoded `aggregate3` calls of a chunk, without the 68-byte head: what the request budget
 * bounds. */
const requested = (calls: readonly ContractCall[]) =>
  bytes(
    encodeFunctionData({
      abi: multicall3Abi,
      functionName: "aggregate3",
      args: [
        calls.map((call) => ({
          target: call.address,
          allowFailure: false,
          callData: encodeFunctionData(call as never),
        })),
      ],
    }),
  ) - 68;
/** Encoded results of `book` (an 8-word struct) and `fees` (2 words): 128 bytes each plus the
 * returned words. */
const returned = (calls: readonly ContractCall[]) =>
  calls.reduce((sum, call) => sum + 128 + (call.functionName === "book" ? 256 : 64), 0);
const call = (functionName: string, args?: unknown[]): ContractCall => ({
  address: exchange,
  abi: conditionalStocksAbi,
  functionName,
  ...(args ? { args } : {}),
});

test("deployless chunks fit both limits and are as few as fit", () => {
  // Reconciliation's shapes: book (8-word result) and fees (2-word result).
  const calls = Array.from({ length: 600 }, (_, i) =>
    i % 2 ? call("fees", [i, 1]) : call("book", [i]),
  );
  const chunks = deploylessChunks(calls);
  expect(chunks.flat()).toEqual(calls);
  // Within 40 KB of calls (Multicall3 and its wrapper take 6.2 KB of the 49,152-byte initcode)
  // and 22 KB of results (of the 24,576 bytes a deployless call can return).
  for (const chunk of chunks) {
    expect(requested(chunk)).toBeLessThanOrEqual(40_000);
    expect(returned(chunk)).toBeLessThanOrEqual(22_000);
  }
  // Greedy and in order: no chunk could also hold the next one's first call.
  for (let i = 1; i < chunks.length; i++) {
    const grown = [...chunks[i - 1]!, chunks[i]![0]!];
    expect(requested(grown) > 40_000 || returned(grown) > 22_000).toBe(true);
  }
  expect(deploylessChunks([])).toEqual([]);
});

test("reads of dynamic data cannot be sized for a deployless call", () => {
  expect(() => deploylessChunks([call("restingOrders", [[1n]])])).toThrow("dynamic data");
});

test("an implicit batch of up to DEPLOYLESS_BATCH_SIZE raw bytes fits, for reads of up to 4 words", () => {
  // Selector-only calls expand the most: 4 raw bytes encode to 192.
  const selectors = Array.from({ length: DEPLOYLESS_BATCH_SIZE / 4 }, () => call("marketCount"));
  expect(requested(selectors)).toBeLessThanOrEqual(40_000);
  // Each result of up to 4 words takes at most 256 bytes; the result array adds 64.
  expect(64 + selectors.length * 256).toBeLessThanOrEqual(24_576);
});
