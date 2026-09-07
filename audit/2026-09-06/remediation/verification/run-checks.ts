/** Reproducible evidence capture. Each invocation selects exactly one check. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const evidence = Bun.env.AUDIT_EVIDENCE_DIRECTORY
  ? resolve(Bun.env.AUDIT_EVIDENCE_DIRECTORY)
  : resolve(import.meta.dir, "../evidence");
const analysisBuild = Bun.env.AUDIT_BUILD_DIRECTORY ?? resolve(evidence, "slither-build");
await mkdir(evidence, { recursive: true });
const checks: Record<string, { command: string[]; cwd?: string; env?: Record<string, string> }> = {
  "clean-build": { command: ["forge", "build", "--root", "packages/contracts", "--no-cache"] },
  "forge-ci": {
    command: ["forge", "test", "--root", "packages/contracts", "-vv"],
    env: { FOUNDRY_PROFILE: "ci", FOUNDRY_FUZZ_SEED: "0x20260906" },
  },
  "forge-default": {
    command: ["forge", "test", "--root", "packages/contracts", "-vv"],
    env: { FOUNDRY_FUZZ_SEED: "0x5afe20260906" },
  },
  snapshot: {
    command: [
      "forge",
      "snapshot",
      "--root",
      "packages/contracts",
      "--snap",
      "packages/contracts/.gas-snapshot",
    ],
    env: { FOUNDRY_PROFILE: "default", FOUNDRY_FUZZ_SEED: "0x5afe20260906" },
  },
  "forge-sizes": {
    command: ["forge", "build", "--root", "packages/contracts", "--sizes", "--skip", "test"],
  },
  "forge-lint": { command: ["forge", "lint", "--root", "packages/contracts"] },
  "forge-format": { command: ["forge", "fmt", "--root", "packages/contracts", "--check"] },
  coverage: {
    command: [
      "forge",
      "coverage",
      "--root",
      "packages/contracts",
      "--ir-minimum",
      "--report",
      "summary",
      "--report",
      "lcov",
      "--report-file",
      resolve(evidence, "coverage.lcov"),
    ],
    env: { FOUNDRY_FUZZ_SEED: "0x20260906" },
  },
  "typescript-tests": { command: ["bun", "test"] },
  typecheck: { command: ["bun", "run", "typecheck"] },
  biome: { command: ["bunx", "biome", "ci", "."] },
  arithmetic: {
    command: [Bun.env.AUDIT_PYTHON ?? "python3", resolve(import.meta.dir, "prove-accounting.py")],
  },
  slither: {
    command: [
      Bun.env.AUDIT_SLITHER ?? "slither",
      ".",
      "--foundry-ignore-compile",
      "--foundry-build-info-directory",
      resolve(analysisBuild, "build-info"),
      "--exclude-dependencies",
      "--filter-paths",
      "(node_modules|test)/",
      "--json",
      resolve(evidence, "slither.json"),
      "--fail-none",
    ],
    cwd: resolve(root, "packages/contracts"),
  },
  "slither-build": {
    command: [
      "forge",
      "build",
      "--root",
      "packages/contracts",
      "--build-info",
      "--skip",
      "./test/**",
      "--out",
      resolve(analysisBuild, "out"),
      "--cache-path",
      resolve(analysisBuild, "cache"),
      "--build-info-path",
      resolve(analysisBuild, "build-info"),
    ],
  },
  deployment: {
    command: ["bun", "packages/contracts/scripts/rehearse-deployment.ts"],
    env: { AUDIT_DEPLOYMENT_OUTPUT: resolve(evidence, "local-deployment") },
  },
};
const name = Bun.argv[2];
const check = name ? checks[name] : undefined;
if (!name || !check) throw new Error(`Select one check: ${Object.keys(checks).join(", ")}`);
if (name === "slither" && (await Bun.file(resolve(evidence, "slither.json")).exists()))
  throw new Error(
    "Preserve the prior Slither snapshot: set AUDIT_EVIDENCE_DIRECTORY to a fresh directory before rerunning",
  );
const started = new Date().toISOString();
const process = Bun.spawn(check.command, {
  cwd: check.cwd ?? root,
  env: { ...Bun.env, ...check.env },
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(process.stdout).text(),
  new Response(process.stderr).text(),
  process.exited,
]);
await Bun.write(resolve(evidence, `${name}.stdout.log`), stdout);
await Bun.write(resolve(evidence, `${name}.stderr.log`), stderr);
const result = {
  name,
  command: check.command,
  cwd: check.cwd ?? root,
  environmentOverrides: check.env ?? {},
  started,
  finished: new Date().toISOString(),
  exitCode,
};
await Bun.write(resolve(evidence, `${name}.result.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
console.log(stdout.slice(-16000));
console.error(stderr.slice(-6000));
if (exitCode !== 0) throw new Error(`${name} failed with exit code ${exitCode}; see evidence logs`);
