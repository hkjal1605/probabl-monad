/** Reference prices from the Pyth Hermes price service (display only).
 *
 * A token maps to a feed through its on-chain symbol and the asset catalog (stocks price per
 * economic share). Feed ids are resolved once per symbol; concurrent callers share one
 * bounded Hermes request per batch and a short cache. */
import { ReadCache } from "@conditional-stocks/shared/read-cache";
import {
  expireSpotPrice,
  SPOT_BATCH_SIZE,
  type SpotPrice,
  type SpotPricesResponse,
} from "@conditional-stocks/shared/spot-prices";
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface TokenIdentity {
  token: string;
  symbol: string | null;
}

async function json(fetcher: Fetch, url: string, apiKey?: string): Promise<unknown> {
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Hermes returned ${response.status}`);
  }
  const text = await response.text();
  if (text.length > 512 * 1024) throw new Error("Oversized Hermes response");
  return JSON.parse(text);
}

export class PythSpotPrices {
  private feeds = new Map<string, Promise<string | null>>();
  private reads = new ReadCache(10_000, 64);

  constructor(
    private readonly chainId: number,
    private readonly hermes = "https://hermes.pyth.network",
    private readonly fetcher: Fetch = fetch,
    /** Hermes access token; price updates require an entitled key. */
    private readonly apiKey?: string,
  ) {}

  /** Feed id of a Pyth symbol (e.g. "Equity.US.NVDA/USD"), resolved once. */
  private feed(symbol: string) {
    let pending = this.feeds.get(symbol);
    if (!pending) {
      const [assetClass, rest = ""] = symbol.split(".", 2);
      const query = rest.replace(/^US\./, "").split("/")[0] ?? "";
      pending = json(
        this.fetcher,
        `${this.hermes}/v2/price_feeds?query=${encodeURIComponent(query)}&asset_type=${assetClass!.toLowerCase()}`,
        this.apiKey,
      ).then((body) => {
        const match = (Array.isArray(body) ? body : []).find(
          (feed) => (feed as { attributes?: { symbol?: string } }).attributes?.symbol === symbol,
        ) as { id?: string } | undefined;
        return match?.id && /^[0-9a-f]{64}$/.test(match.id) ? match.id : null;
      });
      pending.catch(() => this.feeds.delete(symbol));
      this.feeds.set(symbol, pending);
    }
    return pending;
  }

  async getPrices(tokens: TokenIdentity[]): Promise<SpotPricesResponse> {
    if (!tokens.length || tokens.length > SPOT_BATCH_SIZE)
      throw new Error("Invalid spot price batch");
    const now = Date.now();
    const assets = tokens.map((t) => ({ ...t, asset: catalogAsset(t.symbol) }));
    const ids = await Promise.all(
      assets.map((a) => (a.asset ? this.feed(a.asset.pyth).catch(() => null) : null)),
    );
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))].sort();
    const latest = wanted.length
      ? await this.reads
          .get(wanted.join(","), () =>
            json(
              this.fetcher,
              `${this.hermes}/v2/updates/price/latest?parsed=true&${wanted.map((id) => `ids[]=${id}`).join("&")}`,
              this.apiKey,
            ),
          )
          .catch(() => null)
      : null;
    const parsed = new Map<string, { price: number; publishTime: number }>();
    for (const item of ((latest as { parsed?: unknown[] } | null)?.parsed ?? []) as {
      id?: string;
      price?: { price?: string; expo?: number; publish_time?: number };
    }[]) {
      const p = item.price;
      if (!item.id || !p || typeof p.price !== "string" || typeof p.expo !== "number") continue;
      const value = Number(p.price) * 10 ** p.expo;
      if (Number.isFinite(value) && value > 0 && Number.isSafeInteger(p.publish_time))
        parsed.set(item.id, { price: value, publishTime: p.publish_time! });
    }
    const fetchedAt = Math.floor(now / 1000);
    const prices = assets.map((a, i): SpotPrice => {
      const observation = ids[i] ? parsed.get(ids[i]!) : undefined;
      const price: SpotPrice = {
        token: a.token,
        symbol: a.symbol,
        source: a.asset?.pyth ?? null,
        kind: a.asset?.kind ?? null,
        status: !a.asset ? "unmapped" : observation ? "available" : "unavailable",
        priceUsd: observation?.price ?? null,
        priceTimestamp: observation?.publishTime ?? null,
        fetchedAt: observation ? fetchedAt : null,
        valuationCompatible: a.asset?.kind === "stablecoin" || a.asset?.kind === "crypto",
      };
      return expireSpotPrice(price, now);
    });
    return { source: "pyth", displayOnly: true, chainId: this.chainId, asOf: fetchedAt, prices };
  }
}
