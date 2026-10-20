import { describe, expect, test } from "bun:test";
import {
  assertEvidenceIntegrity,
  buildCreationEvidence,
  buildResolutionEvidence,
  eventSourceOf,
  hashCanonical,
  KalshiYesBook,
  kalshiConditionId,
  kalshiPayout,
  MarketDataError,
  normalizeKalshiMarket,
  yesOutcome,
} from "../src/index.ts";
import { kalshiSnapshot } from "./helpers.ts";

const ticker = "KXFEDDECISION-26DEC-H25";
const policy = { staleAfterMs: 90_000n, standardNotionalX6: 100_000_000n };

describe("Kalshi markets", () => {
  test("normalize to a YES/NO event market with a ticker-derived condition id", () => {
    const market = normalizeKalshiMarket(kalshiSnapshot());
    expect(market).toMatchObject({
      source: "kalshi",
      ticker,
      eventTicker: "KXFEDDECISION-26DEC",
      seriesTicker: "KXFEDDECISION",
      conditionId: kalshiConditionId(ticker),
      active: true,
      closed: false,
      canonicalUrl: "https://kalshi.com/markets/kxfeddecision",
      endTime: "2026-12-09T18:59:00.000Z",
      question: "Will the Federal Reserve Hike rates by 25bps at their December 2026 meeting?",
      resolutionSource: "Federal Reserve",
      result: null,
    });
    expect(market.rules).not.toContain("\n\n");
    expect(yesOutcome(market)).toEqual({ indexSet: "1", label: "YES", tokenId: `${ticker}:yes` });
    expect(kalshiConditionId(ticker)).not.toBe(kalshiConditionId(`${ticker}X`));
    expect(eventSourceOf(market.canonicalUrl)).toBe("kalshi");
    expect(eventSourceOf("https://polymarket.com/event/x")).toBe("polymarket");
  });

  test("name the strike of ladder markets whose title is not a question", () => {
    const market = normalizeKalshiMarket(
      kalshiSnapshot({
        title: "Bitcoin price on Oct 20, 2026?",
        yes_sub_title: "$92,250 or above",
      }),
    );
    expect(market.question).toBe("Bitcoin price on Oct 20, 2026: $92,250 or above?");
  });

  test("reject non-binary markets and a mismatched event", () => {
    for (const input of [
      kalshiSnapshot({ market_type: "scalar" }),
      kalshiSnapshot({}, { event_ticker: "KXOTHER-26DEC" }),
      kalshiSnapshot({ ticker: "lowercase-ticker" }),
    ])
      expect(() => normalizeKalshiMarket(input)).toThrow(MarketDataError);
  });

  test("pay out only once Kalshi's result is final", () => {
    const at = (status: string, result: string) =>
      kalshiPayout(normalizeKalshiMarket(kalshiSnapshot({ status, result })));
    expect(at("active", "")).toBeNull();
    expect(at("determined", "yes")).toBeNull();
    expect(at("finalized", "yes")).toEqual({ denominator: "1", no: "0", yes: "1" });
    expect(at("finalized", "no")).toEqual({ denominator: "1", no: "1", yes: "0" });
    expect(normalizeKalshiMarket(kalshiSnapshot({ status: "closed" })).closed).toBe(true);
  });

  test("books turn NO bids into YES asks", () => {
    const book = new KalshiYesBook(kalshiConditionId(ticker), `${ticker}:yes`, policy);
    const tick = book.applyOrderbook(
      {
        orderbook_fp: {
          yes_dollars: [
            ["0.7600", "500.00"],
            ["0.7700", "300.00"],
          ],
          no_dollars: [["0.2100", "400.00"]],
        },
      },
      1_000n,
    );
    expect(tick).toMatchObject({
      bestBidX6: "770000",
      bestAskX6: "790000",
      midpointX6: "780000",
      quality: "valid",
      yesTokenId: `${ticker}:yes`,
    });
    expect(book.applyOrderbook({ orderbook_fp: { yes_dollars: null } }, 2_000n).quality).toBe(
      "empty",
    );
  });

  test("evidence records the Kalshi market, and its resolution carries no Polygon record", () => {
    const metadata = normalizeKalshiMarket(kalshiSnapshot());
    const deployment = {
      chainId: "46630",
      exchange: "0x0000000000000000000000000000000000000099" as const,
    };
    const preparer = "0x0000000000000000000000000000000000000001" as const;
    const creation = buildCreationEvidence({
      deployment,
      attachments: [],
      config: {
        baseStep: "1000000000000000",
        baseToken: "0x0000000000000000000000000000000000000010",
        makerFeeBps: "0",
        maxMarketOpenNotional: "1000000000000",
        maxOrderNotional: "10000000000",
        maxOrderQuantity: "1000000000000000000000",
        maxWalletOpenNotional: "100000000000",
        metadataUri: metadata.canonicalUrl,
        minNotional: "1000000",
        priceTickRawX18: "10000",
        quoteToken: "0x0000000000000000000000000000000000000020",
        rules: metadata.rules,
        takerFeeBps: "0",
        tradingCutoff: "1800000000",
        tradingOpen: "1700000000",
      },
      metadata,
      metadataRawHash: hashCanonical(kalshiSnapshot()),
      metadataSnapshotId: "kalshi-snapshot",
      preparedAt: "2026-10-20T00:00:00Z",
      preparer,
      sourceUrls: [metadata.canonicalUrl],
    });
    expect(creation.packet.event).toMatchObject({ source: "kalshi", marketId: ticker });
    expect(creation.packet.config.eventConditionId).toBe(kalshiConditionId(ticker));
    assertEvidenceIntegrity(creation);
    const payout = { denominator: "1", no: "0", yes: "1" };
    const resolution = {
      deployment,
      attachments: [],
      conditionId: "3",
      marketId: "3",
      source: "kalshi" as const,
      eventMarketId: ticker,
      metadataRawHash: hashCanonical(kalshiSnapshot()),
      metadataSnapshotId: "kalshi-final",
      officialStatus: "finalized",
      officialUrl: metadata.canonicalUrl,
      payout,
      polygon: null,
      eventConditionId: metadata.conditionId,
      eventYesIndex: "1",
      eventNoIndex: "2",
      preparedAt: "2026-12-10T00:00:00Z",
      preparer,
      sourceObservations: [
        {
          observedAt: "2026-12-10T00:00:00Z",
          payout,
          status: "finalized",
          url: metadata.canonicalUrl,
        },
      ],
      sourceReference: metadata.canonicalUrl,
    };
    const packet = buildResolutionEvidence(resolution);
    expect(packet.packet.polygon).toBeNull();
    expect(packet.packet.official).toMatchObject({ source: "kalshi", marketId: ticker });
    expect(() =>
      buildResolutionEvidence({
        ...resolution,
        polygon: { chainId: "137", conditionalTokensAddress: preparer },
      }),
    ).toThrow("off chain");
  });
});
