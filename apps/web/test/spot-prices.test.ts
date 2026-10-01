import { describe, expect, test } from "bun:test";
import {
  expireSpotPrice,
  type SpotPrice,
  type SpotPricesResponse,
} from "@conditional-stocks/shared/spot-prices";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatSpotUsd, SpotReference } from "../src/components/market/SpotReference";
import { assetsForMarkets } from "../src/hooks/useWalletAssets";
import { previewOrder } from "../src/lib/trading/order";
import {
  fetchSpotPrices,
  parseSpotPricesResponse,
  spotPricesUrl,
  withMarketSpotPrices,
} from "../src/services/spot-prices";
import { fixtureMarkets, FIXTURE_TOKENS as T } from "./fixtures/protocol";

const NOW = Date.now(),
  at = Math.floor(NOW / 1000),
  CHAIN = 31337;
const price = (token: string = T.base, changes: Partial<SpotPrice> = {}): SpotPrice => ({
  token,
  symbol: token === T.base ? "NVDA" : "USDC",
  source: token === T.base ? "Equity.US.NVDA/USD" : "Crypto.USDC/USD",
  kind: token === T.base ? "stock" : "stablecoin",
  valuationCompatible: token !== T.base,
  status: "available",
  priceUsd: 123.45,
  priceTimestamp: at - 5,
  fetchedAt: at,
  ...changes,
});
const response = (prices = [price()]): SpotPricesResponse => ({
  source: "robinhood",
  displayOnly: true,
  chainId: CHAIN,
  asOf: at,
  prices,
});

describe("display price validation", () => {
  test("strictly matches source, network and the exact requested tokens", () => {
    expect(parseSpotPricesResponse(response(), CHAIN, [T.base], NOW)).toEqual(response());
    const invalid: unknown[] = [
      null,
      {},
      [],
      { ...response(), source: "other" },
      { ...response(), chainId: 1 },
      { ...response(), displayOnly: false },
      { ...response(), asOf: at + 30 },
      response([]),
      response([price(), price()]),
      response([price(T.quote)]),
      response([price(T.base, { kind: "bond" as never })]),
    ];
    for (const value of invalid)
      expect(() => parseSpotPricesResponse(value, CHAIN, [T.base], NOW)).toThrow();
  });
  test("rejects malformed numeric values and incomplete timestamps", () => {
    for (const patch of [
      { priceUsd: 0 },
      { priceUsd: Infinity },
      { priceUsd: NaN },
      { priceUsd: -1 },
      { priceUsd: "123" },
      { fetchedAt: at + 6 },
      { fetchedAt: null },
      { priceTimestamp: null },
      { priceTimestamp: at + 6 },
      { priceTimestamp: -1 },
      { status: "bogus" },
    ])
      expect(() =>
        parseSpotPricesResponse(
          response([{ ...price(), ...patch } as SpotPrice]),
          CHAIN,
          [T.base],
          NOW,
        ),
      ).toThrow();
  });
  test("unmapped tokens and missing prices are explicit, never a fake $1", () => {
    const p = price(T.quote, {
      status: "unmapped",
      source: null,
      kind: null,
      priceUsd: null,
      fetchedAt: null,
      priceTimestamp: null,
    });
    expect(parseSpotPricesResponse(response([p]), CHAIN, [T.quote], NOW).prices[0]).toEqual(p);
  });
  test("stock references stay valid through a session break; crypto references expire in minutes", () => {
    expect(expireSpotPrice(price(), NOW).status).toBe("available");
    expect(expireSpotPrice(price(T.base, { priceTimestamp: at - 3_600 }), NOW).status).toBe(
      "available",
    );
    expect(expireSpotPrice(price(T.quote, { priceTimestamp: at - 121 }), NOW).status).toBe("stale");
    expect(expireSpotPrice(price(), NOW + 61_000).status).toBe("stale");
    expect(expireSpotPrice(price(), NOW - 10_000).status).toBe("stale");
  });
  test("transport is direct, credential-free and abortable; errors don't expose upstream text", async () => {
    const original = globalThis.fetch;
    const seen: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), ...(init ? { init } : {}) });
      return Response.json(response());
    }) as typeof fetch;
    try {
      await fetchSpotPrices(CHAIN, [T.base], { base: "https://api.example" });
      expect(seen[0]!.url).toStartWith("https://api.example/v1/spot-prices?tokens=");
      expect(seen[0]!.init?.credentials).toBe("omit");
      expect(seen[0]!.init?.redirect).toBe("error");
      expect(seen[0]!.init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(seen[0]!.init?.headers).has("authorization")).toBe(false);
      globalThis.fetch = (async () =>
        new Response("secret upstream message", { status: 401 })) as unknown as typeof fetch;
      await expect(fetchSpotPrices(CHAIN, [T.base])).rejects.toThrow(
        "Spot prices unavailable (401)",
      );
    } finally {
      globalThis.fetch = original;
    }
  });
  test("URLs permit HTTPS/loopback only and reject credentials, path injection and invalid tokens", () => {
    for (const base of [
      "https://user:secret@api.example",
      "http://api.example",
      "https://api.example/path",
      "https://api.example/?key=secret",
      "https://api.example/#hash",
      "bad",
    ])
      expect(() => spotPricesUrl([T.base], base)).toThrow();
    for (const tokens of [[], ["NVDA"], Array(51).fill(T.base)])
      expect(() => spotPricesUrl(tokens)).toThrow();
    expect(spotPricesUrl([T.base], "http://127.0.0.1:3000")).toStartWith(
      "http://127.0.0.1:3000/v1/spot-prices",
    );
    expect(new URL(spotPricesUrl([T.base, T.base.toLowerCase()])).searchParams.get("tokens")).toBe(
      T.base,
    );
  });
});

describe("UI and trading separation", () => {
  const market = fixtureMarkets[0]!;
  test("refresh modifies only display fields; books, precision and order arithmetic are unchanged", () => {
    const before = previewOrder("1", "123.45", market);
    const [updated] = withMarketSpotPrices(
      [market],
      response([price(), price(T.quote, { priceUsd: 0.998 })]),
      NOW,
    );
    expect(updated!.ordinaryReference).toBe(123.45);
    expect(updated!.quoteSpotReference!.priceUsd).toBe(0.998);
    // One whole token is `multiplier` shares: the book prices tokens.
    const split = {
      ...market,
      base: { ...market.base, live: { ...market.base.live, multiplierValue: 5 } },
    };
    expect(
      withMarketSpotPrices([split], response([price(), price(T.quote)]), NOW)[0]!.ordinaryReference,
    ).toBe(123.45 * 5);
    expect(updated!.yes).toBe(market.yes);
    expect(updated!.no).toBe(market.no);
    expect(previewOrder("1", "123.45", updated!)).toEqual(before);
    const [down] = withMarketSpotPrices([updated!], undefined, NOW, true);
    expect(down!.ordinaryReference).toBeNull();
    expect(down!.spotReference!.status).toBe("unavailable");
    expect(previewOrder("1", "123.45", down!)).toEqual(before);
    expect(withMarketSpotPrices([market], undefined, NOW)[0]!.ordinaryReference).toBeNull();
  });
  test("portfolio estimates use the actual quote price and the live per-token stock price", () => {
    const [updated] = withMarketSpotPrices(
      [market],
      response([price(), price(T.quote, { priceUsd: 0.998 })]),
      NOW,
    );
    const assets = assetsForMarkets([updated!]);
    expect(assets.map((a) => a.token)).toEqual([T.quote, T.base]);
    expect(assets.find((a) => a.token === T.quote)!.reference).toBe(0.998);
    expect(assets.find((a) => a.token === T.base)!.reference).toBe(123.45);
    const [stale] = withMarketSpotPrices([updated!], undefined, NOW + 121_000);
    expect(assetsForMarkets([stale!]).every((a) => a.reference === null)).toBe(true);
  });
  test("UI stays minimal and unbranded while warning about stale or unknown prices", () => {
    const render = (p?: SpotPrice) =>
      renderToStaticMarkup(createElement(SpotReference, { price: p }));
    const live = render(price());
    expect(live).not.toMatch(/pyth|robinhood/i);
    expect(live).toContain("Spot reference · USD");
    expect(render(price(T.base, { status: "stale" }))).toContain("last known");
    expect(render()).toContain("Price unavailable");
    expect(formatSpotUsd(1.23e-12)).not.toBe("$0.00");
  });
});
