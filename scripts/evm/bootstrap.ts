/** Local-only fixture on a running anvil node: mock quote and stock tokens, the exchange, listed
 * pools, and funded demo wallets. Writes .local/anvil.env for every service. Markets are created
 * afterwards through the admin evidence flow (scripts/evm/seed-markets.ts).
 *
 * Wallets are anvil's public development mnemonic: never use them outside a local node. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { conditionalStocksAbi, listPool } from "@conditional-stocks/evm-client";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  type Hex,
  http,
  parseAbi,
  toHex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { MARKET_TICKERS } from "./seed-policy.ts";

const rpc = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
if (!["127.0.0.1", "localhost"].includes(new URL(rpc).hostname))
  throw new Error("Bootstrap is restricted to a localhost anvil node");
const root = resolve(import.meta.dir, "../..");
const destination = resolve(root, ".local");
await mkdir(destination, { recursive: true, mode: 0o700 });
if (await Bun.file(resolve(destination, "anvil.env")).exists())
  throw new Error(
    "A local deployment already exists. Reuse .local/anvil.env, or restart anvil and remove it first.",
  );

const MNEMONIC = "test test test test test test test test test test test junk";
const [admin, alice, bob, maker, faucet, delegate] = [0, 1, 2, 3, 4, 5].map((addressIndex) =>
  mnemonicToAccount(MNEMONIC, { addressIndex }),
);
const chain = { ...foundry, rpcUrls: { default: { http: [rpc] } } };
const client = createPublicClient({ chain, transport: http(rpc), pollingInterval: 250 });
if ((await client.getChainId()) !== foundry.id)
  throw new Error("Expected an anvil node (chain 31337)");
const wallet = createWalletClient({ account: admin!, chain, transport: http(rpc) });

const artifact = async (file: string, name: string) => {
  const path = resolve(root, `contracts/out/${file}/${name}.json`);
  if (!(await Bun.file(path).exists()))
    throw new Error("Build the contracts first: bun run build:contracts");
  return (await Bun.file(path).json()) as { abi: unknown[]; bytecode: { object: Hex } };
};
async function send(request: Promise<Hex>) {
  const receipt = await client.waitForTransactionReceipt({ hash: await request });
  if (receipt.status !== "success") throw new Error("Bootstrap transaction reverted");
  return receipt;
}
async function deploy(file: string, name: string, args: unknown[]) {
  const { abi, bytecode } = await artifact(file, name);
  const receipt = await send(
    wallet.deployContract({ abi, bytecode: bytecode.object, args } as never),
  );
  return { address: getAddress(receipt.contractAddress!), block: receipt.blockNumber };
}

const tokenAbi = parseAbi(["function mint(address,uint256)"]);
const usdc = (await deploy("Base.t.sol", "MockToken", ["USDC", 6])).address;
const stocks: Record<string, `0x${string}`> = {};
for (const ticker of MARKET_TICKERS)
  stocks[ticker] = (await deploy("Base.t.sol", "MockToken", [ticker, 18])).address;
const exchange = await deploy("ConditionalStocks.sol", "ConditionalStocks", [
  usdc,
  admin!.address,
  admin!.address,
  admin!.address,
  admin!.address,
]);
for (const token of Object.values(stocks)) {
  const tx = listPool(exchange.address, token);
  await send(wallet.sendTransaction({ to: tx.to, data: tx.data }));
}
// Demo balances: traders and the market maker get quote and every stock; the faucet holds a
// reserve it hands out once per wallet.
for (const [account, quote, stock] of [
  [alice!, 1_000_000n, 1_000n],
  [bob!, 1_000_000n, 1_000n],
  [maker!, 10_000_000n, 10_000n],
  [faucet!, 1_000_000n, 1_000n],
] as const) {
  await send(
    wallet.sendTransaction({
      to: usdc,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "mint",
        args: [account.address, quote * 10n ** 6n],
      }),
    }),
  );
  for (const token of Object.values(stocks))
    await send(
      wallet.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: tokenAbi,
          functionName: "mint",
          args: [account.address, stock * 10n ** 18n],
        }),
      }),
    );
}
const configured = await client.readContract({
  address: exchange.address,
  abi: conditionalStocksAbi,
  functionName: "roles",
});
if (configured[0] !== admin!.address)
  throw new Error("Exchange roles differ from the bootstrap wallet");

const key = (account: typeof admin) => toHex(account!.getHdKey().privateKey!);
const origins =
  "http://localhost:3001,http://localhost:3002,http://127.0.0.1:3001,http://127.0.0.1:3002";
const env = {
  CHAIN_ID: "31337",
  RPC_URL: rpc,
  EXCHANGE_ADDRESS: exchange.address,
  DEPLOYMENT_BLOCK: String(exchange.block),
  FINALITY_DEPTH: "2",
  API_PORT: "3000",
  API_AUTH_ORIGINS: origins,
  API_URL: "http://127.0.0.1:3000",
  INDEXER_URL: "http://127.0.0.1:3000",
  TRADING_DELEGATE_ADDRESS: delegate!.address,
  TRADING_DELEGATE_PRIVATE_KEY: key(delegate),
  FAUCET_PRIVATE_KEY: key(faucet),
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_CHAIN_ID: "31337",
  NEXT_PUBLIC_CHAIN_NAME: "Anvil",
  NEXT_PUBLIC_RPC_URL: rpc,
  NEXT_PUBLIC_EXCHANGE_ADDRESS: exchange.address,
  MM_MODE: "live",
  MM_RPC_URL: rpc,
  MM_CHAIN_ID: "31337",
  MM_EXCHANGE: exchange.address,
  MM_DEPLOYMENT_BLOCK: String(exchange.block),
  MM_API_ORIGIN: "http://127.0.0.1:3000",
  MM_WALLET_ADDRESS: maker!.address,
  MM_PRIVATE_KEY: key(maker),
  MM_STATE_PATH: resolve(destination, "market-maker/state.json"),
  MM_CONFIG_PATH: resolve(destination, "market-maker.json"),
  SEED_ADMIN_PRIVATE_KEY: key(admin),
};
await Bun.write(
  resolve(destination, "anvil.env"),
  `${Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`,
  { mode: 0o600 },
);
await Bun.write(
  resolve(destination, "anvil-deployment.json"),
  JSON.stringify(
    {
      chainId: 31337,
      exchange: exchange.address,
      deploymentBlock: String(exchange.block),
      quote: usdc,
      stocks,
      admin: admin!.address,
      alice: alice!.address,
      bob: bob!.address,
      marketMaker: maker!.address,
      faucet: faucet!.address,
      tradingDelegate: delegate!.address,
    },
    null,
    2,
  ),
);
console.info(`Local deployment created: exchange ${exchange.address}. Settings: .local/anvil.env`);
