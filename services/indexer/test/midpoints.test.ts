import { expect, test } from "bun:test";
import { emptyState } from "@conditional-stocks/evm-client/ledger";
import { bookMidpoints } from "../src/projection.ts";

const QUOTE = "0x00000000000000000000000000000000000000A1";

test("book midpoints: halfway between the best live bid and ask of each branch", () => {
  const s = emptyState(QUOTE);
  s.markets.set(1, { id: 1, state: 2, cutoff: 2_000n, tick: 10n } as never);
  s.markets.set(2, { id: 2, state: 2, cutoff: 2_000n, tick: 10n } as never);
  let key = 0;
  const order = (market: number, branch: number, side: number, ticks: bigint, over = {}) =>
    s.orders.set(String(key++), {
      market,
      branch,
      side,
      ticks,
      status: "open",
      expiry: 2_000n,
      owner: "0x00000000000000000000000000000000000000B1",
      epoch: 0n,
      ...over,
    } as never);
  // YES: bids 900 and 1000, asks 1200 and 1300; NO: a bid only, and an expired ask.
  order(1, 0, 0, 90n);
  order(1, 0, 0, 100n);
  order(1, 0, 1, 130n);
  order(1, 0, 1, 120n);
  order(1, 1, 0, 50n);
  order(1, 1, 1, 60n, { expiry: 1_000n });
  // Crossed: no midpoint.
  order(2, 0, 0, 100n);
  order(2, 0, 1, 90n);
  const mids = bookMidpoints(s, 1_000n);
  expect(mids.get(1)).toEqual({ yes: 1_100n, no: null });
  expect(mids.get(2)).toEqual({ yes: null, no: null });
  // Once the market's trading cutoff passes, nothing is live.
  expect(bookMidpoints(s, 2_000n).size).toBe(0);
});
