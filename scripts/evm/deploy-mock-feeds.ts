/** Testnet only: Chainlink publishes no testnet stock feeds, so this deploys a mock feed
 * (contracts/test/mocks/MockPriceFeed.sol) per stock token, seeded with the latest round of the
 * stock's Chainlink feed on Robinhood Chain mainnet, and records them in
 * deployments/<chainId>-mock-feeds.json. The deployer key owns the mocks; feed-mirror.ts keeps
 * them on their mainnet feeds. Pass a mock as PRICE_FEED to deploy-vault.ts. Take each mainnet
 * feed from Chainlink's list: docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630 FEED_SOURCE_RPC_URL=<Robinhood Chain mainnet>
 *   FEEDS=<testnet token>:<mainnet feed>,… bun scripts/evm/deploy-mock-feeds.ts */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  getAddress,
  type Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const TESTNETS: Record<number, string> = {
  46630: "Robinhood Chain Testnet",
  84532: "Base Sepolia",
};
/** Robinhood Chain mainnet, where Chainlink publishes the stock tokens' feeds. */
const SOURCE_CHAIN_ID = 4663;
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function owner() view returns (address)",
]);
/** An entry of deployments/<chainId>-mock-feeds.json. */
interface MockFeedRecord {
  symbol: string;
  token: string;
  feed: string;
  decimals: number;
  description: string;
  source: { chainId: number; feed: string; description: string };
  owner: string;
  deploymentBlock: string;
  transactionHash: string;
  deployedAt: string;
}
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const name = TESTNETS[chainId];
if (!name) throw new Error("Mock price feeds are for testnets only (46630, 84532)");
const rpc = required("RPC_URL");
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const pairs = required("FEEDS")
  .split(",")
  .map((pair) => {
    const [token, feed] = pair.split(":").map((part) => part.trim());
    if (!token || !feed) throw new Error("FEEDS lists <testnet token>:<mainnet feed> pairs");
    return { token: getAddress(token), source: getAddress(feed) };
  });

const chain = defineChain({
  id: chainId,
  name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const source = createPublicClient({ transport: http(required("FEED_SOURCE_RPC_URL")) });
if ((await client.getChainId()) !== chainId)
  throw new Error("RPC_URL serves a different chain than CHAIN_ID");
if ((await source.getChainId()) !== SOURCE_CHAIN_ID)
  throw new Error("FEED_SOURCE_RPC_URL must serve Robinhood Chain mainnet (4663)");

const root = resolve(import.meta.dir, "../..");
const artifactPath = resolve(root, "contracts/out/MockPriceFeed.sol/MockPriceFeed.json");
if (!(await Bun.file(artifactPath).exists()))
  throw new Error("Build the contracts first: forge build --root contracts");
const { abi, bytecode } = (await Bun.file(artifactPath).json()) as {
  abi: unknown[];
  bytecode: { object: Hex };
};
const path = resolve(root, `deployments/${chainId}-mock-feeds.json`);
const records = (await Bun.file(path)
  .json()
  .catch(() => [])) as MockFeedRecord[];
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

for (const pair of pairs) {
  const symbol = await client.readContract({
    address: pair.token,
    abi: erc20Abi,
    functionName: "symbol",
  });
  const known = records.find((r) => getAddress(r.token) === pair.token);
  if (known) {
    console.info(`${symbol} already has the mock feed ${known.feed}; skipped`);
    continue;
  }
  const [decimals, description, round] = await Promise.all([
    source.readContract({ address: pair.source, abi: feedAbi, functionName: "decimals" }),
    source.readContract({ address: pair.source, abi: feedAbi, functionName: "description" }),
    source.readContract({ address: pair.source, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  // Robinhood's feeds read "RHTSLA / USD" or "Robinhood AMZN / USD".
  const asset = description.replace(/^Robinhood\s+|^RH/, "").split(/\s*[/-]\s*USD$/)[0];
  if (asset?.trim() !== symbol)
    throw new Error(`"${description}" is not the Chainlink feed of ${symbol}`);
  const [roundId, answer, , updatedAt] = round;
  if (answer <= 0n || Date.now() / 1000 - Number(updatedAt) > 7 * 86_400)
    throw new Error(`"${description}" has no recent positive round`);
  // A round may not postdate the testnet's clock.
  const head = (await client.getBlock()).timestamp;
  const hash = await wallet.deployContract({
    abi,
    bytecode: bytecode.object,
    args: [
      decimals,
      `${description} (testnet mock)`,
      roundId,
      answer,
      updatedAt < head ? updatedAt : head,
    ],
  } as never);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("Deployment reverted");
  const feed = getAddress(receipt.contractAddress);
  const [owner, latest] = await Promise.all([
    client.readContract({ address: feed, abi: feedAbi, functionName: "owner" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  if (owner !== account.address || latest[0] !== roundId || latest[1] !== answer)
    throw new Error("The deployed mock feed differs from its source");

  records.push({
    symbol,
    token: pair.token,
    feed,
    decimals,
    description: `${description} (testnet mock)`,
    source: { chainId: SOURCE_CHAIN_ID, feed: pair.source, description },
    owner,
    deploymentBlock: String(receipt.blockNumber),
    transactionHash: hash,
    deployedAt: new Date().toISOString(),
  });
  await mkdir(resolve(root, "deployments"), { recursive: true });
  await Bun.write(path, `${JSON.stringify(records, null, 2)}\n`);
  console.info(
    `${symbol}: mock feed ${feed} at block ${receipt.blockNumber}, seeded with "${description}" ` +
      `round ${roundId} (${Number(answer) / 10 ** decimals} USD)`,
  );
}
console.info(`Recorded in ${path}. Keep the mocks current with scripts/evm/feed-mirror.ts.`);
