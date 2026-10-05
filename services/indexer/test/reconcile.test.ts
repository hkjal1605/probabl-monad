import { afterAll, beforeAll, expect, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import {
  applyTransaction,
  type ChainState,
  decodeLog,
  emptyState,
  transactions,
} from "@conditional-stocks/evm-client/ledger";
import { createPublicClient, custom, keccak256, type PublicClient, stringToBytes } from "viem";
import {
  type Anvil,
  deployProtocol,
  send,
  startAnvil,
} from "../../../packages/evm-client/test/anvil.ts";
import { reconcile } from "../src/reconcile.ts";

/** Enough markets that one deployless multicall of their reads would pass both limits anvil
 * enforces on eth_call: 49,152 bytes of initcode and 24,576 bytes of returned code. */
const MARKETS = 60;
let node: Anvil;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let state: ChainState;

beforeAll(async () => {
  node = await startAnvil();
  protocol = await deployProtocol(node);
  const { exchange, stock } = protocol;
  await send(node, 0, tx.listPool(exchange, stock, tx.underlyingId("US:NVDA")));
  const now = (await node.client.getBlock()).timestamp;
  for (let i = 0; i < MARKETS; i++)
    await send(
      node,
      0,
      tx.createMarket(
        exchange,
        {
          base: stock,
          condition: keccak256(stringToBytes(`condition-${i}`)),
          yesIndex: 1,
          noIndex: 2,
          rulesHash: keccak256(stringToBytes("rules")),
          metadataHash: keccak256(stringToBytes("ipfs://m")),
          open: now - 10n,
          cutoff: now + 30n * 86_400n,
          tick: 10_000n,
          step: 10n ** 15n,
          maxSteps: 1_000_000n,
          minNotional: 1_000_000n,
          maxOrder: 10n ** 11n,
          maxWallet: 10n ** 12n,
          maxMarket: 10n ** 13n,
          makerBps: i % 11,
          takerBps: i % 13,
        },
        "ipfs://m",
      ),
    );
  // The replica, as the follower builds it from the exchange's logs.
  const logs = await node.client.getLogs({ address: exchange, fromBlock: 0n, toBlock: "latest" });
  const times = new Map<bigint, bigint>();
  for (const log of logs)
    if (!times.has(log.blockNumber!))
      times.set(
        log.blockNumber!,
        (await node.client.getBlock({ blockNumber: log.blockNumber! })).timestamp,
      );
  state = emptyState(protocol.usdc);
  for (const batch of transactions(logs.map((log) => decodeLog(log, times.get(log.blockNumber!)!))))
    applyTransaction(state, batch);
  state.block = await node.client.getBlockNumber();
}, 120_000);

afterAll(() => node?.stop());

/** A client batching contract reads as the API's does, counting its eth_calls. */
function apiClient() {
  const calls: string[] = [];
  const client = createPublicClient({
    chain: node.publicClient.chain,
    batch: { multicall: { deployless: true, batchSize: tx.DEPLOYLESS_BATCH_SIZE, wait: 5 } },
    transport: custom({
      request: ({ method, params }) => {
        calls.push(method);
        return node.publicClient.request({ method, params } as never);
      },
    }),
  }) as PublicClient;
  return { client, eth_calls: () => calls.filter((method) => method === "eth_call").length };
}

test("reconciles every market of a large deployment in the fewest deployless calls", async () => {
  const { client, eth_calls } = apiClient();
  const result = await reconcile(client, protocol.exchange, state);
  expect(result).toMatchObject({ healthy: true, markets: MARKETS, pools: 2, issues: [] });
  // 60 markets x 4 reads and 2 pools x 2 return 58 KB: three eth_calls of up to 22 KB each.
  expect(eth_calls()).toBe(3);
  // A tampered replica still fails closed on the market that differs.
  const market = state.markets.get(37)!;
  market.backing.quote += 1n;
  try {
    const tampered = await reconcile(client, protocol.exchange, state);
    expect(tampered.healthy).toBe(false);
    expect([...tampered.marketIssues.keys()]).toEqual([37]);
  } finally {
    market.backing.quote -= 1n;
  }
}, 60_000);

test("implicit read batches stay within the initcode limit, however small their calls", async () => {
  const { client, eth_calls } = apiClient();
  const counts = await Promise.all(
    Array.from({ length: 300 }, () =>
      client.readContract({
        address: protocol.exchange,
        abi: tx.conditionalStocksAbi,
        functionName: "marketCount",
      }),
    ),
  );
  expect(counts.every((count) => count === MARKETS)).toBe(true);
  // 300 four-byte calls (1,200 raw bytes) would encode to 58 KB in one batch: 90 fit per call.
  expect(eth_calls()).toBe(4);
}, 60_000);
