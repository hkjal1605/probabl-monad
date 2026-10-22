import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCloudflareEnvironment } from "../scripts/cloudflare-preflight";
import {
  filesWithSecrets,
  isSecretValue,
  sanitizedEnvironmentModule,
  secretValues,
} from "../scripts/cloudflare-sanitize";

const valid = {
  NEXT_PUBLIC_APP_URL: "https://probabl-ui.account.workers.dev",
  NEXT_PUBLIC_API_URL: "https://api.probabl.trade",
  NEXT_PUBLIC_RPC_URL: "https://sepolia.base.org",
  NEXT_PUBLIC_CHAIN_ID: "84532",
  NEXT_PUBLIC_CHAIN_NAME: "Base Sepolia",
  NEXT_PUBLIC_EXCHANGE_ADDRESS: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
};
describe("Workers deployment guard", () => {
  test("default deployment skips env checks; strict deployment remains opt-in", async () => {
    const app = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      scripts: Record<string, string>;
    };
    const root = (await Bun.file(new URL("../../../package.json", import.meta.url)).json()) as {
      scripts: Record<string, string>;
    };
    expect(root.scripts["deploy:ui:cloudflare"]).toBe(
      "bun --filter @conditional-stocks/web deploy:cloudflare",
    );
    expect(app.scripts["deploy:cloudflare"]).toBe(
      "bun run build:cloudflare && opennextjs-cloudflare deploy",
    );
    expect(app.scripts["build:cloudflare"]).toContain("&& bun scripts/cloudflare-sanitize.ts");
    expect(root.scripts["deploy:ui:cloudflare:strict"]).toBe(
      "bun --filter @conditional-stocks/web deploy:cloudflare:strict",
    );
    expect(app.scripts["deploy:cloudflare:strict"]).toBe(
      "bun run check:cloudflare && bun run deploy:cloudflare",
    );
  });
  test("accepts complete public settings; runtime credentials are not build requirements", () => {
    expect(validateCloudflareEnvironment(valid)).toEqual([]);
    expect(validateCloudflareEnvironment({})).toHaveLength(Object.keys(valid).length);
  });
  test("rejects every missing required setting", () => {
    for (const key of Object.keys(valid))
      expect(validateCloudflareEnvironment({ ...valid, [key]: "" }).length).toBeGreaterThan(0);
  });
  test("rejects local/placeholder URLs and invalid deployment settings", () => {
    for (const [key, value] of [
      ["NEXT_PUBLIC_APP_URL", "https://localhost"],
      ["NEXT_PUBLIC_APP_URL", "https://127.0.0.1"],
      ["NEXT_PUBLIC_APP_URL", "https://192.168.1.1"],
      ["NEXT_PUBLIC_APP_URL", "https://app.example.com"],
      ["NEXT_PUBLIC_APP_URL", "https://app.probabl.com/path"],
      ["NEXT_PUBLIC_APP_URL", "https://user:secret@app.probabl.com"],
      ["NEXT_PUBLIC_API_URL", "http://api.probabl.trade"],
      ["NEXT_PUBLIC_API_URL", "https://api.probabl.trade/path"],
      ["NEXT_PUBLIC_RPC_URL", "http://sepolia.base.org"],
      ["NEXT_PUBLIC_CHAIN_ID", "31337"],
      ["NEXT_PUBLIC_CHAIN_ID", "1"],
      ["NEXT_PUBLIC_EXCHANGE_ADDRESS", "not-an-address"],
      ["NEXT_PUBLIC_EXCHANGE_ADDRESS", "0x0000000000000000000000000000000000000000"],
      ["NEXT_PUBLIC_EXCHANGE_ADDRESS", "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0"],
      ["NEXT_PUBLIC_LOG_LEVEL", "trace"],
    ]) {
      expect(
        validateCloudflareEnvironment({ ...valid, [key as string]: value }).length,
      ).toBeGreaterThan(0);
    }
  });
  test("keys, tokens, private keys and credentialed or keyed URLs are secret; public settings not", () => {
    for (const value of [
      "sk-or-v1-0123456789abcdef0123456789abcdef",
      "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",
      "postgres://app:hunter2@localhost:5432/probabl",
      "https://robinhood-testnet.g.alchemy.com/v2/AbCdEfGhIjKlMnOpQrStUvWx",
      "wss://stream.example.com/socket?apiKey=AbCdEfGhIjKlMnOpQrStUvWx",
    ])
      expect(isSecretValue(value)).toBe(true);
    for (const value of [
      "api.probabl.trade",
      "https://api.probabl.trade",
      "https://rpc.testnet.chain.robinhood.com",
      "https://api.robinhood.com/rhj/assets",
      "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      "4000",
      "true",
    ])
      expect(isSecretValue(value)).toBe(false);
  });
  test("secret values come from every .env file, public settings aside", () => {
    const env = [
      'CLOUDFLARE_API_TOKEN="cf-0123456789abcdef0123456789"\nNEXT_PUBLIC_RPC_URL=https://rpc.example.com/v2/AbCdEfGhIjKlMnOpQrStUvWx',
      "export DATABASE_URL=postgres://app:hunter2@db:5432/probabl\nRPC_URL=https://rpc.example.com/v2/AbCdEfGhIjKlMnOpQrStUvWx",
    ];
    // RPC_URL holds what NEXT_PUBLIC_RPC_URL already publishes.
    expect(secretValues(env).sort()).toEqual([
      "cf-0123456789abcdef0123456789",
      "postgres://app:hunter2@db:5432/probabl",
    ]);
  });
  test("the build check finds a secret in any file of the build, browser assets included", async () => {
    const build = await mkdtemp(join(tmpdir(), "probabl-build-"));
    try {
      await mkdir(join(build, "assets/_next"), { recursive: true });
      await writeFile(join(build, "worker.js"), "export default {}");
      await writeFile(
        join(build, "assets/_next/chunk.js"),
        'const k="cf-0123456789abcdef0123456789"',
      );
      expect(await filesWithSecrets(build, ["cf-0123456789abcdef0123456789"])).toEqual([
        join("assets", "_next", "chunk.js"),
      ]);
      expect(await filesWithSecrets(build, ["sk-not-in-this-build-0123456789"])).toEqual([]);
    } finally {
      await rm(build, { recursive: true, force: true });
    }
  });
  test("sanitized environment cannot provide local or backend-secret fallbacks", () => {
    expect(sanitizedEnvironmentModule).toBe(
      "export const production = {};\nexport const development = {};\nexport const test = {};\n",
    );
  });
});
