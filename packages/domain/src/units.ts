export const PRICE_FORMAT = "raw-unit-ratio-x18" as const;
export const MAX_TOKEN_DECIMALS = 36;
export const MAX_ORDER_UINT128 = (1n << 128n) - 1n;

/** Protocol v2 market metadata, still accepted by the display helpers. */
const PROTOCOL_VERSION = 2;
export interface MarketUnits {
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
  protocolVersion: number;
  priceFormat: typeof PRICE_FORMAT;
}

/** Protocol v4 (the EVM ledger exchange): quantities are raw base-token units, so the quantity
 * ("share") decimals are the base token's own; prices are raw quote per raw base unit x 1e18. */
export const SHARE_PROTOCOL_VERSION = 4;
export const SHARE_PRICE_FORMAT = PRICE_FORMAT;
export interface ShareUnits {
  shareDecimals: number;
  quoteTokenDecimals: number;
  protocolVersion: number;
  priceFormat: typeof PRICE_FORMAT;
}
export type AnyMarketUnits = MarketUnits | ShareUnits;

export function tokenDecimals(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_TOKEN_DECIMALS
  ) {
    throw new RangeError("Token decimals must be a verified integer between 0 and 36");
  }
  return value;
}

/** Reject legacy or missing metadata; never infer USDG's precision from a symbol. */
export function assertMarketUnits(value: unknown): asserts value is MarketUnits {
  if (!value || typeof value !== "object") throw new TypeError("Market units are required");
  const units = value as MarketUnits;
  if (units.protocolVersion !== PROTOCOL_VERSION || units.priceFormat !== PRICE_FORMAT) {
    throw new RangeError("Unsupported market price semantics; v2 raw-unit ratio required");
  }
  tokenDecimals(units.baseTokenDecimals);
  tokenDecimals(units.quoteTokenDecimals);
}

/** Reject anything but v4 raw-unit semantics with verified decimals. */
export function assertShareUnits(value: unknown): asserts value is ShareUnits {
  if (!value || typeof value !== "object") throw new TypeError("Market units are required");
  const units = value as ShareUnits;
  if (units.protocolVersion !== SHARE_PROTOCOL_VERSION || units.priceFormat !== PRICE_FORMAT)
    throw new RangeError("Unsupported market price semantics; v4 raw-unit ratio required");
  tokenDecimals(units.shareDecimals);
  tokenDecimals(units.quoteTokenDecimals);
}

/** Decimals of the quantity unit. */
export function quantityDecimals(units: AnyMarketUnits): number {
  if ("shareDecimals" in units) {
    assertShareUnits(units);
    return units.shareDecimals;
  }
  assertMarketUnits(units);
  return units.baseTokenDecimals;
}

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

/** Exact unsigned decimal input, with no floating-point conversion or rounding. */
function parseScaled(value: string, exponent: number): bigint {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
  ) {
    throw new RangeError("Expected an unsigned plain decimal string");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const digits = BigInt(whole + fraction);
  const shift = exponent - fraction.length;
  if (shift >= 0) return digits * pow10(shift);
  const divisor = pow10(-shift);
  if (digits % divisor !== 0n)
    throw new RangeError("Value is not exactly representable in raw units");
  return digits / divisor;
}

function formatScaled(value: bigint, exponent: number): string {
  if (typeof value !== "bigint" || value < 0n)
    throw new RangeError("Raw value must be non-negative");
  if (exponent <= 0) return (value * pow10(-exponent)).toString();
  const digits = value.toString().padStart(exponent + 1, "0");
  const fraction = digits.slice(-exponent).replace(/0+$/, "");
  return digits.slice(0, -exponent) + (fraction ? `.${fraction}` : "");
}

export const parseTokenAmount = (value: string, decimals: number): bigint =>
  parseScaled(value, tokenDecimals(decimals));

export const formatTokenAmount = (value: bigint, decimals: number): string =>
  formatScaled(value, tokenDecimals(decimals));

/** Human quantity -> raw quantity units. */
export const parseShareAmount = (value: string, units: AnyMarketUnits): bigint =>
  parseScaled(value, quantityDecimals(units));

/** Raw quantity units -> exact human quantity. */
export const formatShareAmount = (value: bigint, units: AnyMarketUnits): string =>
  formatScaled(value, quantityDecimals(units));

/** Decimal exponent of a price: 18 + quote decimals - quantity decimals. */
export const priceExponent = (units: AnyMarketUnits): number =>
  18 + units.quoteTokenDecimals - quantityDecimals(units);

/** human quote/base -> signed raw quote/raw base * 1e18. Reject dust and uint128 overflow. */
export function parsePriceRawX18(value: string, units: AnyMarketUnits): bigint {
  const raw = parseScaled(value, priceExponent(units));
  if (raw <= 0n || raw > MAX_ORDER_UINT128)
    throw new RangeError("Price is outside uint128 positive range");
  return raw;
}

export const formatPriceRawX18 = (value: bigint, units: AnyMarketUnits): string =>
  formatScaled(value, priceExponent(units));
