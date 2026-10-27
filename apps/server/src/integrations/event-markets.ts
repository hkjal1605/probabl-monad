import type { EventMarket, Hex } from "@conditional-stocks/market-data";
import { MarketDataError } from "@conditional-stocks/market-data";

/** A stored venue snapshot (Polymarket or Kalshi); evidence refers to it by `snapshotId`. */
export interface MetadataSnapshot {
  fetchedAtMs: string;
  normalized: EventMarket;
  rawHash: Hex;
  rawPayload: unknown;
  snapshotId: string;
}

/** The ingestor (services/polymarket-ingestor), which follows Polymarket and Kalshi markets. */
export class EventMarketsClient {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  /** Stores and returns a fresh snapshot of a Polymarket (Gamma id) or Kalshi (ticker) market. */
  fetchMetadata(source: EventMarket["source"], marketId: string): Promise<MetadataSnapshot> {
    return source === "kalshi"
      ? this.#internal<MetadataSnapshot>("/internal/kalshi/metadata/fetch", { ticker: marketId })
      : this.#internal<MetadataSnapshot>("/internal/metadata/fetch", { gammaMarketId: marketId });
  }

  /** Starts following the market of a stored snapshot (its odds feed). */
  track(metadataSnapshotId: string): Promise<{ conditionId: Hex }> {
    return this.#internal("/internal/subscriptions", { metadataSnapshotId });
  }

  async snapshot(snapshotId: string): Promise<MetadataSnapshot> {
    return this.#get<MetadataSnapshot>(
      `/internal/metadata/snapshots/${encodeURIComponent(snapshotId)}`,
      true,
    );
  }

  probability(conditionId: Hex): Promise<unknown> {
    return this.#get(`/v1/conditions/${conditionId}/probability`, false);
  }

  metadata(conditionId: Hex): Promise<MetadataSnapshot> {
    return this.#get(`/v1/conditions/${conditionId}/metadata`, false);
  }

  async #internal<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        body: JSON.stringify(body),
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new MarketDataError(
        "INGESTOR_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
        503,
      );
    }
    return this.#response<T>(response);
  }

  async #get<T>(path: string, internal: boolean): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...(internal ? { headers: { authorization: `Bearer ${this.token}` } } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new MarketDataError(
        "INGESTOR_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
        503,
      );
    }
    return this.#response<T>(response);
  }

  async #response<T>(response: Response): Promise<T> {
    const body = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new MarketDataError(
        "INGESTOR_ERROR",
        body.error?.message ?? `ingestor returned ${response.status}`,
        response.status >= 500 ? 503 : response.status,
      );
    }
    return body;
  }
}
