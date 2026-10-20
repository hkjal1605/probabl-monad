const SCALE = 10n ** 18n;
/** A decimal price string in 1e-18 units, or null when it is not one. */
export const scaled = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9]{1,12}(\.[0-9]{1,18})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
};
/** The exact midpoint of two scaled prices, as the shortest decimal number. */
export const midpoint = (bid: bigint, ask: bigint) => {
  const mid = (bid + ask) / 2n;
  return Number(`${mid / SCALE}.${(mid % SCALE).toString().padStart(18, "0")}`);
};
