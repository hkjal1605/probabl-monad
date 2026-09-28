import { readRoles } from "./chain";

export function operatorRole(account: string | null, operators: readonly string[] | null) {
  // A missing/failed/in-flight lookup is not an authorization decision.
  if (!account || operators === null) return "unverified" as const;
  return operators.includes(account) ? ("operator" as const) : ("blocked" as const);
}

/** Every governance role holder, read from the exchange on the configured chain. Public
 * settings never grant access; the contract enforces each role on every transaction. */
export async function loadOperators(read: typeof readRoles = readRoles) {
  const roles = await read();
  return [roles.admin, roles.marketAdmin, roles.resolutionAdmin, roles.guardian];
}
