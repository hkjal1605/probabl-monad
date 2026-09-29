import { parseMarketRef } from "@conditional-stocks/evm-client";

/** Canonical path of a market: its readable slug (ticker plus the chain-independent id). */
export const marketPath = (market: { id: string; slug?: string }) =>
  `/markets/${market.slug || market.id}`;

/** The public market id a URL segment names, or null for a numeric on-chain id (older links),
 * which the API resolves to its market. */
export function publicIdOf(segment: string): string | null {
  let value = segment;
  try {
    value = decodeURIComponent(segment);
  } catch {}
  const ref = parseMarketRef(value);
  return ref && "publicId" in ref ? ref.publicId : null;
}
