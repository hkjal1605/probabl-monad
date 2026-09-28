/** Prepare the backend environment file locally; never copy wallet keys to a backend. */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const root = resolve(import.meta.dir, "../..");
const target = resolve(root, ".data/deploy/env");
const remoteRoot = "/home/ubuntu/probabl";
const source = parseEnv(readFileSync(resolve(root, ".env"), "utf8"));
const allowed = new Set(Object.keys(parseEnv(readFileSync(resolve(root, ".env.example"), "utf8"))));
// Wallet keys (trading delegate, faucet) are set directly on the backend host.
const common: Record<string, string> = {};
for (const [name, value] of Object.entries(source))
  if (value !== undefined && allowed.has(name) && !name.includes("PRIVATE_KEY"))
    common[name] = value;
let database: URL;
try {
  database = new URL(source.DATABASE_URL ?? "");
} catch {
  throw new Error("Invalid DATABASE_URL; its value was not logged");
}
if (
  database.hostname !== "probabl.cluster-c3uuueq6kfve.ap-northeast-1.rds.amazonaws.com" ||
  !database.password ||
  database.hash
)
  throw new Error("Unexpected deployment database target or missing password");
database.searchParams.set("sslmode", "verify-full");
database.searchParams.set("sslrootcert", `${remoteRoot}/global-bundle.pem`);
common.DATABASE_URL = database.toString();
common.API_HOST = "127.0.0.1";
common.POLYMARKET_HOST = "127.0.0.1";

const content = Object.entries(common)
  .map(([key, value]) => {
    if (/[\r\n$]/.test(value)) throw new Error(`Encode special characters before staging ${key}`);
    return `${key}=${JSON.stringify(value)}`;
  })
  .join("\n");
mkdirSync(target, { recursive: true, mode: 0o700 });
chmodSync(target, 0o700);
// "wx" refuses to overwrite a staged file; secret values never reach arguments or output.
writeFileSync(resolve(target, ".env"), `${content}\n`, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ staged: [".env"], walletKeysIncluded: false, fileMode: "0600" }));
