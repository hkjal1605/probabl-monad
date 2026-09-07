/** Idle-only benchmark: owned Anvil/PG, independent mining clock, identical fresh starts. */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStorageProbe } from "../../../packages/db/src/indexer/verification.ts";

const root = resolve(import.meta.dir, "../../..");
const scratch = await mkdtemp(join(tmpdir(), "conditional-indexer-throughput-"));
const databaseUrl = "postgresql://throughput_test@127.0.0.1:19554/postgres";
const processes: { child: ReturnType<typeof Bun.spawn>; log: Promise<void>; name: string }[] = [];
const write = (path: string, value: unknown) =>
  Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
function spawn(name: string, command: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(command, {
    cwd: join(root, "services/rh-indexer"),
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const log = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).then(async ([stdout, stderr]) => {
    await write(join(scratch, `${name}.log.json`), { stdout, stderr });
  });
  processes.push({ child, log, name });
  return child;
}
async function until(label: string, predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    for (const { child, name } of processes)
      if (name !== "initdb" && child.exitCode !== null) throw new Error(`${name} exited`);
    try {
      if (await predicate()) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`Timeout: ${label}`);
}
async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch("http://127.0.0.1:19565", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`Owned Anvil ${method} failed`);
  return body.result;
}
const head = async (port: number) => {
  const response = await fetch(`http://127.0.0.1:${port}/indexer/health`, {
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error("head unavailable");
  return Number(body.head.indexedBlock);
};
const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples,
    meanLagBlocks: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    p95LagBlocks: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxLagBlocks: Math.max(...samples),
  };
};
const result: Record<string, unknown> = { completed: false, scratch, workload: "idle-only" };
const probes: ReturnType<typeof createStorageProbe>[] = [];
try {
  for (const port of [19554, 19565, 19566, 19567]) {
    const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("probe") });
    await probe.stop(true);
  }
  const init = spawn("initdb", [
    "initdb",
    "-D",
    join(scratch, "postgres"),
    "-U",
    "throughput_test",
    "--auth=trust",
    "--no-locale",
  ]);
  if ((await init.exited) !== 0) throw new Error("owned initdb failed");
  spawn("postgres", [
    "postgres",
    "-D",
    join(scratch, "postgres"),
    "-p",
    "19554",
    "-h",
    "127.0.0.1",
    "-k",
    scratch,
  ]);
  spawn("anvil", ["anvil", "--chain-id", "31337", "--port", "19565", "--quiet"]);
  await until("owned Anvil", async () => (await rpc("eth_chainId")) === "0x7a69");
  await rpc("anvil_mine", ["0x80", "0x0"]);
  const addresses = Object.fromEntries(
    [
      "CONDITIONAL_TOKENS_ADDRESS",
      "EXCHANGE_ADDRESS",
      "MARKET_REGISTRY_ADDRESS",
      "ORDER_RECOVERY_ROUTER_ADDRESS",
      "POSITION_ROUTER_ADDRESS",
      "PROTOCOL_AUTHORITY_ADDRESS",
      "RESOLUTION_CONTROLLER_ADDRESS",
      "SETTLEMENT_ADDRESS",
    ].map((key, index) => [key, `0x${(index + 4096).toString(16).padStart(40, "0")}`]),
  );
  for (const [name, port, retention] of [
    ["perf_bounded", 19566, 64],
    ["perf_cached", 19567, 1000000],
  ] as const) {
    spawn(
      name,
      ["bun", "scripts/ponder.ts", "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        ...addresses,
        DATABASE_URL: databaseUrl,
        DATABASE_SCHEMA: name,
        PONDER_SYNC_SCHEMA: `cs_sync_${name}`,
        ROBINHOOD_CHAIN_ID: "31337",
        ROBINHOOD_RPC_URL: "http://127.0.0.1:19565",
        ROBINHOOD_WS_URL: "",
        DEPLOYMENT_BLOCK: "0",
        INDEXER_END_BLOCK: "",
        INDEXER_BLOCK_RETENTION: "64",
        INDEXER_CACHE_RETENTION: String(retention),
        INDEXER_CACHE_MAINTENANCE_INTERVAL_MS: "1000",
        INDEXER_CACHE_MAINTENANCE_BATCH_SIZE: "2000",
        INDEXER_POLLING_INTERVAL_MS: "1000",
        INDEXER_MAX_HEAD_AGE_SECONDS: "3600",
        INDEXER_FINALITY_MODE: "local-depth",
        INDEXER_CONFIRMATION_MODE: "sequencer-depth",
        INDEXER_CONFIRMATION_BLOCKS: "2",
        INDEXER_FINALITY_BLOCKS: "30",
        PONDER_DISABLE_CACHE: "false",
        PONDER_TELEMETRY_DISABLED: "true",
        DO_NOT_TRACK: "1",
      },
    );
    probes.push(createStorageProbe(databaseUrl, name));
  }
  await Promise.all(
    [19566, 19567].map((port) => until("initial replay", async () => (await head(port)) === 128)),
  );
  await Bun.sleep(1200);
  let current = 128;
  let mining = true;
  const samples = { bounded: [] as number[], baseline: [] as number[] };
  const began = performance.now();
  const miner = (async () => {
    try {
      for (let i = 0; i < 600; i++) {
        await rpc("evm_mine");
        current++;
        await Bun.sleep(Math.max(0, began + (i + 1) * 100 - performance.now()));
      }
      return performance.now() - began;
    } finally {
      mining = false;
    }
  })();
  const sampler = (async () => {
    while (mining) {
      const before = current;
      const [bounded, baseline] = await Promise.all([head(19566), head(19567)]);
      samples.bounded.push(Math.max(0, before - bounded));
      samples.baseline.push(Math.max(0, before - baseline));
      await Bun.sleep(211); // Do not alias 1s polling; sampling never gates mining.
    }
  })();
  const [miningElapsedMs] = await Promise.all([miner, sampler]);
  await Promise.all(
    [19566, 19567].map((port) =>
      until("paced catchup", async () => (await head(port)) === current),
    ),
  );
  result.paced = {
    blocks: 600,
    miningElapsedMs,
    catchupElapsedMs: performance.now() - began,
    bounded: summarize(samples.bounded),
    baseline: summarize(samples.baseline),
  };
  const bursts = [];
  for (let i = 0; i < 3; i++) {
    const began = performance.now();
    await rpc("anvil_mine", ["0x100", "0x0"]);
    current += 256;
    const [boundedMs, baselineMs] = await Promise.all(
      [19566, 19567].map(async (port) => {
        await until("burst catchup", async () => (await head(port)) === current);
        return performance.now() - began;
      }),
    );
    bursts.push({ blocks: 256, boundedMs, baselineMs });
  }
  result.bursts = bursts;
  result.storage = await Promise.all(probes.map((probe) => probe.stats()));
  if (miningElapsedMs > 61_000) throw new Error("block-production clock fell behind");
  if (Math.max(...samples.bounded) > Math.max(...samples.baseline) + 10)
    throw new Error("bounded indexer developed excess lag");
  const boundedMs = bursts.reduce((sum, round) => sum + (round.boundedMs ?? 0), 0);
  const baselineMs = bursts.reduce((sum, round) => sum + (round.baselineMs ?? 0), 0);
  if (boundedMs > baselineMs * 1.1 + 1000) throw new Error("burst throughput regressed");
  result.completed = true;
  result.completedAt = new Date().toISOString();
  console.info("PASS independent 10-block/s mining and same-start cache comparison");
} catch (error) {
  result.error = String(error);
  process.exitCode = 1;
} finally {
  await Promise.all(probes.map((probe) => probe.close()));
  for (const { child } of [...processes].reverse())
    if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(
    processes.map(async ({ child, log }) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5000);
      await child.exited;
      clearTimeout(timer);
      await log;
    }),
  );
  await write(resolve(import.meta.dir, "evidence", "throughput.json"), result);
  console.info(JSON.stringify({ completed: result.completed, error: result.error, scratch }));
}
