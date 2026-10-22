import { expect, test } from "bun:test";
import { eventVenue, quotePause, withoutUnpricedMarkets } from "../src/lib/markets/quote-pause";
import type { MarketView } from "../src/types/api";
import { fixtureMarkets } from "./fixtures/protocol";

const base = fixtureMarkets[0] as MarketView;
const market = (patch: Partial<MarketView>): MarketView => ({ ...base, ...patch });
const quoted = { ...base.yes, quote: { bid: "15.27", ask: "15.59" } };
const { quote: _, ...unquoted } = base.yes;
const valid = { ...base.probability, quality: "valid" as const, value: 0.79 };
const oneSided = { ...base.probability, quality: "one-sided" as const, value: null };
const live = { live: true, quoted: 150 };

test("an open market no vault quotes is paused for the event market's price, else the vault's", () => {
  const open = { lifecycle: "open" as const, yes: unquoted, no: unquoted };
  expect(quotePause(market({ ...open, probability: oneSided }), live)).toBe("probability");
  expect(quotePause(market({ ...open, probability: valid }), live)).toBe("vault");
});

test("no pause while either branch is quoted or the market is not trading", () => {
  const unpriced = { lifecycle: "open" as const, probability: oneSided, no: unquoted };
  expect(quotePause(market({ ...unpriced, yes: quoted }), live)).toBeNull();
  expect(quotePause(market({ ...unpriced, yes: unquoted, lifecycle: "frozen" }), live)).toBeNull();
});

test("a makers' outage is not taken for this market's pause", () => {
  const paused = market({ lifecycle: "open", probability: oneSided, yes: unquoted, no: unquoted });
  expect(quotePause(paused, { live: false, quoted: 150 })).toBeNull();
  expect(quotePause(paused, { live: true, quoted: 0 })).toBeNull();
});

test("event venues by name", () => {
  expect(eventVenue("kalshi")).toBe("Kalshi");
  expect(eventVenue("polymarket")).toBe("Polymarket");
});

test("the markets list leaves out open markets with no usable event price and no vault quote", () => {
  const kalshi = (id: string, patch: Partial<MarketView>) =>
    market({ id, lifecycle: "open", mapping: { ...base.mapping, source: "kalshi" }, ...patch });
  const disconnected = { ...base.probability, quality: "disconnected" as const, value: null };
  const markets = [
    kalshi("priced", { probability: valid, yes: quoted, no: unquoted }),
    kalshi("settling", { probability: disconnected, yes: unquoted, no: unquoted }),
    kalshi("one-sided", { probability: oneSided, yes: unquoted, no: unquoted }),
    // A vault still quoting it, or a market no longer trading, stays listed.
    kalshi("still-quoted", { probability: disconnected, yes: unquoted, no: quoted }),
    kalshi("resolving", {
      lifecycle: "awaiting-resolution",
      probability: disconnected,
      yes: unquoted,
      no: unquoted,
    }),
    // The price is usable, so whatever stops the vaults, the market stays listed.
    kalshi("vault-paused", { probability: valid, yes: unquoted, no: unquoted }),
  ];
  expect(withoutUnpricedMarkets(markets).map((m) => m.id)).toEqual([
    "priced",
    "still-quoted",
    "resolving",
    "vault-paused",
  ]);
});

test("a venue giving no market a usable price is an outage: none of its markets is left out", () => {
  const venue = (
    id: string,
    source: "kalshi" | "polymarket",
    probability: MarketView["probability"] = oneSided,
  ) =>
    market({
      id,
      lifecycle: "open",
      probability,
      mapping: { ...base.mapping, source },
      yes: unquoted,
      no: unquoted,
    });
  const markets = [venue("k1", "kalshi"), venue("k2", "kalshi"), venue("p1", "polymarket", valid)];
  expect(withoutUnpricedMarkets(markets).map((m) => m.id)).toEqual(["k1", "k2", "p1"]);
  const all = [venue("k1", "kalshi"), venue("k2", "kalshi")];
  expect(withoutUnpricedMarkets(all)).toBe(all);
});
