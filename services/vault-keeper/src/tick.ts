import type { TokenReader } from "@conditional-stocks/indexer";
import { type Fees, fetchPolymarket, fetchSpotPrices } from "@conditional-stocks/operator";
import type { Address, PublicClient } from "viem";

type SpotPricesResponse = Awaited<ReturnType<typeof fetchSpotPrices>>;

export interface TickSources {
  origin: string;
  client: PublicClient;
  tokens: TokenReader;
  /** The exchange's quote token and every quoted vault's stock. */
  quote: Address;
  bases: readonly Address[];
  spotPrices?: typeof fetchSpotPrices;
  polymarket?: typeof fetchPolymarket;
}

/** What the vaults quoted in one round share. Each read is made on first use and every later
 * user awaits the same promise: one spot-price request for every token, one Polymarket read per
 * event (markets of different stocks on one event share it), one refresh of the issuers' state
 * and one fee estimate, however many vaults and markets the round quotes. */
export class Tick {
  private spot: Promise<SpotPricesResponse> | undefined;
  private events = new Map<string, Promise<unknown>>();
  private issuerState: Promise<void> | undefined;
  private fees: Promise<Fees | undefined> | undefined;

  constructor(readonly sources: TickSources) {}

  spotPrices() {
    const { origin, quote, bases } = this.sources;
    this.spot ??= (this.sources.spotPrices ?? fetchSpotPrices)(origin, [quote, ...bases]);
    return this.spot;
  }

  /** Polymarket metadata and probability of `condition`, read through one of its markets. */
  polymarket(market: number, condition: string) {
    const key = condition.toLowerCase();
    let event = this.events.get(key);
    if (!event) {
      event = (this.sources.polymarket ?? fetchPolymarket)(this.sources.origin, market);
      this.events.set(key, event);
    }
    return event;
  }

  /** Starts the reads a market's reference needs, so they overlap the chain reads. */
  prefetch(market: number, condition: string) {
    this.spotPrices().catch(() => undefined);
    this.polymarket(market, condition).catch(() => undefined);
  }

  /** The issuers' pause and UI multiplier of every quoted stock (one multicall). */
  issuers() {
    this.issuerState ??= this.sources.tokens
      .refreshLive([...this.sources.bases])
      .then(() => undefined);
    return this.issuerState;
  }

  /** EIP-1559 fees for this round's transactions; none when the chain cannot estimate them. */
  gasFees() {
    this.fees ??= this.sources.client.estimateFeesPerGas().then(
      ({ maxFeePerGas, maxPriorityFeePerGas }) =>
        maxFeePerGas !== undefined && maxPriorityFeePerGas !== undefined
          ? { maxFeePerGas, maxPriorityFeePerGas }
          : undefined,
      () => undefined,
    );
    return this.fees;
  }
}
