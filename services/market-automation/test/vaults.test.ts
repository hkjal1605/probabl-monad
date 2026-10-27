import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import { Logger } from "@conditional-stocks/shared";
import {
  type Address,
  decodeFunctionData,
  getAddress,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type Anvil,
  deployDeltaVault,
  deployProtocol,
  openMarket,
  send,
  startAnvil,
} from "../../../packages/evm-client/test/anvil.ts";
import { type Admin, FROZEN, type Market, OPEN, SCHEDULED } from "../src/admin.ts";
import { curateVaults } from "../src/jobs/curate-vaults.ts";
import { CuratedVault, type RiskTemplate } from "../src/vaults.ts";
import type { KalshiApi } from "../src/venues/kalshi-api.ts";

const VAULT = getAddress("0x00000000000000000000000000000000000000a1");
const NVDA = getAddress("0x00000000000000000000000000000000000000b1");
const TSLA = getAddress("0x00000000000000000000000000000000000000b2");
const USDC = getAddress("0x00000000000000000000000000000000000000c1");
const curator = privateKeyToAccount(`0x${"11".repeat(32)}`);
const logger = new Logger({ service: "test", level: "silent" });
const now = () => Math.floor(Date.now() / 1000);
const template: RiskTemplate = {
  bandBps: 1000,
  cutoffBufferSeconds: 3600,
  maxOrderQuote: "2000",
  maxRestingQuote: "10000",
  maxImbalanceBase: "100",
};

/** A vault on NVDA (18 decimals) quoting USDC (6) with `listed` registered and room for
 * `capacity`, recording every market the curator adds. */
async function vaultOf(listed: number[], capacity = 48, curatorRole = true) {
  const added: { market: number; risk: Record<string, unknown> }[] = [];
  const reads: Record<string, unknown> = {
    BASE: NVDA,
    QUOTE: USDC,
    MAX_MARKETS: BigInt(capacity),
    hasRole: curatorRole,
    markets: listed,
  };
  const client = {
    chain: undefined,
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) =>
      functionName === "decimals" ? (address === NVDA ? 18 : 6) : reads[functionName],
    call: async () => ({}),
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient;
  const wallet = {
    sendTransaction: async ({ data }: { data: Hex }) => {
      const { args } = decodeFunctionData({ abi: tx.deltaVaultAbi, data });
      const [market, risk] = args as unknown as [number, Record<string, unknown>];
      added.push({ market: Number(market), risk });
      listed.push(Number(market));
      return `0x${"ee".repeat(32)}`;
    },
  } as unknown as WalletClient;
  const vault = await CuratedVault.load(client, wallet, curator, { vault: VAULT, risk: template });
  return { vault, added };
}
const market = (id: number, overrides: Partial<Market> = {}): Market =>
  ({
    venue: { marketId: String(id) },
    state: OPEN,
    tradingOpen: String(now() - 60),
    tradingCutoff: String(now() + 86_400),
    baseToken: NVDA,
    ...overrides,
  }) as Market;
const adminOf = (markets: Market[]) => ({ markets: async () => markets }) as unknown as Admin;
const run = (markets: Market[], vault: CuratedVault, execute = true) =>
  curateVaults.run({
    admin: adminOf(markets),
    polygon: {} as PublicClient,
    vaults: [vault],
    ladders: { daily: [], weekly: [] },
    kalshi: {} as KalshiApi,
    execute,
    logger,
  });

describe("curated vaults", () => {
  test("load converts the template to raw units and requires the curator role", async () => {
    const { vault } = await vaultOf([]);
    expect(vault.base).toBe(NVDA);
    expect(vault.riskFor(now() + 86_400, now())).toEqual({
      bandBps: 1000,
      cutoffBuffer: 3600,
      maxOrder: 2000n * 10n ** 6n,
      maxResting: 10_000n * 10n ** 6n,
      maxImbalance: 100n * 10n ** 18n,
    });
    expect(vaultOf([], 48, false)).rejects.toThrow("is not the curator");
  });

  test("short markets get a tenth of their life as buffer, and too-short ones none", async () => {
    const { vault } = await vaultOf([]);
    const t = now();
    expect(vault.riskFor(t + 7200, t)?.cutoffBuffer).toBe(720);
    expect(vault.riskFor(t + 400, t)?.cutoffBuffer).toBe(60);
    expect(vault.riskFor(t + 300, t)).toBeNull();
  });
});

describe("curate-vaults job", () => {
  test("registers the vault's stock's new open or scheduled markets, nearest cutoff first, up to its free slots", async () => {
    const { vault, added } = await vaultOf([1], 3);
    const t = now();
    await run(
      [
        market(1),
        market(2, { tradingCutoff: String(t + 90_000) }),
        market(3, { tradingCutoff: String(t + 7200), state: SCHEDULED }),
        market(4, { tradingCutoff: String(t + 200_000) }),
        market(5, { baseToken: TSLA }),
        market(6, { state: FROZEN }),
        market(7, { tradingCutoff: String(t + 200) }),
      ],
      vault,
    );
    expect(added.map((a) => a.market)).toEqual([3, 2]);
    expect(added[0]?.risk.cutoffBuffer).toBe(720);
    // Full now: the next run adds nothing until a resolved market is settled.
    await run([market(4, { tradingCutoff: String(t + 200_000) })], vault);
    expect(added.length).toBe(2);
  });

  test("a dry run changes nothing", async () => {
    const { vault, added } = await vaultOf([]);
    await run([market(2)], vault, false);
    expect(added).toEqual([]);
  });
});

describe("curate-vaults on a real vault", () => {
  const NOW = BigInt(now());
  let node: Anvil;
  let protocol: Awaited<ReturnType<typeof deployProtocol>>;
  let vault: Address;
  beforeAll(async () => {
    node = await startAnvil(Number(NOW));
    protocol = await deployProtocol(node);
    await openMarket(node, protocol, NOW);
    ({ vault } = await deployDeltaVault(node, protocol, NOW));
    await send(node, 0, tx.deltaVaultGrantRole(vault, "curator", protocol.admin));
  }, 60_000);
  afterAll(() => node?.stop());

  test("registers the exchange's new market with the template's limits, once", async () => {
    // Anvil's first account, the vault's admin and curator.
    const account = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    expect(account.address).toBe(getAddress(protocol.admin));
    const curated = await CuratedVault.load(
      node.publicClient as PublicClient,
      node.wallet(0),
      account,
      {
        vault,
        risk: template,
      },
    );
    expect(curated.capacity).toBe(48);
    const indexed = market(1, {
      baseToken: protocol.stock,
      tradingCutoff: String(NOW + 30n * 86_400n),
    });
    await run([indexed], curated);
    await run([indexed], curated);
    expect(await curated.markets()).toEqual([1]);
    const registered = (await node.publicClient.readContract({
      address: vault,
      abi: tx.deltaVaultAbi,
      functionName: "market",
      args: [1],
    })) as { listed: boolean; risk: { cutoffBuffer: number; maxOrder: bigint } };
    expect(registered.listed).toBe(true);
    expect(registered.risk.cutoffBuffer).toBe(3600);
    expect(registered.risk.maxOrder).toBe(2000n * 10n ** 6n);
  }, 60_000);
});
