/** The keeper's vault read against a real exchange and Δ-vault on anvil, past the markets that fit
 * one deployless multicall. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import {
  createPublicClient,
  custom,
  keccak256,
  type PublicClient,
  stringToBytes,
  zeroHash,
} from "viem";
import {
  type Anvil,
  deployDeltaVault,
  deployProtocol,
  openMarket,
  send,
  startAnvil,
} from "../../../packages/evm-client/test/anvil.ts";
import { readVaultView, type VaultIdentity } from "../src/vault.ts";

const NOW = 1_800_000_000n;
const MARKETS = 20;
let node: Anvil;
let identity: VaultIdentity;

beforeAll(async () => {
  node = await startAnvil(Number(NOW));
  const protocol = await deployProtocol(node);
  await openMarket(node, protocol, NOW);
  for (let id = 2; id <= MARKETS; id++) {
    await send(
      node,
      0,
      tx.createMarket(
        protocol.exchange,
        {
          base: protocol.stock,
          condition: keccak256(stringToBytes(`condition-${id}`)),
          yesIndex: 1,
          noIndex: 2,
          rulesHash: keccak256(stringToBytes("rules")),
          metadataHash: keccak256(stringToBytes("ipfs://m")),
          open: NOW - 10n,
          cutoff: NOW + 30n * 86_400n,
          tick: 10_000n,
          step: 10n ** 15n,
          maxSteps: 1_000_000n,
          minNotional: 1_000_000n,
          maxOrder: 10n ** 11n,
          maxWallet: 10n ** 12n,
          maxMarket: 10n ** 13n,
          makerBps: 0,
          takerBps: 0,
        },
        "ipfs://m",
      ),
    );
    await send(node, 0, tx.lifecycle(protocol.exchange, id, 0, zeroHash));
  }
  const { vault } = await deployDeltaVault(node, protocol, NOW);
  await send(node, 0, tx.deltaVaultGrantRole(vault, "curator", protocol.admin));
  for (let id = 1; id <= MARKETS; id++)
    await send(
      node,
      0,
      tx.deltaVaultAddMarket(vault, id, {
        bandBps: 1000,
        cutoffBuffer: 3600,
        maxOrder: 10n ** 10n,
        maxResting: 10n ** 11n,
        maxImbalance: BigInt(id) * 10n ** 18n,
      }),
    );
  identity = {
    address: vault,
    exchange: protocol.exchange,
    quote: protocol.usdc,
    base: protocol.stock,
  };
}, 120_000);
afterAll(() => node?.stop());

test("a vault past one multicall's markets reads in concurrent chunks", async () => {
  const calls: string[] = [];
  const counting = createPublicClient({
    chain: node.publicClient.chain,
    transport: custom({
      request: ({ method, params }) => {
        calls.push(method);
        return node.publicClient.request({ method, params } as never);
      },
    }),
  }) as PublicClient;
  // First read: the market set is new, so every market's terms follow (16 per call).
  const cold = await readVaultView(counting, identity, []);
  expect(cold.markets.map((m) => m.market)).toEqual(
    Array.from({ length: MARKETS }, (_, i) => i + 1),
  );
  expect(cold.markets.map((m) => m.risk.maxImbalance)).toEqual(
    Array.from({ length: MARKETS }, (_, i) => BigInt(i + 1) * 10n ** 18n),
  );
  expect(calls).toEqual(["eth_call", "eth_call", "eth_call"]);
  // Unchanged: eight markets ride with the snapshot, the other twelve in one concurrent call.
  calls.length = 0;
  const warm = await readVaultView(
    counting,
    identity,
    cold.markets.map((m) => m.market),
  );
  expect(warm.markets).toEqual(cold.markets);
  expect(calls).toEqual(["eth_call", "eth_call"]);
}, 60_000);
