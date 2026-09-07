/** Capture authored runtime identities and selected NON-secret local test evidence. */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sourceManifest } from "../../../packages/contracts/scripts/security.ts";

const root = resolve(import.meta.dir, "../../..");
const output = resolve(import.meta.dir, "evidence");
const files = [
  "package.json",
  "bun.lock",
  "biome.json",
  ".env.example",
  "README.md",
  "SECURITY.md",
];
async function walk(directory: string) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (["node_modules", "out", "cache", "broadcast", "dist", "deployments"].includes(entry.name))
      continue;
    const path = `${directory}/${entry.name}`;
    if (path === "packages/contracts/lib") continue;
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push(path);
  }
}
for (const directory of ["apps", "packages", "services", "docs/runbooks"]) await walk(directory);
const inventory = await Promise.all(
  files.sort().map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await Bun.file(resolve(root, path)).bytes())
      .digest("hex"),
  })),
);
await mkdir(output, { recursive: true });
const save = (name: string, value: unknown) =>
  Bun.write(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
const source = await sourceManifest();
await save("source-scope.json", {
  recordedAt: new Date().toISOString(),
  solidity: source,
  inventory,
  digest: createHash("sha256")
    .update(inventory.map((item) => `${item.path} ${item.sha256}\n`).join(""))
    .digest("hex"),
  note: "Identity snapshot, not a claim of independent whole-program formal verification. Private env files and databases are excluded.",
});
const scratch = Bun.argv[2];
const label = Bun.argv[3] ?? "";
if (label && !/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid evidence label");
const artifact = (name: string, value: unknown) => save(label ? `${label}-${name}` : name, value);
if (scratch) {
  if (!/^\/(?:private\/)?var\/folders\/.+\/conditional-stack-[A-Za-z0-9]+$/.test(scratch))
    throw new Error("Expected an explicitly selected owned rehearsal scratch path");
  const report = await Bun.file(resolve(scratch, "result.json")).json();
  await artifact("stack-result.json", report);
  const db = new Database(resolve(scratch, "reconciler.sqlite"), { readonly: true });
  await artifact("reconciliation-summary.json", {
    runs: db
      .query("SELECT status, count(*) AS count FROM reconciliation_run GROUP BY status")
      .all(),
    latest: JSON.parse(
      (
        db.query("SELECT report_json FROM reconciliation_run ORDER BY id DESC LIMIT 1").get() as {
          report_json: string;
        }
      ).report_json,
    ),
  });
  db.close();
  for (const name of [
    "ui-build",
    "admin-build",
    "indexer",
    "reconciler",
    "reconciler-restarted",
    "matcher",
    "matcher-restarted",
    "worker",
    "api",
  ]) {
    const file = Bun.file(resolve(scratch, `${name}.log.json`));
    if (await file.exists()) await artifact(`${name}.log.json`, await file.json());
  }
}
console.info(
  JSON.stringify({
    solidity: source.digest,
    lock: source.lockSha256,
    authoredFiles: inventory.length,
    evidence: output,
  }),
);
