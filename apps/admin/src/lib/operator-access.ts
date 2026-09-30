import { readRoles } from "./chain";

export function operatorRole(account: string | null, operators: readonly string[] | null) {
  // A missing/failed/in-flight lookup is not an authorization decision.
  if (!account || operators === null) return "unverified" as const;
  return operators.includes(account) ? ("operator" as const) : ("blocked" as const);
}

/** Every governance role holder, read from the exchange on the configured chain, plus the
 * Δ-vault operators `vaults` reads. Public settings never grant access; the contracts enforce
 * each role on every transaction. */
export async function loadOperators(
  read: typeof readRoles = readRoles,
  vaults: () => Promise<readonly string[]> = async () => [],
) {
  const [roles, vaultOperators] = await Promise.all([read(), vaults()]);
  return [roles.admin, roles.marketAdmin, roles.resolutionAdmin, roles.guardian, ...vaultOperators];
}
