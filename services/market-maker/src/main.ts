import { readFileSync } from "node:fs";
import { conditionalStocksAbi } from "@conditional-stocks/evm-client";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import { nativeCurrency } from "@conditional-stocks/shared/chains";
import { createPublicClient, defineChain, getAddress, http } from "viem";
import { settings } from "./config.ts";
import { Engine, log } from "./engine.ts";
import { Executor, signer } from "./execution.ts";
import { apiOrigin } from "./feeds.ts";
import { initialState, StateFile } from "./state.ts";

async function main() {
  const env = process.env,
    mode = env.MM_MODE ?? "dry-run";
  if (!["dry-run", "live"].includes(mode)) throw new Error("Invalid mode");
  const live = mode === "live";
  if (live && !process.argv.includes("--execute"))
    throw new Error("Live signing requires --execute as well as MM_MODE=live");
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const rpc = required("MM_RPC_URL"),
    url = new URL(rpc);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Invalid RPC transport");
  const config = settings(
    JSON.parse(
      readFileSync(env.MM_CONFIG_PATH ?? "services/market-maker/config.example.json", "utf8"),
    ),
  );
  const chainId = Number(required("MM_CHAIN_ID")),
    exchange = getAddress(required("MM_EXCHANGE"));
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: nativeCurrency(chainId),
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(rpc, { batch: { wait: 5 }, retryCount: 2 }),
  });
  if ((await client.getChainId()) !== chainId) throw new Error("RPC serves a different chain");
  const wallet = live
    ? signer(required("MM_PRIVATE_KEY"), required("MM_WALLET_ADDRESS"))
    : undefined;
  const owner =
    wallet?.address ??
    getAddress(env.MM_WALLET_ADDRESS ?? "0x000000000000000000000000000000000000dEaD");
  // The maker keeps its own replica of the exchange, read from the chain it signs against.
  const follower = new ChainFollower({
    client,
    exchange,
    quote: await client.readContract({
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "quote",
    }),
    deploymentBlock: BigInt(required("MM_DEPLOYMENT_BLOCK")),
    domain: `${chainId}:${exchange}`,
    pollMs: 1000,
    onError: () => log("chain-read-failed"),
  });
  await follower.start();
  const roles = follower.confirmed.config;
  if (
    live &&
    [roles.admin, roles.marketAdmin, roles.guardian, roles.resolutionAdmin].includes(owner)
  )
    throw new Error("Market maker must use a separate, non-governance wallet");
  const scope = [chainId, exchange, owner].join(":");
  const file = live
    ? new StateFile(env.MM_STATE_PATH ?? ".local/market-maker/state.json", scope)
    : undefined;
  const state = file?.state ?? initialState(scope),
    save = () => file?.save();
  const executor = wallet ? new Executor(client, wallet, config, state, save) : undefined;
  const origin = apiOrigin(env.MM_API_ORIGIN ?? "https://api.probabl.trade");
  const engine = new Engine(
    follower,
    new TokenReader(client),
    owner,
    chainId,
    config,
    origin,
    state,
    save,
    executor,
  );
  const controller = new AbortController();
  const stop = () => {
    engine.stopped = true;
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  log("starting", { mode, wallet: owner, markets: config.markets.length });
  try {
    if (process.argv.includes("--cancel") || process.argv.includes("--cancel-live")) {
      if (!live) throw new Error("Cancellation needs explicit execution");
      await engine.cancelMarket(undefined, process.argv.includes("--cancel-live"));
      return;
    }
    if (process.argv.includes("--fund")) {
      await engine.fund();
      return;
    }
    if (process.argv.includes("--static")) {
      if (!live) throw new Error("Static placement needs explicit execution");
      await engine.staticCycle();
      return;
    }
    do {
      try {
        await engine.cycle();
      } catch {
        log("cycle-paused", { reason: "Safety check or RPC failed; no blind transaction retry" });
        await engine
          .cancelMarket()
          .catch(() =>
            log("cancel-unavailable", { reason: "Orders retain their on-chain expiry" }),
          );
      }
      if (process.argv.includes("--once") || engine.stopped) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, config.pollMs);
        function done() {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", done);
          resolve();
        }
        controller.signal.addEventListener("abort", done, { once: true });
        if (controller.signal.aborted) done();
      });
    } while (!engine.stopped);
  } finally {
    if (engine.stopped)
      await engine
        .cancelMarket()
        .catch(() =>
          log("shutdown-cancel-unavailable", { reason: "Orders retain their on-chain expiry" }),
        );
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    follower.stop();
    file?.close();
  }
}
main().catch(() => {
  console.error(
    "Market maker stopped: configuration, funding, or safety validation failed. Sensitive diagnostics withheld.",
  );
  process.exitCode = 1;
});
