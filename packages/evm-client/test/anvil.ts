/** Disposable anvil node plus the compiled protocol, for integration tests. */
import { resolve } from "node:path";
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  type Hex,
  http,
  keccak256,
  parseAbi,
  publicActions,
  stringToBytes,
  zeroHash,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createMarket, type Envelope, lifecycle, listPool, underlyingId } from "../src/index.ts";

const MNEMONIC = "test test test test test test test test test test test junk";
export const accounts = [0, 1, 2, 3, 4, 5].map((addressIndex) =>
  mnemonicToAccount(MNEMONIC, { addressIndex }),
);

const artifact = async (file: string, name: string) => {
  const json = (await Bun.file(
    resolve(import.meta.dir, `../../../contracts/out/${file}/${name}.json`),
  ).json()) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
  return json;
};

export const tokenAbi = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export async function startAnvil(timestamp = 1_800_000_000) {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const child = Bun.spawn(
    ["anvil", "--port", String(port), "--silent", "--timestamp", String(timestamp)],
    {
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  const url = `http://127.0.0.1:${port}`;
  const chain = { ...foundry, rpcUrls: { default: { http: [url] } } };
  const client = createTestClient({ chain, mode: "anvil", transport: http(url) }).extend(
    publicActions,
  );
  for (let i = 0; i < 100; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  const wallet = (index: number) =>
    createWalletClient({ account: accounts[index]!, chain, transport: http(url) }).extend(
      publicActions,
    );
  const deploy = async (index: number, file: string, name: string, args: unknown[] = []) => {
    const { abi, bytecode } = await artifact(file, name);
    const w = wallet(index);
    const hash = await w.deployContract({ abi, bytecode: bytecode.object, args } as never);
    const receipt = await w.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Deployment of ${name} failed`);
    return getAddress(receipt.contractAddress);
  };
  return {
    url,
    chain,
    client,
    wallet,
    deploy,
    stop: () => child.kill(),
    publicClient: createPublicClient({ chain, transport: http(url) }),
  };
}

export type Anvil = Awaited<ReturnType<typeof startAnvil>>;

/** Mock quote (6 decimals) and stock (18 decimals) plus the exchange. Account 0 is every role. */
export async function deployProtocol(node: Anvil) {
  const usdc = await node.deploy(0, "Base.t.sol", "MockToken", ["USDC", 6]);
  const stock = await node.deploy(0, "Base.t.sol", "MockToken", ["NVDA", 18]);
  const admin = accounts[0]!.address;
  const exchange = await node.deploy(0, "ConditionalStocks.sol", "ConditionalStocks", [
    usdc,
    admin,
    admin,
    admin,
    admin,
  ]);
  return { usdc, stock, exchange, admin: admin as Address };
}

/** Sends `envelope` from account `index` and requires success. */
export async function send(node: Anvil, index: number, envelope: Pick<Envelope, "to" | "data">) {
  const wallet = node.wallet(index);
  const hash = await wallet.sendTransaction({
    to: envelope.to,
    data: envelope.data,
    account: accounts[index]!,
  } as never);
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  return receipt;
}

/** Lists the stock as US:NVDA and opens market 1 on it: $0.01 ticks, 0.001-share steps, cutoff
 * in 30 days. */
export async function openMarket(
  node: Anvil,
  protocol: Awaited<ReturnType<typeof deployProtocol>>,
  now: bigint,
) {
  await send(node, 0, listPool(protocol.exchange, protocol.stock, underlyingId("US:NVDA")));
  await send(
    node,
    0,
    createMarket(
      protocol.exchange,
      {
        base: protocol.stock,
        condition: keccak256(stringToBytes("condition")),
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
      },
      "ipfs://m",
    ),
  );
  await send(node, 0, lifecycle(protocol.exchange, 1, 0, zeroHash));
}

/** A Δ-vault over `protocol`'s stock with a Chainlink-style mock feed at $100 (8 decimals).
 * Account 0 is every vault role. */
export async function deployDeltaVault(
  node: Anvil,
  protocol: Awaited<ReturnType<typeof deployProtocol>>,
  timestamp: bigint,
) {
  const feed = await node.deploy(0, "VaultBase.t.sol", "MockFeed", [8]);
  const admin = accounts[0]!.address;
  await node.wallet(0).writeContract({
    address: feed,
    abi: feedAbi,
    functionName: "set",
    args: [100n * 10n ** 8n, timestamp, timestamp],
  });
  const vault = await node.deploy(0, "DeltaVault.sol", "DeltaVault", [
    {
      exchange: protocol.exchange,
      base: protocol.stock,
      priceFeed: feed,
      sequencerFeed: "0x0000000000000000000000000000000000000000",
      admin,
      adminDelay: 0,
      name: "Delta Vault NVDA",
      symbol: "dvNVDA",
    },
  ]);
  return { vault, feed };
}

export const feedAbi = parseAbi([
  "function set(int256 answer, uint256 startedAt, uint256 updatedAt)",
  "function answer() view returns (int256)",
]);
