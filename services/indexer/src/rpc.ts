/** JSON-RPC helpers of the chain follower. */
import { type Address, type Hex, hexToBigInt, hexToBytes, keccak256 } from "viem";

const number = (value: string) => BigInt(value.replace(/[,.]/g, ""));

/** Blocks per eth_getLogs request that a provider's error allows, or undefined when the error is
 * not about the range. `stated` limits come from the provider's message; generic "too large"
 * errors (often about result size) halve the span. Patterns from Ponder's getLogsRetryHelper. */
export function logRangeLimit(
  error: unknown,
  span: bigint,
): { blocks: bigint; stated: boolean } | undefined {
  let text = error instanceof Error ? error.message : String(error);
  try {
    text += JSON.stringify(error, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {}
  const suggested =
    /this block range should work: \[0x([0-9a-f]+),\s*0x([0-9a-f]+)\]/i.exec(text) ?? // Alchemy
    /Try with this block range \[0x([0-9a-f]+),\s*0x([0-9a-f]+)\]/i.exec(text); // Infura
  if (suggested)
    return {
      blocks: hexToBigInt(`0x${suggested[2]}`) - hexToBigInt(`0x${suggested[1]}`) + 1n,
      stated: true,
    };
  for (const pattern of [
    /requested too many blocks from \d+ to \d+, maximum is set to (\d+)/, // Avalanche
    /Max range: (\d+)/, // Cloudflare
    /Maximum allowed number of requested blocks is (\d+)/, // thirdweb
    /limited to an? ([\d,.]+)/, // QuickNode, 1RPC, Blast
    /limited to ([\d,.]+) block/, // BlockPI
    /exceeds the range allowed for your plan \(\d+ > (\d+)\)/, // Blast
    /please limit the query to at most ([\d,.]+) blocks/, // Coinbase
    /maximum block range: ([\d,.]+)/, // PublicNode
    /query exceeds max block range ([\d,.]+)/,
    /block range greater than ([\d,.]+) max/,
    /block range exceeds ([\d,.]+)/,
    /query must be smaller than size ([\d,.]+)/,
    /block range is too wide \(maximum (\d+)\)/,
    /up to a ([\d,.]+) block range/,
    /maximum \[from, to\] blocks distance: (\d+)/,
    /exceed max block range: (\d+)/,
  ]) {
    const match = pattern.exec(text);
    if (match && number(match[1]!) > 0n) return { blocks: number(match[1]!), stated: true };
  }
  const thousands = /max is (\d+)k blocks/.exec(text); // Merkle
  if (thousands) return { blocks: BigInt(thousands[1]!) * 1_000n, stated: true };
  if (/block range is too wide/.test(text)) return { blocks: 3_000n, stated: true }; // Ankr
  if (/Block range limit exceeded/.test(text))
    return { blocks: span <= 10_000n ? 100n : 10_000n, stated: false }; // Chainstack
  if (
    /allowed block range threshold exceeded|exceeded max allowed|range threshold exceeded|block range too large|Block range is too large|backend response too large|query exceeds max results|logs matched by query exceeds limit|query returned more than \d+ results|response size should not greater than|ranges over \d+ blocks are not supported|no backend is currently healthy/.test(
      text,
    )
  )
    return span > 1n ? { blocks: span / 2n, stated: false } : undefined;
  return undefined;
}

/** Whether a block's logsBloom may contain logs of `address` (false means it certainly does not).
 * A zero bloom is not trusted. */
export function mayContain(bloom: Hex | null | undefined, address: Address): boolean {
  if (!bloom || /^0x0*$/.test(bloom)) return true;
  const bits = hexToBytes(bloom);
  if (bits.length !== 256) return true;
  const hash = hexToBytes(keccak256(address));
  for (let i = 0; i < 6; i += 2) {
    const bit = ((hash[i]! << 8) | hash[i + 1]!) & 2047;
    if ((bits[255 - (bit >> 3)]! & (1 << (bit & 7))) === 0) return false;
  }
  return true;
}

/** Maps with at most `limit` promises in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
