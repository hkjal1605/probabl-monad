/** Testnet only: copies each new round of the stocks' Chainlink feeds on their mainnets
 * (Robinhood Chain, or BNB Chain for stocks it has no feed of) into their mock feeds (deployments/<chainId>-mock-feeds.json, from deploy-mock-feeds.ts), so
 * testnet Δ-vaults see mainnet's prices and staleness. Keep it running while testnet vaults
 * quote; --once mirrors a single time. The key must own the mocks: FEED_MIRROR_PRIVATE_KEY (a
 * dedicated relay wallet the mocks were handed to), else the deployer's.
 *
 *   FEED_MIRROR_PRIVATE_KEY=… (or DEPLOYER_PRIVATE_KEY=…) RPC_URL=… CHAIN_ID=46630
 *   FEED_SOURCE_RPC_URL=<mainnet RPC, one per source chain>,… [POLL_SECONDS=60]
 *   bun scripts/evm/feed-mirror.ts [--once] */
import { resolve } from "node:path";
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

const TESTNETS: Record<number, string> = {
  46630: "Robinhood Chain Testnet",
  84532: "Base Sepolia",
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
if (!name) throw new Error("The feed mirror runs on testnets only (46630, 84532)");
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
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: rpcs } },
});
const transport = fallback(rpcs.map((url) => http(url)));
const client = createPublicClient({ chain, transport });
const sources = await sourceClients(required("FEED_SOURCE_RPC_URL"));
if ((await client.getChainId()) !== chainId)
  throw new Error("RPC_URL serves a different chain than CHAIN_ID");

const path = resolve(import.meta.dir, `../../deployments/${chainId}-mock-feeds.json`);
const feeds = (await Bun.file(path)
  .json()
  .catch(() => {
    throw new Error(`Deploy the mock feeds first: ${path} is missing`);
  })) as { symbol: string; feed: Address; source: { chainId: number; feed: Address } }[];
for (const f of feeds) {
  if (!sources.has(f.source.chainId))
    throw new Error(`FEED_SOURCE_RPC_URL has no RPC of chain ${f.source.chainId} (${f.symbol})`);
  const owner = await client.readContract({ address: f.feed, abi: feedAbi, functionName: "owner" });
  if (owner !== account.address)
    throw new Error(`${f.symbol}'s mock feed belongs to ${owner}, not to this key`);
}
const wallet = createWalletClient({ account, chain, transport });
/** The client of a feed's source chain (every one was checked at startup). */
const reader = (f: (typeof feeds)[number]) => {
  const source = sources.get(f.source.chainId);
  if (!source) throw new Error(`No RPC of chain ${f.source.chainId}`);
  return source;
};

/** Writes every mainnet round the mocks lack; returns how many feeds failed. */
async function mirror() {
  const [states, head] = await Promise.all([
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
  ]);
  let failed = 0;
  for (const { f, round, mock } of states) {
    const [roundId, answer, , updatedAt] = round;
    if (roundId <= mock[0]) continue;
    try {
      // A round may not postdate the testnet's clock.
      const at = updatedAt < head.timestamp ? updatedAt : head.timestamp;
      const hash = await wallet.writeContract({
        address: f.feed,
        abi: feedAbi,
        functionName: "update",
        args: [roundId, answer, at],
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`update reverted in ${hash}`);
      console.info(
        `${f.symbol}: round ${roundId} (${answer}, updated ${new Date(Number(updatedAt) * 1000).toISOString()})`,
      );
    } catch (error) {
      failed++;
      console.error(`${f.symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failed;
}

if (process.argv.includes("--once")) {
  process.exitCode = (await mirror()) ? 1 : 0;
} else {
  console.info(`Mirroring ${feeds.map((f) => f.symbol).join(", ")} every ${pollSeconds}s`);
  for (;;) {
    await mirror().catch((error) =>
      console.error(`Mirror pass failed: ${error instanceof Error ? error.message : error}`),
    );
    await Bun.sleep(pollSeconds * 1000);
  }
}
