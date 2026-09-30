/** Deploys a Δ-vault for one listed stock on a recorded exchange deployment
 * (deployments/<chainId>.json) and records it in deployments/<chainId>-vaults.json. The deployer
 * key only pays: the vault admin is an explicit address, and the admin's follow-up calls (roles
 * and deposit caps) are printed as payloads for it to sign.
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=84532 BASE_TOKEN=0x… PRICE_FEED=0x…
 *   VAULT_ADMIN=0x… CURATOR=0x… KEEPER=0x… GUARDIAN=0x… [SEQUENCER_FEED=0x…]
 *   [ADMIN_DELAY_SECONDS=259200] [QUOTE_CAP=… BASE_CAP=… in whole tokens]
 *   bun scripts/evm/deploy-vault.ts [--mainnet]
 *
 * PRICE_FEED must be the Chainlink feed of the token itself (tokenized-equity feeds already
 * include the issuer's multiplier). Verify it and every role against official sources first. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseTokenAmount } from "@conditional-stocks/domain";
import {
  conditionalStocksAbi,
  deltaVaultAbi,
  deltaVaultGrantRole,
  deltaVaultSetCaps,
} from "@conditional-stocks/evm-client";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  getAddress,
  type Hex,
  http,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Chainlink L2 sequencer-uptime feeds (docs.chain.link/data-feeds/l2-sequencer-feeds); chains
 * without one pass none. */
const NETWORKS: Record<number, { name: string; mainnet: boolean; sequencer?: `0x${string}` }> = {
  8453: { name: "Base", mainnet: true, sequencer: "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433" },
  84532: { name: "Base Sepolia", mainnet: false },
  4663: { name: "Robinhood Chain", mainnet: true },
  46630: { name: "Robinhood Chain Testnet", mainnet: false },
};
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const network = NETWORKS[chainId];
if (!network)
  throw new Error("CHAIN_ID must be Base, Base Sepolia, Robinhood Chain or its testnet");
if (network.mainnet && !process.argv.includes("--mainnet"))
  throw new Error(`${network.name} is a mainnet: pass --mainnet explicitly`);
const root = resolve(import.meta.dir, "../..");
const record = (await Bun.file(resolve(root, `deployments/${chainId}.json`))
  .json()
  .catch(() => {
    throw new Error(`Deploy the exchange first: deployments/${chainId}.json is missing`);
  })) as { exchange: `0x${string}` };
const exchange = getAddress(record.exchange);
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const [base, priceFeed, admin, curator, keeper, guardian] = [
  "BASE_TOKEN",
  "PRICE_FEED",
  "VAULT_ADMIN",
  "CURATOR",
  "KEEPER",
  "GUARDIAN",
].map((name) => getAddress(required(name)));
if ([admin, curator, keeper, guardian].includes(account.address))
  throw new Error("Roles must not be the deployer key: use dedicated (multisig) role addresses");
if ([admin, curator].includes(keeper!))
  throw new Error("The keeper key must hold no admin or curator power");
const sequencer = process.env.SEQUENCER_FEED
  ? getAddress(process.env.SEQUENCER_FEED)
  : (network.sequencer ?? zeroAddress);
if (network.sequencer && sequencer !== network.sequencer)
  throw new Error(`${network.name} vaults must use its sequencer feed ${network.sequencer}`);
const adminDelay = Number(process.env.ADMIN_DELAY_SECONDS ?? 3 * 86_400);
if (!Number.isSafeInteger(adminDelay) || adminDelay < 86_400)
  throw new Error("ADMIN_DELAY_SECONDS must be at least one day");

const rpc = required("RPC_URL");
const chain = defineChain({
  id: chainId,
  name: network.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== chainId) throw new Error("RPC_URL serves another chain");
const [pool, symbol, quote, feedDecimals, description, round] = await Promise.all([
  client.readContract({
    address: exchange,
    abi: conditionalStocksAbi,
    functionName: "pool",
    args: [base!],
  }),
  client.readContract({ address: base!, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: exchange, abi: conditionalStocksAbi, functionName: "quote" }),
  client.readContract({ address: priceFeed!, abi: feedAbi, functionName: "decimals" }),
  client.readContract({ address: priceFeed!, abi: feedAbi, functionName: "description" }),
  client.readContract({ address: priceFeed!, abi: feedAbi, functionName: "latestRoundData" }),
]);
if (!pool.listed) throw new Error(`${symbol} is not listed on the exchange`);
const age = Math.floor(Date.now() / 1000) - Number(round[3]);
if (round[1] <= 0n || age > 7 * 86_400)
  throw new Error("The price feed has no recent positive round");
console.info(
  `Deploying a ${symbol} vault on ${network.name}: feed "${description}" (${feedDecimals} decimals, ` +
    `last update ${Math.round(age / 3600)}h ago), sequencer ${sequencer}`,
);

const artifact = (await Bun.file(resolve(root, "contracts/out/DeltaVault.sol/DeltaVault.json"))
  .json()
  .catch(() => {
    throw new Error("Build the contracts first: bun run build:contracts");
  })) as { abi: unknown[]; bytecode: { object: Hex } };
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [
    {
      exchange,
      base,
      priceFeed,
      sequencerFeed: sequencer,
      admin,
      adminDelay,
      name: `Probabl Δ-Vault ${symbol}`,
      symbol: `dv${symbol}`,
    },
  ],
} as never);
const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error("Deployment reverted");
const vault = getAddress(receipt.contractAddress);
const [bound, owner] = await Promise.all([
  client.readContract({ address: vault, abi: deltaVaultAbi, functionName: "EXCHANGE" }),
  client.readContract({ address: vault, abi: deltaVaultAbi, functionName: "defaultAdmin" }),
]);
if (bound !== exchange || owner !== admin)
  throw new Error("Deployed vault differs from its configuration");

const path = resolve(root, `deployments/${chainId}-vaults.json`);
const vaults = (await Bun.file(path)
  .json()
  .catch(() => [])) as unknown[];
vaults.push({
  vault,
  symbol: `dv${symbol}`,
  base,
  quote,
  priceFeed,
  sequencerFeed: sequencer,
  admin,
  adminDelay,
  deploymentBlock: String(receipt.blockNumber),
  transactionHash: hash,
  deployedAt: new Date().toISOString(),
});
await mkdir(resolve(root, "deployments"), { recursive: true });
await Bun.write(path, `${JSON.stringify(vaults, null, 2)}\n`);

// The vault admin grants the operating roles and opens deposits.
const follow = [
  deltaVaultGrantRole(vault, "curator", curator!),
  deltaVaultGrantRole(vault, "keeper", keeper!),
  deltaVaultGrantRole(vault, "guardian", guardian!),
];
if (process.env.QUOTE_CAP && process.env.BASE_CAP) {
  const [quoteDecimals, baseDecimals] = await Promise.all([
    client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: base!, abi: erc20Abi, functionName: "decimals" }),
  ]);
  follow.push(
    deltaVaultSetCaps(
      vault,
      parseTokenAmount(process.env.QUOTE_CAP, quoteDecimals),
      parseTokenAmount(process.env.BASE_CAP, baseDecimals),
    ),
  );
}
console.info(`Vault ${vault} at block ${receipt.blockNumber}. Recorded in ${path}.`);
console.info(
  `Next, from the vault admin ${admin} (then the curator sets limits and adds markets, and the admin seeds the first deposit):`,
);
console.info(
  JSON.stringify(
    follow.map((call) => ({ from: admin, chainId, ...call })),
    null,
    2,
  ),
);
