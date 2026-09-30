import { U96_MAX } from "@conditional-stocks/evm-client";

export const BPS = 10_000n;
export const PROB = 1_000_000n;
/** Anvil, Robinhood Chain testnet and Base Sepolia. */
export const TESTNETS: readonly number[] = [31337, 46630, 84532];
export const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));
export const max = (...values: bigint[]) => values.reduce((a, b) => (a > b ? a : b));
export const abs = (value: bigint) => (value < 0n ? -value : value);
export const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;

/** Exact decimal conversion, including scientific notation returned by JSON price feeds. */
export function decimal(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || value.length > 80)
    throw new Error("Invalid decimal precision");
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:e([+-]?[0-9]{1,3}))?$/i.exec(value);
  if (!match) throw new Error("Invalid positive decimal");
  const fraction = match[2] ?? "",
    shift = decimals + Number(match[3] ?? 0) - fraction.length;
  if (Math.abs(shift) > 100) throw new Error("Decimal out of range");
  const digits = BigInt(match[1]! + fraction);
  return shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
}
/** Exact raw token units of a whole-token amount; "0" is allowed (e.g. a quote-only maker). */
export function units(value: string, decimals: number) {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) || (value.split(".")[1]?.length ?? 0) > decimals)
    throw new Error("Token allocation must use exact token decimals");
  const amount = decimal(value, decimals);
  if (amount > U96_MAX) throw new Error("Token allocation exceeds uint96");
  return amount;
}
