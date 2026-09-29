/** Deploys the exchange to Base or Robinhood Chain (or their testnets) and records the
 * deployment. The deployer key only pays for the deployment: every role is an explicit address
 * and never defaults to the deployer.
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=84532 QUOTE_TOKEN=0x… ADMIN=0x… MARKET_ADMIN=0x…
 *   GUARDIAN=0x… RESOLUTION_ADMIN=0x… bun scripts/evm/deploy.ts [--mainnet]
 *
 * The quote token is immutable: it is pinned per network to the chain's native dollar (Circle
 * USDC on Base, Paxos USDG on Robinhood Chain). Verify every role address against official
 * sources immediately before deploying. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { conditionalStocksAbi } from "@conditional-stocks/evm-client";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  getAddress,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** `quote.address` is the canonical token (from the issuer's documentation); networks without a
 * published address check the symbol only. */
const NETWORKS: Record<
  number,
  { name: string; mainnet: boolean; quote: { symbol: string; address?: `0x${string}` } }
> = {
  8453: {
    name: "Base",
    mainnet: true,
    quote: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  },
  84532: {
    name: "Base Sepolia",
    mainnet: false,
    quote: { symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  },
  // https://docs.robinhood.com/chain/contracts/ (no native USDC or CCTP on Robinhood Chain).
  4663: {
    name: "Robinhood Chain",
    mainnet: true,
    quote: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" },
  },
  46630: { name: "Robinhood Chain Testnet", mainnet: false, quote: { symbol: "USDG" } },
};
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const network = NETWORKS[chainId];
if (!network)
  throw new Error(
    "CHAIN_ID must be Base, Base Sepolia, Robinhood Chain or Robinhood Chain Testnet",
  );
if (network.mainnet && !process.argv.includes("--mainnet"))
  throw new Error(`${network.name} is a mainnet: pass --mainnet explicitly`);
const rpc = required("RPC_URL");
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const [quote, admin, marketAdmin, guardian, resolutionAdmin] = [
  "QUOTE_TOKEN",
  "ADMIN",
  "MARKET_ADMIN",
  "GUARDIAN",
  "RESOLUTION_ADMIN",
].map((name) => getAddress(required(name))) as [
  `0x${string}`,
  `0x${string}`,
  `0x${string}`,
  `0x${string}`,
  `0x${string}`,
];
if (network.quote.address && quote !== network.quote.address)
  throw new Error(
    `QUOTE_TOKEN must be ${network.name}'s ${network.quote.symbol} (${network.quote.address}): it can never change after deployment`,
  );
if ([admin, marketAdmin, guardian, resolutionAdmin].includes(account.address))
  throw new Error("Roles must not be the deployer key: use dedicated (multisig) role addresses");

const chain = defineChain({
  id: chainId,
  name: network.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== chainId)
  throw new Error("RPC_URL serves a different chain than CHAIN_ID");
const [symbol, decimals] = await Promise.all([
  client.readContract({ address: quote, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
]);
if (symbol !== network.quote.symbol)
  throw new Error(`The quote token's symbol is ${symbol}, expected ${network.quote.symbol}`);
console.info(
  `Deploying to ${network.name} with quote ${symbol} (${decimals} decimals) at ${quote}`,
);

const root = resolve(import.meta.dir, "../..");
const artifactPath = resolve(root, "contracts/out/ConditionalStocks.sol/ConditionalStocks.json");
if (!(await Bun.file(artifactPath).exists()))
  throw new Error("Build the contracts first: bun run build:contracts");
const { abi, bytecode } = (await Bun.file(artifactPath).json()) as {
  abi: unknown[];
  bytecode: { object: Hex };
};
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const hash = await wallet.deployContract({
  abi,
  bytecode: bytecode.object,
  args: [quote, admin, marketAdmin, guardian, resolutionAdmin],
} as never);
const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error("Deployment reverted");
const exchange = getAddress(receipt.contractAddress);
const roles = await client.readContract({
  address: exchange,
  abi: conditionalStocksAbi,
  functionName: "roles",
});
if (roles[0] !== marketAdmin || roles[1] !== guardian || roles[2] !== resolutionAdmin)
  throw new Error("Deployed roles differ");

const record = {
  chainId,
  network: network.name,
  exchange,
  deploymentBlock: String(receipt.blockNumber),
  transactionHash: hash,
  quote,
  admin,
  marketAdmin,
  guardian,
  resolutionAdmin,
  deployedAt: new Date().toISOString(),
};
await mkdir(resolve(root, "deployments"), { recursive: true });
await Bun.write(
  resolve(root, `deployments/${chainId}.json`),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.info(
  `Exchange ${exchange} at block ${receipt.blockNumber}. Recorded in deployments/${chainId}.json`,
);
