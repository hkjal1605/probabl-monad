/** Chain-independent market identity.
 *
 * A market is one event (a Polymarket condition and the outcome that counts as YES) on one
 * underlying asset. Each on-chain market is a venue of it; venues on other deployments or other
 * issuers' tokens of the same asset share its key. These match `ConditionalStocksAdmin`'s
 * `eventKey`, `underlying` and `marketKey`. */
import { encodeAbiParameters, type Hex, hexToString, keccak256, stringToHex, zeroHash } from "viem";

/** `REGION:TICKER`, e.g. "US:NVDA": fits the contract's bytes32 underlying. */
const UNDERLYING = /^[A-Z]{2,8}:[A-Z0-9][A-Z0-9.-]{0,22}$/;
/** Public ids are the first 8 bytes of the market key. */
const PUBLIC_ID = /^[0-9a-f]{16}$/;

export function underlyingId(symbol: string): Hex {
  if (!UNDERLYING.test(symbol)) throw new Error(`Invalid underlying "${symbol}"`);
  return stringToHex(symbol, { size: 32 });
}

/** The readable underlying of a bytes32 id, or null for none (the quote token). */
export function underlyingSymbol(id: Hex): string | null {
  if (id === zeroHash) return null;
  const symbol = hexToString(id, { size: 32 }).replace(/\0+$/, "");
  return UNDERLYING.test(symbol) ? symbol : null;
}

export const eventKey = (condition: Hex, yesIndex: number, noIndex: number): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint8" }, { type: "uint8" }],
      [condition, yesIndex, noIndex],
    ),
  );

export const marketKey = (event: Hex, underlying: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [event, underlying]));

/** The public market id: 16 lowercase hex digits. */
export const publicMarketId = (key: Hex) => key.slice(2, 18).toLowerCase();

/** URL segment of a market: a readable ticker prefix (decorative) and the public id. */
export function marketSlug(publicId: string, underlying: string | null) {
  const ticker = underlying
    ?.split(":")[1]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return ticker ? `${ticker}-${publicId}` : publicId;
}

export type MarketRef = { publicId: string } | { venueId: number };

/** Parses a market reference: a public id (optionally slug-prefixed), a full market key, or a
 * numeric on-chain market id of the serving deployment (legacy links and venue-level tools). */
export function parseMarketRef(ref: string): MarketRef | null {
  const value = ref.trim().toLowerCase();
  if (/^[1-9][0-9]{0,9}$/.test(value)) {
    const venueId = Number(value);
    return venueId <= 4_294_967_295 ? { venueId } : null;
  }
  if (/^0x[0-9a-f]{64}$/.test(value)) return { publicId: publicMarketId(value as Hex) };
  const last = value.slice(value.lastIndexOf("-") + 1);
  return PUBLIC_ID.test(last) ? { publicId: last } : null;
}
