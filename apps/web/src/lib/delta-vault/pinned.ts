/** Only vaults pinned in this build's configuration are shown or transacted with. */
export const pinnedVaults = <T extends { address: string }>(
  vaults: readonly T[],
  pinned: readonly string[],
) => {
  const allowed = new Set(pinned.map((address) => address.toLowerCase()));
  return vaults.filter((vault) => allowed.has(vault.address.toLowerCase()));
};
