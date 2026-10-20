/** Market automation: runs every job in ./jobs on its own interval against the API and the
 * exchange, signing as the market admin, and as the resolution admin when that is the same
 * wallet or RESOLUTION_ADMIN_PRIVATE_KEY is set. Dry run by default: --execute signs, --once runs
 * each job once. Vault curation reads AUTOMATION_VAULTS_PATH (vaults.example.json) and signs with
 * CURATOR_PRIVATE_KEY, else the market admin's key. The daily and weekly ladders are read from
 * AUTOMATION_LADDERS_PATH (ladders.example.json), their strikes from KALSHI_API_URL.
 *
 *   CHAIN_ID=… RPC_URL=… EXCHANGE_ADDRESS=… MARKET_ADMIN_PRIVATE_KEY=… POLYGON_RPC_URL=…
 *   [RESOLUTION_ADMIN_PRIVATE_KEY=…] [AUTOMATION_API_URL=http://127.0.0.1:3000]
 *   [AUTOMATION_AUTH_ORIGIN=http://localhost:3002] bun services/market-automation/src/main.ts */
import { conditionalStocksAbi } from "@conditional-stocks/evm-client";
import { apiOrigin } from "@conditional-stocks/operator";
import { Logger, logLevel } from "@conditional-stocks/shared";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  getAddress,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon as polygonChain } from "viem/chains";
import { Admin } from "./admin.ts";
import { JOBS } from "./jobs/index.ts";
import { type Ladder, type LadderConfig, loadLadders } from "./ladders.ts";
import { CuratedVault, type VaultCurationConfig } from "./vaults.ts";
import { KalshiApi } from "./venues/kalshi-api.ts";

const env = process.env;
const required = (name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const execute = process.argv.includes("--execute"),
  once = process.argv.includes("--once");
const logger = new Logger({ service: "market-automation", level: logLevel(env.LOG_LEVEL) });

const chainId = Number(required("CHAIN_ID"));
const rpcs = required("RPC_URL")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const chain = defineChain({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: rpcs } },
});
const transport = fallback(rpcs.map((url) => http(url)));
const client = createPublicClient({ chain, transport });
const polygon = createPublicClient({
  chain: polygonChain,
  transport: http(required("POLYGON_RPC_URL"), { retryCount: 2 }),
});
const [chainIds, roles] = await Promise.all([
  Promise.all([client.getChainId(), polygon.getChainId()]),
  client.readContract({
    address: getAddress(required("EXCHANGE_ADDRESS")),
    abi: conditionalStocksAbi,
    functionName: "roles",
  }),
]);
if (chainIds[0] !== chainId) throw new Error("RPC_URL serves another chain");
if (chainIds[1] !== polygonChain.id) throw new Error("POLYGON_RPC_URL is not Polygon");

const key = (name: string) => privateKeyToAccount(required(name) as Hex);
const marketAdmin = key("MARKET_ADMIN_PRIVATE_KEY");
const resolutionAdmin = env.RESOLUTION_ADMIN_PRIVATE_KEY?.trim()
  ? key("RESOLUTION_ADMIN_PRIVATE_KEY")
  : roles[2] === marketAdmin.address
    ? marketAdmin
    : undefined;
if (marketAdmin.address !== roles[0])
  throw new Error(`MARKET_ADMIN_PRIVATE_KEY is not the market admin ${roles[0]}`);
if (resolutionAdmin && resolutionAdmin.address !== roles[2])
  throw new Error(`RESOLUTION_ADMIN_PRIVATE_KEY is not the resolution admin ${roles[2]}`);

const wallet = createWalletClient({ chain, transport });
const admin = new Admin({
  api: apiOrigin(env.AUTOMATION_API_URL?.trim() || "http://127.0.0.1:3000"),
  origin: env.AUTOMATION_AUTH_ORIGIN?.trim() || "http://localhost:3002",
  client,
  wallet,
  exchange: getAddress(required("EXCHANGE_ADDRESS")),
  marketAdmin,
  ...(resolutionAdmin ? { resolutionAdmin } : {}),
});
// Vaults to curate: none without the config file.
const curation = Bun.file(
  env.AUTOMATION_VAULTS_PATH?.trim() || ".local/market-automation/vaults.json",
);
const curator = env.CURATOR_PRIVATE_KEY?.trim() ? key("CURATOR_PRIVATE_KEY") : marketAdmin;
const vaults = (await curation.exists())
  ? await Promise.all(
      ((await curation.json()) as VaultCurationConfig).vaults.map((config) =>
        CuratedVault.load(client, wallet, curator, config),
      ),
    )
  : [];
// Ladders to create: none without the config file.
const ladderFile = Bun.file(
  env.AUTOMATION_LADDERS_PATH?.trim() || ".local/market-automation/ladders.json",
);
const ladders: LadderConfig = (await ladderFile.exists())
  ? await loadLadders(client, await ladderFile.json())
  : { daily: [], weekly: [] };
const kalshi = new KalshiApi(
  env.KALSHI_API_URL?.trim() || "https://api.elections.kalshi.com/trade-api/v2",
);
/** Markets a fixing of these ladders creates. */
const markets = (list: Ladder[]) =>
  list.reduce((n, ladder) => n + ladder.tokens.reduce((m, token) => m + token.rungs, 0), 0);
logger.info("automation.started", {
  execute,
  jobs: JOBS.map((job) => job.name),
  marketAdmin: marketAdmin.address,
  resolves: Boolean(resolutionAdmin),
  vaults: vaults.map((vault) => vault.address),
  ladders: { daily: markets(ladders.daily), weekly: markets(ladders.weekly) },
});

const stopping = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stopping.abort());
const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    stopping.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

// Each job loops on its own interval; a run in progress finishes before shutdown.
await Promise.all(
  JOBS.map(async (job) => {
    const context = {
      admin,
      polygon,
      vaults,
      ladders,
      kalshi,
      execute,
      logger: logger.child({ job: job.name }),
    };
    while (!stopping.signal.aborted) {
      try {
        await job.run(context);
      } catch (error) {
        context.logger.error("job.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (once) process.exitCode = 1;
      }
      if (once) break;
      await pause(job.everyMs);
    }
  }),
);
logger.info("automation.stopped");
