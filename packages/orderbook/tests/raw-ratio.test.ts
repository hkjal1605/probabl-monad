import { expect, test } from "bun:test";
import {
  Branch,
  FundingKind,
  quoteForExecution,
  quoteForReservation,
  Side,
  WAD,
} from "@conditional-stocks/domain";
import { DeterministicMatcher, makeBookKey, SlowReferenceMatcher } from "../src/index.ts";
import { Events, hash, MARKET, order } from "./helpers.ts";

test("stock18/USDG6 raw ratios match reference, preserve FIFO and survive checkpoint replay", () => {
  for (const branch of [Branch.Yes, Branch.No])
    for (const bidFunding of [FundingKind.WholeCollateral, FundingKind.ActiveClaim])
      for (const askFunding of [FundingKind.WholeCollateral, FundingKind.ActiveClaim]) {
        const events = new Events();
        const matcher = new DeterministicMatcher();
        const reference = new SlowReferenceMatcher();
        const apply = (event: ReturnType<Events["envelope"]>) => {
          matcher.apply(event);
          reference.apply(event);
        };
        for (const envelope of events.configure()) {
          if (envelope.event.type === "market-terms-configured") {
            envelope.event.baseStep = 10n ** 15n;
            envelope.event.priceTickRawX18 = 10_000n;
          }
          apply(envelope);
        }
        apply(
          events.open(
            hash(1),
            0n,
            order(1, Side.Sell, 200_000_000n, WAD, { branch, fundingKind: askFunding }),
          ),
        );
        apply(
          events.open(
            hash(2),
            1n,
            order(2, Side.Sell, 200_000_000n, WAD, { branch, fundingKind: askFunding }),
          ),
        );
        apply(
          events.open(
            hash(3),
            2n,
            order(3, Side.Buy, 210_000_000n, (15n * WAD) / 10n, {
              branch,
              fundingKind: bidFunding,
            }),
          ),
        );
        const key = makeBookKey(MARKET, branch);
        const preview = matcher.preview(key);
        expect(preview).toEqual(reference.preview(key));
        expect(preview.proposal?.fills.map((f) => f.sellOrderHash)).toEqual([hash(1), hash(2)]);
        expect(
          preview.proposal?.fills.map((f) =>
            quoteForExecution(f.fillQuantity, f.executionPriceRawX18),
          ),
        ).toEqual([200_000_000n, 100_000_000n]);
        expect(quoteForReservation((15n * WAD) / 10n, 210_000_000n)).toBe(315_000_000n);
        const restored = DeterministicMatcher.fromCheckpoint(matcher.checkpoint());
        expect(restored.preview(key)).toEqual(preview);
        expect(() =>
          DeterministicMatcher.fromCheckpoint({
            ...matcher.checkpoint(),
            schemaVersion: 1,
          } as never),
        ).toThrow();
      }
});
