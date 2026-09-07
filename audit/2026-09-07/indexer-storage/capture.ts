/** Copy only allowlisted non-secret integration results and storage log events. */
import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

const [mode, supplied] = Bun.argv.slice(2);
if (!supplied || (mode !== "postgres" && mode !== "pglite-ui"))
  throw new Error("Usage: bun capture.ts postgres|pglite-ui OWNED_SCRATCH_DIRECTORY");
const scratch = await realpath(supplied);
const temporary = await realpath(tmpdir());
if (
  relative(temporary, scratch).startsWith("..") ||
  !basename(scratch).startsWith("conditional-stack-")
)
  throw new Error("Only owned stack rehearsal output under the temporary directory is allowed");
const output = resolve(import.meta.dir, "evidence", mode);
await mkdir(output, { recursive: true });
const result = await Bun.file(join(scratch, "result.json")).json();
if (result.completed !== true || result.chainId !== 31337 || result.upstreamTransactions !== 0)
  throw new Error("Only successful local Anvil results may be recorded");
// Do not retain an environment-file path or copy environment/SQLite/PG files.
const { envFile: _envFile, ...safeResult } = result;
await Bun.write(join(output, "result.json"), `${JSON.stringify(safeResult, null, 2)}\n`);
if (mode === "postgres")
  await Bun.write(
    join(output, "storage-evidence.json"),
    await Bun.file(join(scratch, "storage-evidence.json")).text(),
  );
const events: { process: string; event: unknown }[] = [];
const rpcRates: { process: string; line: string }[] = [];
for (const name of [
  "indexer",
  "indexer-crash-restarted",
  "indexer-clean-restarted",
  "storage-rebuild",
  "indexer-performance",
  "storage-baseline-performance",
]) {
  const file = Bun.file(join(scratch, `${name}.log.json`));
  if (!(await file.exists())) continue;
  const log = (await file.json()) as { stdout: string; stderr: string };
  for (const stream of [log.stdout, log.stderr])
    for (const rawLine of stream.split("\n")) {
      const line = stripVTControlCharacters(rawLine);
      if (line.includes("Increased JSON-RPC provider RPS limit"))
        rpcRates.push({ process: name, line });
      try {
        const event = JSON.parse(line);
        if (
          typeof event.event === "string" &&
          (event.event.startsWith("indexer.cache.") || event.event === "indexer.storage.ready")
        )
          events.push({ process: name, event });
      } catch {
        // Ponder pretty logs are intentionally excluded; only structured storage events.
      }
    }
}
await Bun.write(join(output, "storage-events.json"), `${JSON.stringify(events, null, 2)}\n`);
await Bun.write(join(output, "rpc-rate-events.json"), `${JSON.stringify(rpcRates, null, 2)}\n`);
console.info(`Captured ${mode}: ${result.checks.length} checks, ${events.length} storage events`);
