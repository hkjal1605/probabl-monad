import type { MarketView } from "@/types/api";

const hasProbability = (market: MarketView) =>
  market.probability.value !== null && Number.isFinite(market.probability.value);

/** Same base token and decimals; a book of another token is never retained. */
const sameBase = (a: MarketView, b: MarketView) =>
  a.base.token === b.base.token && a.base.decimals === b.base.decimals;

/** Retain durable display data across partial upstream failures. Book retention never
 * makes an unavailable snapshot executable; metadata/probability are informational. */
export function retainBookDisplays(previous: unknown, next: { markets: MarketView[] }) {
  const before = previous as { markets?: MarketView[] } | undefined;
  if (!Array.isArray(before?.markets)) return next;
  const old = new Map(before.markets.map((m) => [m.id, m]));
  return {
    markets: next.markets.map((m) => {
      const prior = old.get(m.id);
      const stable =
        m.bookQuality === "unavailable" &&
        prior &&
        sameBase(prior, m) &&
        prior.quoteToken === m.quoteToken &&
        prior.shareDecimals === m.shareDecimals &&
        prior.quoteTokenDecimals === m.quoteTokenDecimals &&
        prior.protocolVersion === m.protocolVersion &&
        prior.priceFormat === m.priceFormat
          ? { ...m, yes: prior.yes, no: prior.no }
          : m;
      if (!prior) return stable;
      const metadataUnavailable = m.question === `Conditional market ${m.id.slice(0, 8)}`;
      return {
        ...stable,
        description: metadataUnavailable ? prior.description : stable.description,
        imageUrl: stable.imageUrl ?? prior.imageUrl ?? null,
        mapping: {
          ...stable.mapping,
          sourceUrl:
            metadataUnavailable && prior.mapping.sourceUrl
              ? prior.mapping.sourceUrl
              : stable.mapping.sourceUrl,
        },
        probability:
          !hasProbability(stable) && hasProbability(prior) ? prior.probability : stable.probability,
        question: metadataUnavailable ? prior.question : stable.question,
      };
    }),
  };
}
