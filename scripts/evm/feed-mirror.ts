/** Testnet only: copies each new round of the assets' Chainlink feeds on their mainnets
 * (Robinhood Chain, or BNB Chain for assets it has no feed of) into their mock feeds
 * (deployments/<chainId>-mock-feeds.json, from deploy-mock-feeds.ts), so testnet Δ-vaults see
 * mainnet's prices. Mocks of tokens Chainlink has no feed of follow Robinhood's reference price
 * of the stock instead, read as the API reads it, while Robinhood quotes it. Every mock takes a new round as Robinhood
 * Chain's stock feeds do, on a 0.5% move or after 24 hours: faster feeds (BNB Chain's crypto)
 * would otherwise cost a transaction a minute. Keep it running while testnet vaults quote;
 * --once mirrors a single time. The key must own the mocks: FEED_MIRROR_PRIVATE_KEY (a
 * dedicated relay wallet the mocks were handed to), else the deployer's.
 *
 *   FEED_MIRROR_PRIVATE_KEY=… (or DEPLOYER_PRIVATE_KEY=…) RPC_URL=… CHAIN_ID=46630
 *   FEED_SOURCE_RPC_URL=<mainnet RPC, one per source chain>,… [POLL_SECONDS=60]
 *   bun scripts/evm/feed-mirror.ts [--once] */

import { resolve } from "node:path";
import { MONAD_TESTNET, nativeCurrency } from "@conditional-stocks/shared/chains";
import { SPOT_BATCH_SIZE } from "@conditional-stocks/shared/spot-prices";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
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
/** Robinhood Chain's Chainlink stock feeds: deviation threshold and heartbeat. */
const DEVIATION_BPS = 50n;
const HEARTBEAT_SECONDS = 86_400n;
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function owner() view returns (address)",
  "function update(uint80 roundId, int256 answer, uint256 updatedAt)",
]);
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const name = TESTNETS[chainId];
if (!name) throw new Error("The feed mirror runs on testnets only (46630, 84532, 10143)");
// Comma-separated endpoints fail over, as in the API that shares this environment.
const rpcs = required("RPC_URL")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const account = privateKeyToAccount(
  (process.env.FEED_MIRROR_PRIVATE_KEY?.trim() || required("DEPLOYER_PRIVATE_KEY")) as Hex,
);
const pollSeconds = Number(process.env.POLL_SECONDS ?? 60);
if (!Number.isInteger(pollSeconds) || pollSeconds < 5)
  throw new Error("POLL_SECONDS must be a whole number of seconds, at least 5");

const chain = defineChain({
  id: chainId,
  name,
  nativeCurrency: nativeCurrency(chainId),
  rpcUrls: { default: { http: rpcs } },
});
const transport = fallback(rpcs.map((url) => http(url)));
const client = createPublicClient({ chain, transport });
if ((await client.getChainId()) !== chainId)
  throw new Error("RPC_URL serves a different chain than CHAIN_ID");

type MirroredFeed = { symbol: string; feed: Address; source: { chainId: number; feed: Address } };
type ReferenceFeed = {
  symbol: string;
  token: Address;
  feed: Address;
  decimals: number;
  source: { reference: "robinhood" };
};
const path = resolve(import.meta.dir, `../../deployments/${chainId}-mock-feeds.json`);
const all = (await Bun.file(path)
  .json()
  .catch(() => {
    throw new Error(`Deploy the mock feeds first: ${path} is missing`);
  })) as (MirroredFeed | ReferenceFeed)[];
const feeds = all.filter((f): f is MirroredFeed => "chainId" in f.source);
const references = all.filter((f): f is ReferenceFeed => "reference" in f.source);
const sources = feeds.length
  ? await sourceClients(required("FEED_SOURCE_RPC_URL"))
  : new Map<number, ReturnType<typeof createPublicClient>>();
for (const f of all) {
  if ("chainId" in f.source && !sources.has(f.source.chainId))
    throw new Error(`FEED_SOURCE_RPC_URL has no RPC of chain ${f.source.chainId} (${f.symbol})`);
  const owner = await client.readContract({ address: f.feed, abi: feedAbi, functionName: "owner" });
  if (owner !== account.address)
    throw new Error(`${f.symbol}'s mock feed belongs to ${owner}, not to this key`);
}
const wallet = createWalletClient({ account, chain, transport });
/** The client of a feed's source chain (every one was checked at startup). */
const reader = (f: MirroredFeed) => {
  const source = sources.get(f.source.chainId);
  if (!source) throw new Error(`No RPC of chain ${f.source.chainId}`);
  return source;
};

/** Whether `answer` is a new round for a mock at `last`, written `age` seconds ago. */
const due = (answer: bigint, last: bigint, age: bigint) =>
  (answer > last ? answer - last : last - answer) * 10_000n >= last * DEVIATION_BPS ||
  age >= HEARTBEAT_SECONDS;

/** Writes round `roundId` to a mock; returns whether it failed. */
async function write(symbol: string, feed: Address, roundId: bigint, answer: bigint, at: bigint) {
  try {
    const hash = await wallet.writeContract({
      address: feed,
      abi: feedAbi,
      functionName: "update",
      args: [roundId, answer, at],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`update reverted in ${hash}`);
    console.info(
      `${symbol}: round ${roundId} (${answer}, updated ${new Date(Number(at) * 1000).toISOString()})`,
    );
    return false;
  } catch (error) {
    console.error(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}

const robinhood = new RobinhoodSpotPrices(chainId);
/** Robinhood's reference prices of the reference-priced tokens' stocks, by token. */
async function referencePrices() {
  const prices = new Map<string, { priceUsd: number; priceTimestamp: number }>();
  for (let i = 0; i < references.length; i += SPOT_BATCH_SIZE) {
    const batch = references.slice(i, i + SPOT_BATCH_SIZE);
    const body = await robinhood.getPrices(
      batch.map((f) => ({ token: f.token, symbol: f.symbol })),
    );
    for (const p of body.prices)
      if (p.status === "available" && p.priceUsd && p.priceTimestamp)
        prices.set(p.token.toLowerCase(), {
          priceUsd: p.priceUsd,
          priceTimestamp: p.priceTimestamp,
        });
  }
  return prices;
}

/** Writes every mainnet round the mocks lack, and a reference round where the price moved or
 * the heartbeat passed; returns how many feeds failed. */
async function mirror() {
  const [states, head, mocks, prices] = await Promise.all([
    Promise.all(
      feeds.map((f) =>
        Promise.all([
          reader(f).readContract({
            address: f.source.feed,
            abi: feedAbi,
            functionName: "latestRoundData",
          }),
          client.readContract({ address: f.feed, abi: feedAbi, functionName: "latestRoundData" }),
        ]).then(([round, mock]) => ({ f, round, mock })),
      ),
    ),
    client.getBlock(),
    Promise.all(
      references.map((f) =>
        client.readContract({ address: f.feed, abi: feedAbi, functionName: "latestRoundData" }),
      ),
    ),
    references.length ? referencePrices() : new Map(),
  ]);
  let failed = 0;
  for (const { f, round, mock } of states) {
    const [roundId, answer, , updatedAt] = round;
    if (roundId <= mock[0] || !due(answer, mock[1], head.timestamp - mock[3])) continue;
    // A round may not postdate the testnet's clock.
    const at = updatedAt < head.timestamp ? updatedAt : head.timestamp;
    if (await write(f.symbol, f.feed, roundId, answer, at)) failed++;
  }
  for (const [i, f] of references.entries()) {
    const mock = mocks[i];
    const price = prices.get(f.token.toLowerCase());
    if (!mock || !price) continue;
    const [roundId, last, , lastAt] = mock;
    const observed = BigInt(price.priceTimestamp);
    if (observed <= lastAt) continue;
    const answer = BigInt(Math.round(price.priceUsd * 10 ** f.decimals));
    if (!due(answer, last, head.timestamp - lastAt)) continue;
    const at = observed < head.timestamp ? observed : head.timestamp;
    if (await write(f.symbol, f.feed, roundId + 1n, answer, at)) failed++;
  }
  return failed;
}

if (process.argv.includes("--once")) {
  process.exitCode = (await mirror()) ? 1 : 0;
} else {
  console.info(
    `Mirroring ${feeds.map((f) => f.symbol).join(", ")} and following ` +
      `${references.map((f) => f.symbol).join(", ") || "no reference prices"} every ${pollSeconds}s`,
  );
  for (;;) {
    await mirror().catch((error) =>
      console.error(`Mirror pass failed: ${error instanceof Error ? error.message : error}`),
    );
    await Bun.sleep(pollSeconds * 1000);
  }
}
