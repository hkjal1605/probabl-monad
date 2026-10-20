import {
  type Hex,
  isHex32,
  MarketDataError,
  type ProbabilityTick,
} from "@conditional-stocks/market-data";
import type { KalshiIngestor } from "./kalshi/service.ts";
import type { PolymarketIngestor } from "./service.ts";

const condition = (value: unknown): Hex => {
  if (!isHex32(value)) throw new MarketDataError("INVALID_REQUEST", "conditionId must be bytes32");
  return value.toLowerCase() as Hex;
};

/** Every venue's markets behind one condition-keyed interface. A condition belongs to Kalshi
 * when Kalshi follows it (its id is derived from a ticker), and to Polymarket otherwise. */
export class EventMarkets {
  constructor(
    readonly polymarket: PolymarketIngestor,
    readonly kalshi?: KalshiIngestor,
  ) {}

  #kalshi(conditionId: Hex) {
    return this.kalshi?.tracks(conditionId) ? this.kalshi : undefined;
  }

  /** A stored snapshot of either venue. */
  async metadata(snapshotId: string) {
    return (
      (await this.polymarket.metadata(snapshotId)) ??
      (await this.kalshi?.metadata(snapshotId)) ??
      null
    );
  }

  /** Follows the market of a stored snapshot. */
  async track(snapshotId: string) {
    if (await this.polymarket.metadata(snapshotId)) return this.polymarket.track(snapshotId);
    if (!this.kalshi) throw new MarketDataError("NOT_FOUND", "metadata snapshot not found", 404);
    return this.kalshi.track(snapshotId);
  }

  async latestMetadata(conditionIdInput: unknown) {
    const conditionId = condition(conditionIdInput);
    const kalshi = this.#kalshi(conditionId);
    if (kalshi) return kalshi.latestMetadata(conditionId);
    return (
      (await this.polymarket.latestMetadata(conditionId)) ??
      (await this.kalshi?.latestMetadata(conditionId)) ??
      null
    );
  }

  async probability(conditionIdInput: unknown): Promise<ProbabilityTick> {
    const conditionId = condition(conditionIdInput);
    return (
      this.#kalshi(conditionId)?.probability(conditionId) ??
      this.polymarket.probability(conditionId)
    );
  }

  /** Listens on both venues: a market followed later still reaches the listener, and only its
   * own venue ever ticks for it. */
  subscribe(conditionIdInput: unknown, listener: (tick: ProbabilityTick) => void) {
    const conditionId = condition(conditionIdInput);
    const stops = [
      this.polymarket.subscribe(conditionId, listener),
      ...(this.kalshi ? [this.kalshi.subscribe(conditionId, listener)] : []),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }

  async reconcile(conditionIdInput: unknown) {
    const conditionId = condition(conditionIdInput);
    return (
      this.#kalshi(conditionId)?.refresh(conditionId) ?? this.polymarket.reconcile(conditionId)
    );
  }
}
