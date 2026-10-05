import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DELTA_VAULT_ROLES,
  DEPLOYLESS_BATCH_SIZE,
  deltaVaultAbi,
} from "@conditional-stocks/evm-client";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import { apiOrigin, Executor, signer } from "@conditional-stocks/operator";
import { type Address, createPublicClient, defineChain, getAddress, http } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { settings } from "./config.ts";
import { Keeper, log } from "./engine.ts";
import { initialState, StateFile } from "./state.ts";
import { Tick } from "./tick.ts";
import type { VaultIdentity } from "./vault.ts";

/** The keeper wallets of `VK_PRIVATE_KEYS`/`VK_WALLET_ADDRESSES` (comma-separated, in the same
 * order), or the single `VK_PRIVATE_KEY`/`VK_WALLET_ADDRESS`. */
function wallets(env: NodeJS.ProcessEnv) {
  const list = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const keys = list(env.VK_PRIVATE_KEYS ?? env.VK_PRIVATE_KEY),
    addresses = list(env.VK_WALLET_ADDRESSES ?? env.VK_WALLET_ADDRESS);
  if (!keys.length || keys.length !== addresses.length)
    throw new Error("VK_PRIVATE_KEYS and VK_WALLET_ADDRESSES must list the same keeper wallets");
  const found = new Map<Address, PrivateKeyAccount>();
  for (const [i, address] of addresses.entries()) {
    const account = signer(keys[i] ?? "", address, "VK_PRIVATE_KEYS", "VK_WALLET_ADDRESSES");
    found.set(account.address, account);
  }
  return found;
}

/** Quotes every configured Δ-vault in one process. Dry-run by default; signing needs
 * VK_MODE=live and --execute. Flags: --once (one round), --cancel (cancel every vault quote and
 * exit). */
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
  // Concurrent reads of every vault share one JSON-RPC batch, and contract reads share deployless
  // multicalls, each within a deployless call's limits. Each vault's view is a multicall of its own.
  const client = createPublicClient({
    chain,
    batch: { multicall: { deployless: true, batchSize: DEPLOYLESS_BATCH_SIZE, wait: 5 } },
    transport: http(rpc, { batch: { wait: 5 }, retryCount: 2 }),
  });
  if ((await client.getChainId()) !== chainId) throw new Error("RPC serves a different chain");

  const accounts = live ? wallets(env) : new Map<Address, PrivateKeyAccount>();
  const keeperOf = (vault: (typeof config.vaults)[number]) => {
    if (!live) return undefined;
    const address =
      vault.keeper ??
      (config.vaults.length === 1 && accounts.size === 1 ? [...accounts.keys()][0] : undefined);
    const account = address && accounts.get(getAddress(address));
    if (!account) throw new Error(`No keeper wallet is configured for vault ${vault.vault}`);
    return account;
  };
  const keepers = config.vaults.map(keeperOf);
  if (new Set(keepers.filter(Boolean)).size !== keepers.filter(Boolean).length)
    throw new Error("Each vault needs its own keeper wallet");
  // Every vault's identity and its keeper's roles, in one call.
  const read = (address: Address, functionName: string, args?: readonly unknown[]) =>
    ({ address, abi: deltaVaultAbi, functionName, ...(args ? { args } : {}) }) as const;
  const roles = (keeper: Address) =>
    (["keeper", "admin", "curator"] as const).map((role) => [DELTA_VAULT_ROLES[role], keeper]);
  const vaults = config.vaults.map((settings, i) => ({ settings, account: keepers[i] }));
  const startup = (await client.multicall({
    allowFailure: false,
    deployless: true,
    contracts: vaults.flatMap(({ settings: v, account }) => [
      read(v.vault, "EXCHANGE"),
      read(v.vault, "QUOTE"),
      read(v.vault, "BASE"),
      ...(account ? roles(account.address).map((args) => read(v.vault, "hasRole", args)) : []),
    ]) as never,
  })) as unknown[];
  let at = 0;
  const next = <T>() => {
    if (at >= startup.length) throw new Error("Incomplete vault read");
    return startup[at++] as T;
  };
  const entries = vaults.map(({ settings: v, account }) => {
    const identity: VaultIdentity = {
      address: v.vault,
      exchange: getAddress(next<Address>()),
      quote: getAddress(next<Address>()),
      base: getAddress(next<Address>()),
    };
    if (account) {
      const isKeeper = next<boolean>(),
        isAdmin = next<boolean>(),
        isCurator = next<boolean>();
      if (!isKeeper) throw new Error(`The wallet is not vault ${v.vault}'s keeper`);
      if (isAdmin || isCurator)
        throw new Error("A keeper must not also hold its vault's admin or curator role");
    }
    return { settings: v, account, identity };
  });
  const [first] = entries;
  if (!first) throw new Error("Configure the vaults to quote");
  const { exchange, quote } = first.identity;
  if (entries.some((e) => e.identity.exchange !== exchange))
    throw new Error("Every vault must trade on the same exchange");

  // One replica of the exchange for every vault, read from the chain the keepers sign against.
  const follower = new ChainFollower({
    client,
    exchange,
    quote,
    deploymentBlock: BigInt(required("VK_DEPLOYMENT_BLOCK")),
    domain: `${chainId}:${exchange}`,
    pollMs: 1000,
    onError: () => log("chain-read-failed"),
  });
  await follower.start();
  const tokens = new TokenReader(client);
  const origin = apiOrigin(env.VK_API_ORIGIN ?? "https://api.probabl.trade");
  const bases = [...new Set(entries.map((e) => e.identity.base))];
  const rounds: { current?: Tick } = {};
  const files: StateFile[] = [];
  const directory = env.VK_STATE_DIR ?? ".local/vault-keeper";
  const running = entries.map(({ settings: v, account, identity }) => {
    const scope = [chainId, v.vault, account?.address ?? "dry-run"].join(":");
    // One state file (and transaction journal) per vault and wallet.
    const path =
      env.VK_STATE_PATH && config.vaults.length === 1
        ? env.VK_STATE_PATH
        : resolve(directory, `${chainId}-${v.vault.toLowerCase()}.json`);
    const file = account ? new StateFile(path, scope) : undefined;
    if (file) files.push(file);
    const state = file?.state ?? initialState(scope),
      save = () => file?.saveAsync();
    const executor = account
      ? new Executor(client, account, config, state, save, {
          receiptPollMs: config.receiptPollMs,
          fees: () => rounds.current?.gasFees() ?? Promise.resolve(undefined),
          gasHeadroomBps: 2500,
        })
      : undefined;
    return new Keeper(
      follower,
      tokens,
      client,
      chainId,
      config,
      v,
      identity,
      state,
      save,
      executor,
    );
  });

  const controller = new AbortController();
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const keeper of running) keeper.stopped = true;
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  log("starting", {
    mode,
    vaults: running.map((k) => k.vault),
    keepers: keepers.map((k) => k?.address ?? null),
  });
  const busy = new Map<Keeper, Promise<void>>();
  const run = (keeper: Keeper, tick: Tick) => {
    const cycle = keeper
      .cycle(tick)
      .catch(async () => {
        keeper.log("cycle-paused", {
          reason: "Safety check or RPC failed; no blind transaction retry",
        });
        await keeper
          .cancelAll()
          .catch(() =>
            keeper.log("cancel-unavailable", { reason: "Quotes keep their on-chain expiry" }),
          );
      })
      .finally(() => busy.delete(keeper));
    busy.set(keeper, cycle);
  };
  try {
    if (process.argv.includes("--cancel")) {
      if (!live) throw new Error("Cancellation needs explicit execution");
      await Promise.all(running.map((keeper) => keeper.cancelAll()));
      return;
    }
    // Rounds start on a fixed cadence; a vault still busy with the last round joins the next.
    let due = Date.now();
    while (!stopped) {
      const tick = new Tick({ origin, client, tokens, quote, bases });
      rounds.current = tick;
      for (const keeper of running) if (!busy.has(keeper)) run(keeper, tick);
      if (process.argv.includes("--once")) {
        await Promise.all(busy.values());
        break;
      }
      due += config.pollMs;
      if (due <= Date.now()) due = Date.now() + config.pollMs;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, due - Date.now());
        function done() {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", done);
          resolve();
        }
        controller.signal.addEventListener("abort", done, { once: true });
        if (controller.signal.aborted) done();
      });
    }
    await Promise.all(busy.values());
  } finally {
    if (stopped)
      await Promise.all(
        running.map((keeper) =>
          keeper.cancelAll().catch(() =>
            keeper.log("shutdown-cancel-unavailable", {
              reason: "Quotes keep their on-chain expiry",
            }),
          ),
        ),
      );
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    follower.stop();
    for (const file of files) file.close();
  }
}
main().catch(() => {
  console.error(
    "Vault keeper stopped: configuration or safety validation failed. Sensitive diagnostics withheld.",
  );
  process.exitCode = 1;
});
