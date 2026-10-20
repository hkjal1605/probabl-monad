import { afterEach, expect, test } from "bun:test";
import { fetchEventMetadata } from "../src/lib/admin-api";
import { parseKalshiTicker } from "../src/lib/kalshi-ticker";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Kalshi tickers are normalized to Kalshi's upper case and nothing else passes", () => {
  expect(parseKalshiTicker(" kxfeddecision-26dec-h25 ")).toBe("KXFEDDECISION-26DEC-H25");
  for (const value of ["", "https://kalshi.com/markets/kxfeddecision", "a b", "-LEADING", 42])
    expect(() => parseKalshiTicker(value)).toThrow("Kalshi market ticker");
});

test("both forms' shared client fetches a Kalshi market by ticker through the API proxy", async () => {
  const snapshot = { snapshotId: "k1", normalized: { source: "kalshi" } };
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    expect(String(url)).toBe("/api/gateway/admin/kalshi/metadata/fetch");
    expect(JSON.parse(String(init?.body))).toEqual({ ticker: "KXFEDDECISION-26DEC-H25" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-session");
    return Response.json(snapshot);
  }) as typeof fetch;
  const fetched = await fetchEventMetadata<typeof snapshot>(
    "test-session",
    "kalshi",
    "kxfeddecision-26dec-h25",
  );
  expect(fetched).toEqual(snapshot);
  expect(() => fetchEventMetadata("test-session", "kalshi", "not a ticker")).toThrow(
    "Kalshi market ticker",
  );
  expect(calls).toBe(1);
});
