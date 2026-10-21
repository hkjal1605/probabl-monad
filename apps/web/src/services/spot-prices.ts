import { API_ORIGIN } from "@conditional-stocks/shared/endpoints";
import {
  expireSpotPrice,
  isEvmAddress,
  SPOT_BATCH_SIZE,
  type SpotPrice,
  type SpotPricesResponse,
} from "@conditional-stocks/shared/spot-prices";
import { getAddress } from "viem";
import type { MarketView } from "../types/api";

const STATUSES = ["available", "stale", "unavailable", "unmapped", "invalid"];
const KINDS = ["stock", "etf", "stablecoin", "crypto", null];

export function spotPricesUrl(tokens: string[], base = API_ORIGIN): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("Invalid spot API origin");
  }
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Spot API must be an HTTPS origin (HTTP allowed only for localhost)");
  if (
    !tokens.length ||
    tokens.length > SPOT_BATCH_SIZE ||
    tokens.some((token) => !isEvmAddress(token))
  )
    throw new Error("Invalid spot token request");
  const target = new URL("/v1/spot-prices", url);
  target.searchParams.set(
    "tokens",
    [...new Set(tokens.map((token) => getAddress(token)))].sort().join(","),
  );
  return target.toString();
}

export function parseSpotPricesResponse(
  input: unknown,
  chainId: number,
  tokens: string[],
  nowMs = Date.now(),
): SpotPricesResponse {
  const response = input as Partial<SpotPricesResponse> | null;
  const wanted = new Set(tokens.map((token) => getAddress(token)));
  if (
    !response ||
    response.source !== "robinhood" ||
    response.displayOnly !== true ||
    response.chainId !== chainId ||
    !Number.isSafeInteger(response.asOf) ||
    response.asOf! <= 0 ||
    response.asOf! > Math.floor(nowMs / 1000) + 5 ||
    !Array.isArray(response.prices) ||
    response.prices.length !== wanted.size
  )
    throw new Error("Invalid spot response identity");
  const seen = new Set<string>();
  for (const price of response.prices) {
    const token = price && isEvmAddress(price.token) ? getAddress(price.token) : null;
    if (
      !token ||
      !wanted.has(token) ||
      seen.has(token) ||
      !STATUSES.includes(price.status) ||
      !KINDS.includes(price.kind)
    )
      throw new Error("Invalid spot token mapping");
    seen.add(token);
    const hasPrice = price.priceUsd !== null;
    if (hasPrice !== (price.fetchedAt !== null) || (!hasPrice && price.priceTimestamp !== null))
      throw new Error("Incomplete spot price");
    if (hasPrice) {
      if (
        typeof price.priceUsd !== "number" ||
        !Number.isFinite(price.priceUsd) ||
        price.priceUsd <= 0 ||
        !Number.isSafeInteger(price.fetchedAt) ||
        price.fetchedAt! <= 0 ||
        price.fetchedAt! > response.asOf! + 5 ||
        !Number.isSafeInteger(price.priceTimestamp) ||
        price.priceTimestamp! <= 0 ||
        price.priceTimestamp! > response.asOf! + 5
      )
        throw new Error("Invalid spot price value");
    } else if (["available", "stale"].includes(price.status)) throw new Error("Missing spot price");
  }
  return {
    source: "robinhood",
    displayOnly: true,
    chainId,
    asOf: response.asOf!,
    prices: response.prices.map((price) =>
      expireSpotPrice({ ...price, token: getAddress(price.token) }, nowMs),
    ),
  };
}

/** Public, direct backend request: no Next route, provider key, wallet token or cookies. */
export async function fetchSpotPrices(
  chainId: number,
  tokens: string[],
  options: { base?: string; signal?: AbortSignal } = {},
): Promise<SpotPricesResponse> {
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(spotPricesUrl(tokens, options.base), {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Spot prices unavailable (${response.status})`);
  }
  return parseSpotPricesResponse(await response.json(), chainId, tokens);
}

/** Reference prices of each market. The base reference is converted to one whole token (the
 * unit the book prices): the per-share price times the issuer's live UI multiplier. A price
 * holds until it expires (`expireSpotPrice`), so a failed refresh does not blank it. */
export function withMarketSpotPrices(
  markets: MarketView[],
  response: SpotPricesResponse | undefined,
  nowMs = Date.now(),
): MarketView[] {
  const prices = response && new Map(response.prices.map((price) => [price.token, price]));
  const current = (price: SpotPrice | undefined) => price && expireSpotPrice(price, nowMs);
  return markets.map((market) => {
    const share = prices?.get(market.base.token);
    const multiplier = market.base.live.multiplierValue;
    const spotReference = current(
      prices
        ? share && share.priceUsd !== null && multiplier > 0
          ? { ...share, priceUsd: share.priceUsd * multiplier }
          : share
        : market.spotReference,
    );
    const quoteSpotReference = current(
      prices ? prices.get(market.quoteToken) : market.quoteSpotReference,
    );
    const { spotReference: _base, quoteSpotReference: _quote, ...rest } = market;
    return {
      ...rest,
      ...(spotReference ? { spotReference } : {}),
      ...(quoteSpotReference ? { quoteSpotReference } : {}),
      // Never carry an unverified old numeric reference through as a live price.
      ordinaryReference: spotReference?.status === "available" ? spotReference.priceUsd : null,
    };
  });
}
