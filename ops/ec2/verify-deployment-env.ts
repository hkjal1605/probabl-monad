/** Compare shared configuration without exporting database credentials or individual secret values. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const sharedDeploymentKeys = [
  "CHAIN_ID",
  "RPC_URL",
  "EXCHANGE_ADDRESS",
  "DEPLOYMENT_BLOCK",
  "FINALITY_DEPTH",
  "API_AUTH_ORIGINS",
  "TRADING_DELEGATE_ADDRESS",
  "POLYMARKET_INGESTOR_URL",
  "POLYMARKET_INTERNAL_TOKEN",
  "EVIDENCE_PUBLIC_BASE_URL",
  "ROBINHOOD_PRICES_URL",
].sort();
export function deploymentFingerprint(environment: Record<string, string>, challenge: string) {
  return createHash("sha256")
    .update(challenge)
    .update(JSON.stringify(sharedDeploymentKeys.map((key) => [key, environment[key] ?? ""])))
    .digest("hex");
}
if (import.meta.main) {
  const challenge = process.argv[2];
  if (!challenge || !/^[a-f0-9]{64}$/.test(challenge))
    throw new Error("A fresh comparison challenge is required");
  const environment = parseEnv(readFileSync(resolve(import.meta.dir, "../../.env"), "utf8"));
  console.info(
    JSON.stringify({
      fingerprint: deploymentFingerprint(environment, challenge),
      sharedKeys: sharedDeploymentKeys.length,
      walletKeyPresent: Object.keys(environment).some((key) => key.includes("PRIVATE_KEY")),
      databaseLogin: new URL(environment.DATABASE_URL ?? "").username,
    }),
  );
}
