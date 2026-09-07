import { describe, expect, test } from "bun:test";
import {
  Branch,
  FundingKind,
  quoteForExecution,
  Side,
  TimeInForce,
  WAD,
} from "@conditional-stocks/domain";
import type { Hex } from "viem";

import {
  canonicalParse,
  canonicalStringify,
  DeterministicMatcher,
  hashCanonical,
  MarketState,
  MatchSkipReason,
  makeBookKey,
  SlowReferenceMatcher,
} from "../src/index.ts";
import { address, Events, hash, MARKET, order, ZERO_HASH } from "./helpers.ts";

const BOOK = makeBookKey(MARKET, Branch.Yes);

const configured = () => {
  const events = new Events();
  const matcher = new DeterministicMatcher();
  for (const event of events.configure()) matcher.apply(event);
  return { events, matcher };
};

describe("canonical codec", () => {
  test("sorts keys, preserves bigint types, and rejects non-integers", () => {
    const encoded = canonicalStringify({ z: 2n, a: [true, "2"] });
    expect(encoded).toBe('{"a":[true,"2"],"z":{"$bigint":"2"}}');
    expect(canonicalParse<{ a: Array<boolean | string>; z: bigint }>(encoded)).toEqual({
      a: [true, "2"],
      z: 2n,
    });
    expect(() => canonicalStringify({ unsafe: 1.5 })).toThrow();
  });
});

describe("deterministic price-time matcher", () => {
  test("signed fee caps survive normalization, proposals, and checkpoint replay", () => {
    const { events, matcher } = configured();
    matcher.apply(
      events.open(hash(1), 0n, order(1, Side.Buy, 6n * WAD, 10n * WAD, { maxFeeBps: 25 })),
    );
    matcher.apply(
      events.open(hash(2), 1n, order(2, Side.Sell, 5n * WAD, 10n * WAD, { maxFeeBps: 75 })),
    );
    const fill = matcher.preview(BOOK).proposal?.fills[0];
    expect(fill?.buyOrder.maxFeeBps).toBe(25);
    expect(fill?.sellOrder.maxFeeBps).toBe(75);
    expect(
      matcher
        .checkpoint()
        .books[0]?.orders.map((value) => value.maxFeeBps)
        .sort(),
    ).toEqual([25, 75]);
    const restored = DeterministicMatcher.fromCheckpoint(
      canonicalParse(canonicalStringify(matcher.checkpoint())),
    );
    expect(restored.preview(BOOK)).toEqual(matcher.preview(BOOK));
  });
  test("uses the earlier bid as maker and reserves a proposal only once", () => {
    const { events, matcher } = configured();
    matcher.apply(events.open(hash(1), 0n, order(1, Side.Buy, 6n * WAD)));
    matcher.apply(events.open(hash(2), 1n, order(2, Side.Sell, 5n * WAD)));

    const preview = matcher.preview(BOOK);
    expect(preview.proposal?.fills).toHaveLength(1);
    expect(preview.proposal?.fills[0]?.makerOrderHash).toBe(hash(1));
    expect(preview.proposal?.fills[0]?.executionPriceRawX18).toBe(6n * WAD);
    if (!preview.proposal) throw new Error("proposal missing");
    matcher.commitProposal(preview.proposal);
    matcher.commitProposal(preview.proposal);

    expect(matcher.preview(BOOK).skip?.reason).toBe(MatchSkipReason.ActiveProposal);
    const snapshot = matcher.checkpoint().books[0];
    expect(snapshot?.orders.every((value) => value.pending === 10n * WAD)).toBe(true);
  });

  test("uses the earlier ask as maker and honors same-price FIFO across partial fills", () => {
    const { events, matcher } = configured();
    matcher.apply(events.open(hash(10), 0n, order(10, Side.Sell, 4n * WAD, 3n * WAD)));
    matcher.apply(events.open(hash(11), 1n, order(11, Side.Sell, 4n * WAD, 4n * WAD)));
    matcher.apply(events.open(hash(12), 2n, order(12, Side.Buy, 5n * WAD, 6n * WAD)));

    const proposal = matcher.preview(BOOK).proposal;
    expect(proposal?.fills.map((fill) => fill.sellOrderHash)).toEqual([hash(10), hash(11)]);
    expect(proposal?.fills.map((fill) => fill.fillQuantity)).toEqual([3n * WAD, 3n * WAD]);
    expect(proposal?.fills.every((fill) => fill.executionPriceRawX18 === 4n * WAD)).toBe(true);
    expect(proposal?.decisions[0]?.askQueue.orderHashes).toEqual([hash(10), hash(11)]);
    expect(proposal?.decisions[1]?.askQueue.orderHashes).toEqual([hash(11)]);
  });

  test("keeps YES/NO and funding kinds matching-agnostic and isolated", () => {
    const { events, matcher } = configured();
    matcher.apply(
      events.open(
        hash(20),
        0n,
        order(20, Side.Buy, 6n * WAD, 2n * WAD, {
          fundingKind: FundingKind.ActiveClaim,
        }),
      ),
    );
    matcher.apply(
      events.open(
        hash(21),
        1n,
        order(21, Side.Sell, 5n * WAD, 2n * WAD, {
          fundingKind: FundingKind.WholeCollateral,
        }),
      ),
    );
    matcher.apply(
      events.open(hash(22), 0n, order(22, Side.Buy, 6n * WAD, 2n * WAD, { branch: Branch.No })),
    );
    expect(matcher.preview(BOOK).proposal?.fills[0]?.fillQuantity).toBe(2n * WAD);
    expect(matcher.preview(makeBookKey(MARKET, Branch.No)).skip?.reason).toBe(
      MatchSkipReason.NoCross,
    );
  });

  test("requires gap-free sequences including IOC and rejects off-grid opens", () => {
    const { events, matcher } = configured();
    const initial = matcher.checkpoint();
    expect(() => matcher.apply(events.open(hash(23), 1n, order(23, Side.Buy, 6n * WAD)))).toThrow(
      "sequence",
    );
    expect(matcher.checkpoint()).toEqual(initial);

    matcher.apply(
      events.open(hash(24), 0n, order(24, Side.Buy, 6n * WAD, WAD, { tif: TimeInForce.Ioc })),
    );
    matcher.apply(events.open(hash(25), 1n, order(25, Side.Buy, 6n * WAD)));
    expect(matcher.checkpoint().books[0]?.highestSequence).toBe(1n);
    expect(matcher.checkpoint().books[0]?.orders.map((item) => item.orderHash)).toEqual([hash(25)]);

    const beforeOffGrid = matcher.checkpoint();
    expect(() =>
      matcher.apply(events.open(hash(26), 2n, order(26, Side.Buy, 6n * WAD, WAD + 1n))),
    ).toThrow("projected market state");
    expect(() =>
      matcher.apply(events.open(hash(27), 2n, order(27, Side.Buy, 6n * WAD + 1n))),
    ).toThrow("projected market state");
    expect(matcher.checkpoint()).toEqual(beforeOffGrid);
  });

  test("invalidates pending quantities on cancellation, nonce invalidation, freeze, and expiry", () => {
    const { events, matcher } = configured();
    matcher.apply(events.open(hash(30), 0n, order(30, Side.Buy, 6n * WAD)));
    matcher.apply(events.open(hash(31), 1n, order(31, Side.Sell, 5n * WAD)));
    const proposal = matcher.preview(BOOK).proposal;
    if (!proposal) throw new Error("proposal missing");
    matcher.commitProposal(proposal);
    const cancelled = matcher.apply(
      events.envelope({
        type: "order-cancelled",
        maker: address(30),
        orderHash: hash(30),
        reasonHash: hash(900),
        releasedAmount: 60n * WAD,
        unfilledQuantity: 10n * WAD,
      }),
    );
    expect(cancelled.invalidatedProposalIds).toEqual([proposal.proposalId]);

    matcher.apply(
      events.open(hash(32), 2n, order(32, Side.Buy, 6n * WAD, 10n * WAD, { nonce: 1n })),
    );
    const nonceResult = matcher.apply(
      events.envelope({
        type: "nonce-invalidated",
        maker: address(32),
        newMinimumNonce: 2n,
        oldMinimumNonce: 0n,
      }),
    );
    expect(nonceResult.duplicate).toBe(false);

    matcher.apply(
      events.open(hash(33), 3n, order(33, Side.Buy, 6n * WAD, 10n * WAD, { expiry: 101n })),
    );
    matcher.apply(
      events.nextBlock(
        { type: "emergency-pause-changed", paused: true, reasonHash: hash(901) },
        101n,
      ),
    );
    expect(matcher.preview(BOOK).skip?.reason).toBe(MatchSkipReason.NoCross);

    matcher.apply(
      events.envelope({ type: "emergency-pause-changed", paused: false, reasonHash: hash(902) }),
    );
    matcher.apply(events.open(hash(34), 4n, order(34, Side.Buy, 6n * WAD)));
    matcher.apply(
      events.envelope({
        type: "market-state-changed",
        marketId: MARKET,
        newState: MarketState.Frozen,
        previousState: MarketState.Open,
        reasonHash: hash(903),
      }),
    );
    expect(matcher.preview(BOOK).skip?.reason).toBe(MatchSkipReason.MarketClosed);
  });

  test("restores a verified checkpoint exactly and rejects corruption", () => {
    const { events, matcher } = configured();
    matcher.apply(events.open(hash(40), 0n, order(40, Side.Buy, 6n * WAD)));
    matcher.apply(events.open(hash(41), 1n, order(41, Side.Sell, 5n * WAD)));
    const checkpoint = matcher.checkpoint();
    const restored = DeterministicMatcher.fromCheckpoint(checkpoint);
    expect(restored.checkpoint()).toEqual(checkpoint);
    expect(restored.preview(BOOK).proposal?.proposalId).toBe(
      matcher.preview(BOOK).proposal?.proposalId,
    );
    const pendingProposal = matcher.preview(BOOK).proposal;
    if (!pendingProposal) throw new Error("pending checkpoint proposal missing");
    matcher.commitProposal(pendingProposal);
    const pendingCheckpoint = matcher.checkpoint();
    expect(DeterministicMatcher.fromCheckpoint(pendingCheckpoint).checkpoint()).toEqual(
      pendingCheckpoint,
    );
    expect(() =>
      DeterministicMatcher.fromCheckpoint({ ...checkpoint, checkpointHash: ZERO_HASH }),
    ).toThrow();

    const corruptedData = {
      ...checkpoint,
      books: checkpoint.books.map((book) => ({ ...book, bids: [] })),
    };
    const { checkpointHash: _oldHash, ...withoutHash } = corruptedData;
    expect(() =>
      DeterministicMatcher.fromCheckpoint({
        ...withoutHash,
        checkpointHash: hashCanonical(withoutHash),
      }),
    ).toThrow("checkpoint price levels");
  });

  test("caps deterministic batches and continues only after canonical fills", () => {
    const events = new Events();
    const matcher = new DeterministicMatcher({ maxFillsPerProposal: 2 });
    for (const event of events.configure()) matcher.apply(event);
    matcher.apply(events.open(hash(50), 0n, order(50, Side.Sell, 4n * WAD, 1n * WAD)));
    matcher.apply(events.open(hash(51), 1n, order(51, Side.Sell, 4n * WAD, 1n * WAD)));
    matcher.apply(events.open(hash(52), 2n, order(52, Side.Sell, 4n * WAD, 1n * WAD)));
    matcher.apply(events.open(hash(53), 3n, order(53, Side.Buy, 5n * WAD, 3n * WAD)));
    const first = matcher.preview(BOOK).proposal;
    expect(first?.fills).toHaveLength(2);
    if (!first) throw new Error("first batch missing");
    matcher.commitProposal(first);
    for (const fill of first.fills) matcher.apply(events.fill(fill));
    expect(matcher.preview(BOOK).proposal?.fills).toHaveLength(1);
  });

  test("invalidates a pending GTC proposal when an IOC consumes one reserved leg", () => {
    const { events, matcher } = configured();
    matcher.apply(events.open(hash(60), 0n, order(60, Side.Buy, 6n * WAD)));
    matcher.apply(events.open(hash(61), 1n, order(61, Side.Sell, 5n * WAD)));
    const proposal = matcher.preview(BOOK).proposal;
    if (!proposal) throw new Error("pending proposal missing");
    matcher.commitProposal(proposal);

    const ioc = order(62, Side.Sell, 5n * WAD, 10n * WAD, { tif: TimeInForce.Ioc });
    matcher.apply(events.open(hash(62), 2n, ioc));
    const result = matcher.apply(
      events.envelope({
        type: "order-filled",
        branch: Branch.Yes,
        buyOrderHash: hash(60),
        executionPriceRawX18: 6n * WAD,
        executionQuote: quoteForExecution(10n * WAD, 6n * WAD),
        fillQuantity: 10n * WAD,
        makerOrderHash: hash(60),
        marketId: MARKET,
        sellOrderHash: hash(62),
      }),
    );
    expect(result.invalidatedProposalIds).toEqual([proposal.proposalId]);
    expect(matcher.checkpoint().books[0]?.pendingProposal).toBeNull();
  });

  test("stops proposals at the canonical trading cutoff even before freeze", () => {
    const { events, matcher } = configured();
    matcher.apply(events.open(hash(70), 0n, order(70, Side.Buy, 6n * WAD)));
    matcher.apply(events.open(hash(71), 1n, order(71, Side.Sell, 5n * WAD)));
    matcher.apply(
      events.nextBlock(
        { type: "emergency-pause-changed", paused: true, reasonHash: hash(700) },
        9_000n,
      ),
    );
    matcher.apply(
      events.envelope(
        { type: "emergency-pause-changed", paused: false, reasonHash: hash(701) },
        9_000n,
      ),
    );
    expect(matcher.preview(BOOK).skip?.reason).toBe(MatchSkipReason.MarketCutoff);
  });

  test("rejects malformed projected events without partially advancing expiry state", () => {
    const { events, matcher } = configured();
    matcher.apply(
      events.open(hash(80), 0n, order(80, Side.Buy, 6n * WAD, 10n * WAD, { expiry: 101n })),
    );
    const before = matcher.checkpoint();
    const malformed = events.nextBlock(
      {
        type: "market-state-changed",
        marketId: MARKET,
        newState: MarketState.Resolved,
        previousState: MarketState.Scheduled,
        reasonHash: hash(800),
      },
      101n,
    );
    expect(() => matcher.apply(malformed)).toThrow("market state transition");
    expect(matcher.checkpoint()).toEqual(before);
  });
});

describe("slow reference shadow", () => {
  test("matches optimized state and proposals across randomized event streams", () => {
    let seed = 0x6d2b79f5;
    const random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };

    const events = new Events();
    const optimized = new DeterministicMatcher({ maxFillsPerProposal: 8 });
    const reference = new SlowReferenceMatcher(8);
    const applyBoth = (event: ReturnType<Events["envelope"]>) => {
      expect(reference.apply(event)).toEqual(optimized.apply(event));
      expect(reference.checkpoint()).toEqual(optimized.checkpoint());
    };
    for (const event of events.configure()) applyBoth(event);

    for (let index = 0; index < 250; index += 1) {
      const side = random() < 0.5 ? Side.Buy : Side.Sell;
      const price = BigInt(3 + Math.floor(random() * 5)) * WAD;
      const quantity = BigInt(1 + Math.floor(random() * 5)) * WAD;
      applyBoth(
        events.open(
          hash(1_000 + index),
          BigInt(index),
          order(1_000 + index, side, price, quantity),
        ),
      );

      while (true) {
        const fastPreview = optimized.preview(BOOK);
        const slowPreview = reference.preview(BOOK);
        expect(slowPreview).toEqual(fastPreview);
        if (!fastPreview.proposal) break;
        const remaining = new Map(
          (optimized.checkpoint().books[0]?.orders ?? []).map(
            (item) => [item.orderHash, item.remaining] as const,
          ),
        );
        const proposed = new Map<Hex, bigint>();
        for (const fill of fastPreview.proposal.fills) {
          expect(fill.buyOrder.limitPriceRawX18).toBeGreaterThanOrEqual(
            fill.sellOrder.limitPriceRawX18,
          );
          expect(fill.executionPriceRawX18).toBe(
            fill.makerOrderHash === fill.buyOrderHash
              ? fill.buyOrder.limitPriceRawX18
              : fill.sellOrder.limitPriceRawX18,
          );
          expect(fill.fillQuantity).toBeGreaterThan(0n);
          proposed.set(
            fill.buyOrderHash,
            (proposed.get(fill.buyOrderHash) ?? 0n) + fill.fillQuantity,
          );
          proposed.set(
            fill.sellOrderHash,
            (proposed.get(fill.sellOrderHash) ?? 0n) + fill.fillQuantity,
          );
        }
        for (const [orderHash, quantity] of proposed) {
          expect(quantity).toBeLessThanOrEqual(remaining.get(orderHash) ?? 0n);
        }
        optimized.commitProposal(fastPreview.proposal);
        reference.commitProposal(fastPreview.proposal);
        expect(reference.checkpoint()).toEqual(optimized.checkpoint());
        for (const fill of fastPreview.proposal.fills) applyBoth(events.fill(fill));
      }

      if (index % 17 === 0) {
        const active = optimized.checkpoint().books[0]?.orders;
        const target = active?.[Math.floor(random() * active.length)];
        if (target) {
          applyBoth(
            events.envelope({
              type: "order-cancelled",
              maker: target.maker,
              orderHash: target.orderHash,
              reasonHash: hash(9_000 + index),
              releasedAmount: target.reserved,
              unfilledQuantity: target.remaining,
            }),
          );
        }
      }
    }
  });
});
