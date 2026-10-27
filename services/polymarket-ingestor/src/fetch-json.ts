import { MarketDataError } from "@conditional-stocks/market-data";

export const MAXIMUM_RESPONSE_BYTES = 5 * 1024 * 1024;

/** GETs a venue's JSON, bounded in time (10 s) and size (5 MiB). Every failure is a
 * `SOURCE_UNAVAILABLE` error naming the venue. */
export async function fetchJson(url: string, venue: string): Promise<unknown> {
  const unavailable = (message: string) =>
    new MarketDataError("SOURCE_UNAVAILABLE", `${venue} ${message}`, 503);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw unavailable(`source returned ${response.status}`);
    if (Number(response.headers.get("content-length") ?? "0") > MAXIMUM_RESPONSE_BYTES)
      throw unavailable("response is too large");
    if (!response.body) throw unavailable("response has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        throw unavailable("response is too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    throw unavailable(error instanceof Error ? error.message : String(error));
  }
}
