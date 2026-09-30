/** Runs every service against a local anvil deployment with an isolated, owned PostgreSQL
 * cluster. anvil is started separately, so shutdown never stops a user's node or touches
 * another database.
 *
 *   anvil &                                   # a local node
 *   bun run anvil:bootstrap                   # deploy the exchange and mock tokens
 *   bun --env-file=.local/anvil.env scripts/evm/dev.ts
 *
 * The Polymarket ingestor runs when POLYMARKET_INTERNAL_TOKEN is set (16+ characters); the
 * market maker and the Δ-vault keeper run when MM_CONFIG_PATH and VK_CONFIG_PATH exist (written
 * by scripts/evm/seed-markets.ts), next to the vault's mock-feed relay. */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { localDatabase } from "../../packages/database/src/local.ts";

if (!process.env.EXCHANGE_ADDRESS || !process.env.RPC_URL)
  throw new Error("Run anvil:bootstrap, then bun --env-file=.local/anvil.env scripts/evm/dev.ts");
const database = await localDatabase(process.env.DATABASE_URL);
const ingestor = (process.env.POLYMARKET_INTERNAL_TOKEN ?? "").length >= 16;
const environment: Record<string, string | undefined> = {
  ...process.env,
  DATABASE_URL: database.connectionString,
  ...(ingestor
    ? { POLYMARKET_INGESTOR_URL: process.env.POLYMARKET_INGESTOR_URL ?? "http://127.0.0.1:42073" }
    : {}),
};
const children: ChildProcess[] = [];
let stopping = false;
const terminate = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* The owned process group has already exited. */
    }
  }
};
const stop = async () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) terminate(child, "SIGTERM");
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              terminate(child, "SIGKILL");
              resolve();
            }, 5000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
    ),
  );
  await database.close();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

const run = (name: string, args: string[], required = true) => {
  // Children see exactly this environment, never a repository .env auto-loaded by Bun.
  const child = spawn(process.execPath, ["--no-env-file", ...args], {
    stdio: "inherit",
    env: environment,
    detached: true,
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(name, error);
    if (required) void stop();
  });
  child.once("exit", (code) => {
    if (!stopping && required) {
      console.error(`${name} exited ${code}`);
      void stop();
    }
  });
  return child;
};

// Schema operations are owned by packages/database, before runtime services start.
const migration = run("migrate", ["packages/database/scripts/migrate.ts"], false);
const migrated = await new Promise<number | null>((resolve) => migration.once("exit", resolve));
children.splice(children.indexOf(migration), 1);
if (migrated !== 0 || stopping) {
  await stop();
  throw new Error("Database migration failed");
}
if (ingestor) run("polymarket-ingestor", ["services/polymarket-ingestor/src/main.ts"]);
run("api", ["apps/server/src/main.ts"]);
run("web", ["run", "--filter", "@conditional-stocks/web", "dev"]);
run("admin", ["run", "--filter", "@conditional-stocks/admin-ui", "dev"]);
if (process.env.MM_CONFIG_PATH && existsSync(process.env.MM_CONFIG_PATH))
  run("market-maker", ["services/market-maker/src/main.ts", "--execute"], false);
if (process.env.DELTA_VAULT_FEED) run("feed-relay", ["scripts/evm/feed-relay.ts"], false);
if (process.env.VK_CONFIG_PATH && existsSync(process.env.VK_CONFIG_PATH))
  run("vault-keeper", ["services/vault-keeper/src/main.ts", "--execute"], false);
console.info(
  `Trading UI: http://localhost:3001 · Admin: http://localhost:3002 · API: http://127.0.0.1:${environment.API_PORT ?? 3000}` +
    (ingestor
      ? " · Polymarket ingestor enabled"
      : " · Set POLYMARKET_INTERNAL_TOKEN to enable Polymarket data"),
);
const location = new URL(database.connectionString);
location.password = "";
console.info(`Local database: ${location.toString()}`);
