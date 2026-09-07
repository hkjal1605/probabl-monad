/** Snapshot identities after final verification; never reads or emits private environment values. */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadArtifact,
  loadConditionalTokensArtifact,
} from "../../../../packages/contracts/scripts/lib.ts";
import {
  CTF_CREATION_HASH,
  CTF_RUNTIME_HASH,
  sourceManifest,
} from "../../../../packages/contracts/scripts/security.ts";
import { protocolContractNames } from "../../../../packages/contracts/scripts/verify-deployment.ts";

const root = resolve(import.meta.dir, "../../../..");
const files: string[] = [];
async function walk(directory: string) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (["node_modules", "out", "cache", "broadcast", ".DS_Store"].includes(entry.name)) continue;
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push(path);
  }
}
await walk("packages/contracts");
files.push(
  "packages/domain/src/resolution.ts",
  "packages/domain/src/resolution.test.ts",
  "packages/domain/src/market-config.ts",
  "packages/domain/src/index.ts",
  "apps/api/src/admin-chain.ts",
  "apps/api/src/admin-evidence-service.ts",
  "apps/api/src/admin-evidence.test.ts",
  "apps/admin-ui/src/modules/MarketControlsPageModule/MarketControls.tsx",
  "services/rh-indexer/scripts/resolve-anvil-market.ts",
  "services/settlement-worker/scripts/anvil-e2e.ts",
  "packages/contract-bindings/src/generated.ts",
  ".github/workflows/ci.yml",
  "package.json",
  "biome.json",
  "SECURITY.md",
  "docs/architecture/protocol-v1.md",
  "docs/architecture/risk-caps.md",
  "docs/architecture/polymarket-data-admin-evidence-v1.md",
  "docs/runbooks/deployment.md",
  "docs/runbooks/direct-recovery.md",
  "docs/runbooks/manual-resolution.md",
  "CONDITIONAL_STOCKS_IMPLEMENTATION_PLAN.md",
  "plans/04-market-registry.md",
  "plans/15-capped-mainnet-pilot.md",
  "audit/2026-09-06/remediation/verification/prove-accounting.py",
  "audit/2026-09-06/remediation/verification/run-checks.ts",
  "audit/2026-09-06/remediation/verification/capture-scope.ts",
);
const inventory = await Promise.all(
  files.sort().map(async (path) => {
    const bytes = await Bun.file(resolve(root, path)).bytes();
    const content = new TextDecoder().decode(bytes);
    return {
      path,
      bytes: bytes.length,
      lines: content.split("\n").length - Number(content.endsWith("\n")),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }),
);
const dependencySources = new Map<string, string>();
const artifacts = await Promise.all(
  protocolContractNames.map(async (name) => {
    const artifact = await loadArtifact(name);
    for (const [path, source] of Object.entries(artifact.metadata.sources))
      dependencySources.set(path, source.keccak256);
    return {
      name,
      runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
      creationBytes: (artifact.bytecode.object.length - 2) / 2,
      creationBytecodeSha256WithoutConstructorArgs: createHash("sha256")
        .update(Buffer.from(artifact.bytecode.object.slice(2), "hex"))
        .digest("hex"),
      runtimeTemplateSha256WithUnpatchedImmutables: createHash("sha256")
        .update(Buffer.from(artifact.deployedBytecode.object.slice(2), "hex"))
        .digest("hex"),
    };
  }),
);
const ctf = await loadConditionalTokensArtifact();
const forge = Bun.spawn(["forge", "--version"], { cwd: root, stdout: "pipe" });
const forgeVersion = await new Response(forge.stdout).text();
if ((await forge.exited) !== 0) throw new Error("Forge version check failed");
const scope = {
  recordedAt: new Date().toISOString(),
  source: await sourceManifest(),
  inventory,
  authoredContractFiles: inventory.filter((file) => file.path.startsWith("packages/contracts/"))
    .length,
  productionSolidityLines: inventory
    .filter((file) => file.path.startsWith("packages/contracts/src/"))
    .reduce((sum, file) => sum + file.lines, 0),
  artifacts,
  conditionalTokens: {
    runtimeHash: CTF_RUNTIME_HASH,
    creationHash: CTF_CREATION_HASH,
    runtimeBytes: (ctf.deployedBytecode.length - 2) / 2,
  },
  compilerDependencySourceHashes: [...dependencySources]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, hash]) => ({ path, keccak256: hash })),
  toolchain: {
    bun: Bun.version,
    forge: forgeVersion.trim(),
    solc: "0.8.30+commit.73712a01",
    evmVersion: "paris",
    viaIR: true,
    optimizerRuns: 7500,
    metadataHash: "none",
    appendCBOR: false,
  },
  note: "Template runtime hashes contain unpatched immutables and are NOT deployed-runtime allowlist values. Exact deployed hashes and constructor arguments are in the local rehearsal manifests. This is a scoped review, not production approval.",
};
await Bun.write(
  resolve(import.meta.dir, "../evidence/scope.json"),
  `${JSON.stringify(scope, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      source: scope.source.digest,
      authoredContractFiles: scope.authoredContractFiles,
      productionSolidityFiles: scope.source.files.length,
      productionSolidityLines: scope.productionSolidityLines,
      lock: scope.source.lockSha256,
      artifacts,
    },
    null,
    2,
  ),
);
