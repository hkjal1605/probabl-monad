import { readFileSync } from "node:fs";
import {
  conditionalStocksAbi,
  DELTA_VAULT_ROLES,
  deltaVaultAbi,
} from "@conditional-stocks/evm-client";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import { apiOrigin, Executor, signer } from "@conditional-stocks/operator";
import { createPublicClient, defineChain, getAddress, http } from "viem";
import { settings } from "./config.ts";
import { Keeper, log } from "./engine.ts";
import { initialState, StateFile } from "./state.ts";

/** Quotes a Δ-vault's markets. Dry-run by default; signing needs VK_MODE=live and --execute.
 * Flags: --once (one cycle), --cancel (cancel every vault quote and exit). */
async function main() {
  const env = process.env,
    mode = env.VK_MODE ?? "dry-run";
  if (!["dry-run", "live"].includes(mode)) throw new Error("Invalid mode");
  const live = mode === "live";
  if (live && !process.argv.includes("--execute"))
    throw new Error("Live signing requires --execute as well as VK_MODE=live");
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const rpc = required("VK_RPC_URL"),
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
      readFileSync(env.VK_CONFIG_PATH ?? "services/vault-keeper/config.example.json", "utf8"),
    ),
  );
  const chainId = Number(required("VK_CHAIN_ID"));
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({
    chain,
    batch: { multicall: { deployless: true, wait: 5 } },
    transport: http(rpc, { batch: { wait: 5 }, retryCount: 2 }),
  });
  if ((await client.getChainId()) !== chainId) throw new Error("RPC serves a different chain");
  const vault = config.vault;
  const exchange = getAddress(
    await client.readContract({ address: vault, abi: deltaVaultAbi, functionName: "EXCHANGE" }),
  );
  const wallet = live
    ? signer(
        required("VK_PRIVATE_KEY"),
        required("VK_WALLET_ADDRESS"),
        "VK_PRIVATE_KEY",
        "VK_WALLET_ADDRESS",
      )
    : undefined;
  if (wallet) {
    const role = (name: keyof typeof DELTA_VAULT_ROLES) =>
      client.readContract({
        address: vault,
        abi: deltaVaultAbi,
        functionName: "hasRole",
        args: [DELTA_VAULT_ROLES[name], wallet.address],
      });
    if (!(await role("keeper"))) throw new Error("The wallet is not this vault's keeper");
    if ((await role("admin")) || (await role("curator")))
      throw new Error("The keeper must not also hold the vault's admin or curator role");
  }
  // The keeper keeps its own replica of the exchange, read from the chain it signs against.
  const follower = new ChainFollower({
    client,
    exchange,
    quote: await client.readContract({
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "quote",
    }),
    deploymentBlock: BigInt(required("VK_DEPLOYMENT_BLOCK")),
    domain: `${chainId}:${exchange}`,
    pollMs: 1000,
    onError: () => log("chain-read-failed"),
  });
  await follower.start();
  const scope = [chainId, vault, wallet?.address ?? "dry-run"].join(":");
  const file = wallet
    ? new StateFile(env.VK_STATE_PATH ?? ".local/vault-keeper/state.json", scope)
    : undefined;
  const state = file?.state ?? initialState(scope),
    save = () => file?.save();
  const executor = wallet ? new Executor(client, wallet, config, state, save) : undefined;
  const keeper = new Keeper(
    follower,
    new TokenReader(client),
    client,
    chainId,
    config,
    apiOrigin(env.VK_API_ORIGIN ?? "https://api.probabl.trade"),
    state,
    save,
    executor,
  );
  const controller = new AbortController();
  const stop = () => {
    keeper.stopped = true;
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  log("starting", { mode, vault, keeper: wallet?.address, markets: config.markets.length });
  try {
    if (process.argv.includes("--cancel")) {
      if (!executor) throw new Error("Cancellation needs explicit execution");
      await keeper.cancelAll();
      return;
    }
    do {
      try {
        await keeper.cycle();
      } catch {
        log("cycle-paused", { reason: "Safety check or RPC failed; no blind transaction retry" });
        await keeper
          .cancelAll()
          .catch(() => log("cancel-unavailable", { reason: "Quotes keep their on-chain expiry" }));
      }
      if (process.argv.includes("--once") || keeper.stopped) break;
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
    } while (!keeper.stopped);
  } finally {
    if (keeper.stopped)
      await keeper
        .cancelAll()
        .catch(() =>
          log("shutdown-cancel-unavailable", { reason: "Quotes keep their on-chain expiry" }),
        );
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    follower.stop();
    file?.close();
  }
}
main().catch(() => {
  console.error(
    "Vault keeper stopped: configuration or safety validation failed. Sensitive diagnostics withheld.",
  );
  process.exitCode = 1;
});
