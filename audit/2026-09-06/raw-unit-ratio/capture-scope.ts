/** Reproducible v2 scope capture. Never reads secret environment files or historical databases. */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadArtifact } from "../../../packages/contracts/scripts/lib.ts";
import { sourceManifest } from "../../../packages/contracts/scripts/security.ts";
import { protocolContractNames } from "../../../packages/contracts/scripts/verify-deployment.ts";

const root = resolve(import.meta.dir, "../../..");
const paths: string[] = [];
const excluded = new Set([
  "node_modules",
  "out",
  "cache",
  "dist",
  "build",
  "broadcast",
  "deployments",
  ".next",
  ".ponder",
  ".data",
  ".git",
  ".turbo",
  "coverage",
]);
async function walk(directory: string): Promise<void> {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(path);
    else if (
      entry.isFile() &&
      /(?:\.(?:sol|ts|tsx|json|md|toml|yaml|yml)|\.env\.example|\.gas-snapshot)$/.test(path)
    )
      paths.push(path);
  }
}
for (const directory of ["packages", "services", "apps", "docs", "plans", ".github"])
  await walk(directory);
paths.push(
  "package.json",
  "bun.lock",
  "biome.json",
  "SECURITY.md",
  "README.md",
  "audit/2026-09-06/raw-unit-ratio/capture-scope.ts",
);
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const inventory = await Promise.all(
  [...new Set(paths)].sort().map(async (path) => {
    const bytes = await Bun.file(resolve(root, path)).bytes();
    const text = new TextDecoder().decode(bytes);
    return {
      path,
      bytes: bytes.length,
      lines: text.split("\n").length - Number(text.endsWith("\n")),
      sha256: sha256(bytes),
    };
  }),
);
const artifacts = await Promise.all(
  protocolContractNames.map(async (name) => {
    const artifact = await loadArtifact(name);
    return {
      name,
      runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
      creationBytes: (artifact.bytecode.object.length - 2) / 2,
      runtimeTemplateSha256: sha256(Buffer.from(artifact.deployedBytecode.object.slice(2), "hex")),
      creationBytecodeSha256: sha256(Buffer.from(artifact.bytecode.object.slice(2), "hex")),
    };
  }),
);
const source = await sourceManifest();
const scope = {
  recordedAt: new Date().toISOString(),
  source,
  inventory,
  artifacts,
  inventoryDigest: sha256(inventory.map((file) => `${file.path} ${file.sha256}\n`).join("")),
  productionSolidityLines: inventory
    .filter((file) => file.path.startsWith("packages/contracts/src/"))
    .reduce((sum, file) => sum + file.lines, 0),
  toolchain: {
    bun: Bun.version,
    solc: "0.8.30+commit.73712a01",
    evmVersion: "paris",
    viaIR: true,
    optimizerRuns: 7500,
    metadataHash: "none",
    appendCBOR: false,
  },
  limits:
    "Inventory identifies supporting scope, not a claim of line-by-line review of every UI or dependency file. All 26 production Solidity files were re-reviewed in full. Runtime templates contain unpatched immutables; they are not deployed runtime allowlist values. Secret environments, databases, generated build/cache directories and historical deployments are excluded. No production approval.",
};
await Bun.write(
  resolve(import.meta.dir, "evidence/scope.json"),
  `${JSON.stringify(scope, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      source: source.digest,
      lock: source.lockSha256,
      files: inventory.length,
      productionSolidityLines: scope.productionSolidityLines,
      artifacts,
    },
    null,
    2,
  ),
);
