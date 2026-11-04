import { describe, expect, test } from "bun:test";
import type { Address } from "viem";

import {
  assertWorldEvidenceIntegrity,
  buildBookCreationEvidence,
  buildBookFixingEvidence,
  buildEventResolutionEvidence,
  hashCanonical,
  legEvidence,
  MarketDataError,
  normalizeGammaMarket,
  payoutOutcome,
} from "../src/index.ts";
import { gammaMarket } from "./helpers.ts";

const preparer: Address = "0x0000000000000000000000000000000000000001";
const deployment = {
  chainId: "46630",
  books: "0x00000000000000000000000000000000000000b0" as Address,
  oracle: "0x00000000000000000000000000000000000000c0" as Address,
};
const KEY_A = `0x${"aa".repeat(32)}` as const;
const KEY_B = `0x${"bb".repeat(32)}` as const;
const leg = (eventKey: `0x${string}`, overrides: Record<string, unknown> = {}) =>
  legEvidence({
    metadata: normalizeGammaMarket(gammaMarket(overrides)),
    metadataSnapshotId: "snapshot-1",
    metadataRawHash: hashCanonical(gammaMarket(overrides)),
    eventKey,
    wantYes: true,
    themes: ["ai", "ai"],
  });
const priced = {
  feed: "0x00000000000000000000000000000000000000fe",
  underlying: "US:NVDA",
  feedDecimals: 8,
  fixingTime: "1800000000",
  maxStaleness: "3600",
  strikes: ["22000000000", "24000000000"],
  cutoff: "1799990000",
  feeBps: "100",
  fixingRule: "NVDA's close",
};
const creation = (book: Record<string, unknown> = priced, legs = [leg(KEY_A)]) =>
  buildBookCreationEvidence({
    deployment,
    title: "NVDA if AI",
    legs,
    book,
    attachments: [],
    preparedAt: "2026-11-01T00:00:00Z",
    preparer,
  });
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof MarketDataError ? error.code : String(error);
  }
  return null;
};

describe("world evidence packets", () => {
  test("a book's creation packet is canonical: the same inputs hash the same", () => {
    const first = creation();
    expect(first.packetHash).toBe(creation({ ...priced }).packetHash);
    expect(first.packet.legs[0]).toMatchObject({
      eventKey: KEY_A,
      conditionId: `0x${"12".repeat(32)}`,
      yesIndex: "1",
      noIndex: "2",
      themes: ["ai"],
    });
    expect(first.packet.preparedAt).toBe("2026-11-01T00:00:00.000Z");
    assertWorldEvidenceIntegrity(first);
    // Any change to the content is caught.
    const tampered = { ...first, packet: { ...first.packet, title: "Other" } };
    expect(code(() => assertWorldEvidenceIntegrity(tampered))).toBe("TAMPERED_EVIDENCE");
  });

  test("an event-only book carries no feed, fixing or strikes", () => {
    const { packet } = creation({
      ...priced,
      feed: "0x0000000000000000000000000000000000000000",
    });
    expect(packet.book).toMatchObject({
      underlying: null,
      feedDecimals: null,
      fixingTime: "0",
      strikes: [],
      fixingRule: null,
    });
  });

  test("books the contracts would refuse are refused before review", () => {
    expect(code(() => creation({ ...priced, strikes: [] }))).toBe("INVALID_EVIDENCE");
    expect(code(() => creation({ ...priced, strikes: ["2", "1"] }))).toBe("INVALID_EVIDENCE");
    expect(code(() => creation({ ...priced, feeBps: "1001" }))).toBe("INVALID_EVIDENCE");
    expect(code(() => creation(priced, [leg(KEY_A), leg(KEY_A)]))).toBe("INVALID_EVIDENCE");
    expect(
      code(() =>
        creation(
          priced,
          Array.from({ length: 7 }, () => leg(KEY_B)),
        ),
      ),
    ).toBe("INVALID_EVIDENCE");
    expect(code(() => leg(KEY_B, { closed: true }))).toBe("INVALID_EVIDENCE");
    expect(code(() => leg(KEY_B, { active: false }))).toBe("INVALID_EVIDENCE");
  });

  test("an event's resolution names its oracle outcome; a voided market resolves INVALID", () => {
    expect(payoutOutcome({ yes: "1", no: "0", denominator: "1" })).toBe(3);
    expect(payoutOutcome({ yes: "0", no: "1", denominator: "1" })).toBe(4);
    expect(payoutOutcome({ yes: "1", no: "1", denominator: "2" })).toBe(5);
    const input = {
      deployment,
      event: {
        eventKey: KEY_A,
        source: "polymarket" as const,
        marketId: "gamma-42",
        conditionId: `0x${"12".repeat(32)}` as const,
        yesIndex: "1",
        noIndex: "2",
      },
      metadataRawHash: hashCanonical(gammaMarket()),
      metadataSnapshotId: "snapshot-2",
      officialStatus: "resolved",
      officialUrl: "https://polymarket.com/event/x",
      payout: { yes: "0", no: "1", denominator: "1" },
      polygon: {
        chainId: "137",
        conditionalTokensAddress: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
        blockHash: null,
        blockNumber: "70000000",
        transactionHash: null,
      },
      sourceObservations: [
        {
          observedAt: "2026-11-02T00:00:00Z",
          payout: { yes: "0", no: "1", denominator: "1" },
          status: "resolved",
          url: "https://gamma-api.polymarket.com/markets/gamma-42",
        },
      ],
      sourceReference: "https://gamma-api.polymarket.com/markets/gamma-42",
      attachments: [],
      preparedAt: "2026-11-02T00:01:00Z",
      preparer,
    };
    const envelope = buildEventResolutionEvidence(input);
    expect(envelope.packet.outcome).toBe(4);
    assertWorldEvidenceIntegrity(envelope);
    // The outcome must follow the payout, even with the hash recomputed.
    const flipped = { ...envelope.packet, outcome: 3 as const };
    expect(
      code(() =>
        assertWorldEvidenceIntegrity({ packet: flipped, packetHash: hashCanonical(flipped) }),
      ),
    ).toBe("INVALID_EVIDENCE");
    // Observations must agree; Polygon is chain 137; Kalshi has no Polygon record.
    expect(
      code(() =>
        buildEventResolutionEvidence({
          ...input,
          sourceObservations: [
            { ...input.sourceObservations[0]!, payout: { yes: "1", no: "0", denominator: "1" } },
          ],
        }),
      ),
    ).toBe("CONFLICTING_EVIDENCE");
    expect(
      code(() =>
        buildEventResolutionEvidence({ ...input, polygon: { ...input.polygon, chainId: "1" } }),
      ),
    ).toBe("WRONG_NETWORK");
    expect(
      code(() =>
        buildEventResolutionEvidence({ ...input, event: { ...input.event, source: "kalshi" } }),
      ),
    ).toBe("INVALID_EVIDENCE");
    expect(
      buildEventResolutionEvidence({
        ...input,
        event: { ...input.event, source: "kalshi" },
        polygon: null,
      }).packet.polygon,
    ).toBeNull();
  });

  test("a fallback fixing records the feed's rounds and observations that agree on the price", () => {
    const input = {
      deployment,
      book: {
        id: "3",
        feed: "0x00000000000000000000000000000000000000fe" as Address,
        fixingTime: "1800000000",
        maxStaleness: "3600",
      },
      price: "23512000000",
      reason: "No round within the staleness window",
      rounds: [{ roundId: "18446744073709551700", answer: "23400000000", updatedAt: "1799990000" }],
      sourceObservations: [
        {
          observedAt: "2026-11-03T00:00:00Z",
          price: "23512000000",
          status: "official close",
          url: "https://www.nasdaq.com/market-activity/stocks/nvda/historical",
        },
      ],
      sourceReference: "https://www.nasdaq.com/market-activity/stocks/nvda/historical",
      attachments: [],
      preparedAt: "2026-11-03T00:01:00Z",
      preparer,
    };
    const envelope = buildBookFixingEvidence(input);
    expect(envelope.packet.rounds[0]!.roundId).toBe("18446744073709551700");
    assertWorldEvidenceIntegrity(envelope);
    expect(
      code(() =>
        buildBookFixingEvidence({
          ...input,
          sourceObservations: [{ ...input.sourceObservations[0]!, price: "1" }],
        }),
      ),
    ).toBe("CONFLICTING_EVIDENCE");
    expect(
      code(() => buildBookFixingEvidence({ ...input, sourceReference: "http://insecure.example" })),
    ).toBe("INVALID_EVIDENCE");
    expect(code(() => buildBookFixingEvidence({ ...input, price: (1n << 128n).toString() }))).toBe(
      "INVALID_EVIDENCE",
    );
  });
});
