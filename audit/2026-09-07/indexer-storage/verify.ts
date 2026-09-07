/** Reproducible local checks; records no private env files or database credentials. */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const output = resolve(import.meta.dir, "evidence");
await mkdir(output, { recursive: true });
const checks = [
  ["typescript", ["bun", "test"]],
  ["typecheck", ["bun", "run", "typecheck"]],
  [
    "audit-scripts",
    [
      "bunx",
      "--no-install",
      "tsc",
      "--ignoreConfig",
      "--noEmit",
      "--target",
      "esnext",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--types",
      "bun",
      "--allowImportingTsExtensions",
      "--skipLibCheck",
      "--strict",
      "audit/2026-09-07/indexer-storage/verify.ts",
      "audit/2026-09-07/indexer-storage/capture.ts",
      "audit/2026-09-07/indexer-storage/throughput.ts",
    ],
  ],
  ["format", ["bunx", "--no-install", "biome", "ci", "."]],
  ["contracts", ["forge", "test", "--root", "packages/contracts", "--summary"]],
] as const;
for (const [name, command] of checks) {
  const began = Date.now();
  const child = Bun.spawn([...command], {
    cwd: root,
    env: { ...process.env, LOG_LEVEL: "silent" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await Bun.write(
    resolve(output, `${name}.json`),
    `${JSON.stringify({ command, code, elapsedMs: Date.now() - began, stdout, stderr }, null, 2)}\n`,
  );
  console.info(`${name}: ${code === 0 ? "PASS" : "FAIL"}`);
  if (code !== 0) throw new Error(`${name} failed; see ${output}`);
}
const files = [
  "audit/2026-09-07/indexer-storage/verify.ts",
  "audit/2026-09-07/indexer-storage/capture.ts",
  "audit/2026-09-07/indexer-storage/throughput.ts",
  "package.json",
  "bun.lock",
  "patches/ponder@0.17.8.patch",
  "packages/db/src/indexer/cache.ts",
  "packages/db/src/indexer/cache-policy.ts",
  "packages/db/src/indexer/schema.ts",
  "packages/db/src/indexer/writes.ts",
  "packages/db/src/indexer/reads.ts",
  "packages/db/src/indexer/verification.ts",
  "packages/db/tests/cache-retention.test.ts",
  "packages/contracts/scripts/verify-internal-stack.ts",
  "services/rh-indexer/scripts/ponder.ts",
  "services/rh-indexer/src/canonical-block.ts",
  "services/rh-indexer/src/environment.ts",
  "services/rh-indexer/src/api/index.ts",
  "services/rh-indexer/tests/canonical-block.test.ts",
  "services/rh-indexer/tests/environment.test.ts",
  "services/rh-indexer/ponder.config.ts",
];
await Bun.write(
  resolve(output, "source.json"),
  `${JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      files: await Promise.all(
        files.map(async (file) => ({
          file,
          sha256: createHash("sha256")
            .update(await Bun.file(resolve(root, file)).bytes())
            .digest("hex"),
        })),
      ),
    },
    null,
    2,
  )}\n`,
);
