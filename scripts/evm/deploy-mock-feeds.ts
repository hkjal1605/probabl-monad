/** Testnet only: Chainlink publishes no testnet stock feeds, so this deploys a mock feed
 * (contracts/test/mocks/MockPriceFeed.sol) per token, seeded with the latest round of the
 * asset's Chainlink feed on a mainnet (Robinhood Chain, or BNB Chain for assets it has no feed
 * of), and records them in deployments/<chainId>-mock-feeds.json. A token Chainlink has no feed
 * of on either (`<token>:robinhood`) is seeded with Robinhood's reference price of its stock,
 * read as the API reads it, which feed-mirror.ts then follows the way a Chainlink feed would. The deployer key owns the
 * mocks, or FEED_OWNER (the mirror's relay wallet) once handed over. Pass a mock as PRICE_FEED to
 * deploy-vault.ts. Take each mainnet feed from Chainlink's list:
 * docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630 FEED_SOURCE_RPC_URL=<mainnet RPC>,…
 *   FEEDS=<testnet token>:<mainnet feed>[@<source chain id, default 4663>]|robinhood,…
 *   [FEED_OWNER=<relay wallet>] bun scripts/evm/deploy-mock-feeds.ts */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { MONAD_TESTNET, nativeCurrency } from "@conditional-stocks/shared/chains";
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
import { RobinhoodSpotPrices } from "../../apps/server/src/market-data/robinhood.ts";

const TESTNETS: Record<number, string> = {
  46630: "Robinhood Chain Testnet",
  84532: "Base Sepolia",
  [MONAD_TESTNET]: "Monad Testnet",
};
/** Mainnets whose Chainlink feeds testnet mocks copy: Robinhood Chain for its stock tokens, BNB
 * Chain for stocks Robinhood Chain has no feed of (Chainlink's NFLX / USD, say). */
const SOURCES: Record<number, string> = { 4663: "Robinhood Chain", 56: "BNB Chain" };
/** One client per source chain, from the comma-separated `FEED_SOURCE_RPC_URL`. */
async function sourceClients(urls: string) {
  const clients = new Map<number, ReturnType<typeof createPublicClient>>();
  for (const url of urls
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)) {
    const client = createPublicClient({ transport: http(url) });
    const id = await client.getChainId();
    if (!SOURCES[id]) throw new Error(`FEED_SOURCE_RPC_URL serves chain ${id}, not a feed source`);
    clients.set(id, client);
  }
  return clients;
}
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
]);
/** Decimals of reference-priced mocks, as Chainlink's USD feeds. */
const REFERENCE_DECIMALS = 8;
/** An entry of deployments/<chainId>-mock-feeds.json. */
interface MockFeedRecord {
  symbol: string;
  token: string;
  feed: string;
  decimals: number;
  description: string;
  /** A Chainlink feed on a mainnet, or the API's Robinhood reference price. */
  source: { chainId: number; feed: string; description: string } | { reference: "robinhood" };
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
if (!name) throw new Error("Mock price feeds are for testnets only (46630, 84532, 10143)");
const rpc = required("RPC_URL");
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const pairs = required("FEEDS")
  .split(",")
  .map((pair) => {
    const [token, at] = pair.split(":").map((part) => part.trim());
    if (token && at === "robinhood")
      return { token: getAddress(token), source: null, sourceChain: 0 };
    const [feed, source = "4663"] = (at ?? "").split("@");
    if (!token || !feed)
      throw new Error("FEEDS lists <testnet token>:<mainnet feed>[@chain] or :robinhood pairs");
    return { token: getAddress(token), source: getAddress(feed), sourceChain: Number(source) };
  });
const feedOwner = process.env.FEED_OWNER?.trim() ? getAddress(process.env.FEED_OWNER.trim()) : null;

const chain = defineChain({
  id: chainId,
  name,
  nativeCurrency: nativeCurrency(chainId),
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const sources = pairs.some((pair) => pair.source)
  ? await sourceClients(required("FEED_SOURCE_RPC_URL"))
  : new Map<number, ReturnType<typeof createPublicClient>>();
if ((await client.getChainId()) !== chainId)
  throw new Error("RPC_URL serves a different chain than CHAIN_ID");
for (const pair of pairs)
  if (pair.source && !sources.has(pair.sourceChain))
    throw new Error(`FEED_SOURCE_RPC_URL has no RPC of chain ${pair.sourceChain}`);

/** Robinhood's reference price of a token's stock, as a feed round. */
async function referenceRound(token: string, symbol: string) {
  const { prices } = await new RobinhoodSpotPrices(chainId).getPrices([{ token, symbol }]);
  const price = prices[0];
  if (price?.status !== "available" || !price.priceUsd || !price.priceTimestamp)
    throw new Error(`Robinhood has no reference price for ${symbol}`);
  return {
    answer: BigInt(Math.round(price.priceUsd * 10 ** REFERENCE_DECIMALS)),
    updatedAt: BigInt(price.priceTimestamp),
  };
}

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
  let decimals: number, description: string, roundId: bigint, answer: bigint, updatedAt: bigint;
  if (pair.source) {
    const source = sources.get(pair.sourceChain);
    if (!source) throw new Error(`No RPC of chain ${pair.sourceChain}`);
    let round: readonly [bigint, bigint, bigint, bigint, bigint];
    [decimals, description, round] = await Promise.all([
      source.readContract({ address: pair.source, abi: feedAbi, functionName: "decimals" }),
      source.readContract({ address: pair.source, abi: feedAbi, functionName: "description" }),
      source.readContract({ address: pair.source, abi: feedAbi, functionName: "latestRoundData" }),
    ]);
    // Robinhood's feeds read "RHTSLA / USD" or "Robinhood AMZN / USD"; crypto feeds name the
    // asset a wrapped token stands for (WETH: "ETH / USD").
    const asset = description.replace(/^Robinhood\s+|^RH/, "").split(/\s*[/-]\s*USD$/)[0];
    const wrapped: Record<string, string> = { WETH: "ETH", cbBTC: "BTC" };
    if (asset?.trim() !== (wrapped[symbol] ?? symbol))
      throw new Error(`"${description}" is not the Chainlink feed of ${symbol}`);
    [roundId, answer, , updatedAt] = round;
  } else {
    decimals = REFERENCE_DECIMALS;
    description = `Robinhood ${symbol} reference / USD`;
    roundId = 1n;
    ({ answer, updatedAt } = await referenceRound(pair.token, symbol));
  }
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
  if (feedOwner && feedOwner !== account.address) {
    const handover = await wallet.writeContract({
      address: feed,
      abi: feedAbi,
      functionName: "transferOwnership",
      args: [feedOwner],
    });
    const handed = await client.waitForTransactionReceipt({ hash: handover });
    if (handed.status !== "success") throw new Error(`The hand-over of ${feed} reverted`);
  }

  records.push({
    symbol,
    token: pair.token,
    feed,
    decimals,
    description: `${description} (testnet mock)`,
    source: pair.source
      ? { chainId: pair.sourceChain, feed: pair.source, description }
      : { reference: "robinhood" },
    owner: feedOwner ?? owner,
    deploymentBlock: String(receipt.blockNumber),
    transactionHash: hash,
    deployedAt: new Date().toISOString(),
  });
  await mkdir(resolve(root, "deployments"), { recursive: true });
  await Bun.write(path, `${JSON.stringify(records, null, 2)}\n`);
  console.info(
    `${symbol}: mock feed ${feed} at block ${receipt.blockNumber}, seeded with "${description}" ` +
      `round ${roundId} (${Number(answer) / 10 ** decimals} USD), owned by ${feedOwner ?? owner}`,
  );
}
console.info(`Recorded in ${path}. Keep the mocks current with scripts/evm/feed-mirror.ts.`);
