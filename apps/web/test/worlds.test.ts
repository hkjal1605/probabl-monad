/** Worlds as people read them: chances as plain percents (never "1 in X"), payouts with
 * their multiple, venue questions as labels, and the offer a preview or a live world makes at a
 * stake: what each ending pays and how likely it is. The sentence renders as one line of text. */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorldSentence } from "../src/components/worlds/Sentence";
import {
  chancePercent,
  legLabel,
  midSentence,
  money,
  multiple,
  venueResult,
} from "../src/lib/worlds/format";
import { atStake, bookOffers, outcomeAtoms, previewOffers } from "../src/lib/worlds/offer";
import type { BookView } from "../src/lib/worlds/types";

describe("numbers", () => {
  test("chances are percents: whole in the middle, a tenth near the ends, never a false 0 or 100", () => {
    expect(chancePercent(270_400)).toBe("27%");
    expect(chancePercent(30_000)).toBe("3%");
    expect(chancePercent(57_300)).toBe("5.7%");
    expect(chancePercent(913_000)).toBe("91.3%");
    expect(chancePercent(4_000)).toBe("0.4%");
    expect(chancePercent(400)).toBe("<0.1%");
    expect(chancePercent(999_700)).toBe(">99.9%");
    expect(chancePercent(0)).toBe("0%");
    expect(chancePercent(1_000_000)).toBe("100%");
    expect(chancePercent(null)).toBe("—");
  });
  test("money and multiples", () => {
    expect(money(1538)).toBe("$1,538");
    expect(money(20.2, { cents: true })).toBe("$20.20");
    expect(multiple(1538, 20)).toBe("77×");
    expect(multiple(250, 100)).toBe("2.5×");
    expect(multiple(0, 20)).toBe("—");
  });
  test("labels and results", () => {
    expect(legLabel("Will the Fed cut rates in December?")).toBe("The Fed cut rates in December");
    expect(legLabel("Will CPI be above 3% in November?")).toBe("CPI is above 3% in November");
    expect(midSentence("The Fed cut rates")).toBe("the Fed cut rates");
    expect(midSentence("US–China trade deal")).toBe("US–China trade deal");
    expect(venueResult("yes")).toBe("happened");
    expect(venueResult("no")).toBe("didn't happen");
    expect(venueResult("open")).toBeNull();
  });
});

describe("offers", () => {
  // The world fails (972), happens below $240 (18), happens above (10), per thousand.
  const marks = [972_000, 18_000, 10_000];
  const [allIn, moneyBack] = previewOffers(
    [
      {
        key: "bet:above:1",
        name: "All-in",
        stake: "20000000",
        units: "1538000000",
        payout: "1538000000",
        ask: 13_000,
        decline: null,
        endings: [],
      },
      {
        key: "cond:above:1",
        name: "Money-back",
        stake: "100000000",
        units: "250000000",
        payout: "250000000",
        ask: 400_000,
        decline: null,
        endings: [],
      },
    ],
    marks,
    100,
    true,
  );

  test("each ending pays what the product holds in it", () => {
    expect(allIn!.payout).toBe(1538);
    expect(allIn!.win).toBe(10_000);
    expect(allIn!.endings.map((e) => [e.key, e.chance, e.pays])).toEqual([
      ["win", 10_000, 1538],
      ["lose-in-world", 18_000, 0],
      ["world-fails", 972_000, 0],
    ]);
    // Money-back gives the stake back when the world fails.
    expect(moneyBack!.endings.at(-1)).toEqual({ key: "world-fails", chance: 972_000, pays: 100 });
    // Fair value at the marks, and the books' 1% fee on the price.
    expect(allIn!.fair).toBeCloseTo(15.38, 6);
    expect(moneyBack!.fair).toBeCloseTo(2.5 + 97.2, 6);
    expect(moneyBack!.fee).toBe(1);
  });

  test("a stake rescales the offer", () => {
    const fifty = atStake(allIn!, 50);
    expect(fifty.payout).toBeCloseTo(3845, 6);
    expect(fifty.fee).toBeCloseTo(0.5, 9);
  });

  test("a live world's offer from its indications; a product without an ask is not offered", () => {
    const book = {
      eventOnly: false,
      tradable: true,
      atoms: 3,
      feeBps: 100,
      marks,
      products: [
        {
          key: "bet:above:1",
          kind: "world-bet",
          outcome: { kind: "above", strike: 1 },
          mask: 4,
          bid: null,
          ask: 13_000,
        },
        {
          key: "cond:above:1",
          kind: "conditional",
          outcome: { kind: "above", strike: 1 },
          mask: 4,
          bid: null,
          ask: null,
        },
      ],
    } as unknown as BookView;
    const [a, m] = bookOffers(book, { allIn: 20, moneyBack: 100 }, "above");
    expect(a!.payout).toBeCloseTo(20 / 0.013, 6);
    expect(m!.decline).toBe("Not offered for this world right now");
    expect(outcomeAtoms({ kind: "below", strike: 1 }, 3)).toEqual([1]);
    expect(outcomeAtoms({ kind: "world" }, 2)).toEqual([1]);
  });
});

test("the sentence: events as chips, then the stock's side, price and date", () => {
  const html = renderToStaticMarkup(
    createElement(WorldSentence, {
      world: {
        legs: [
          { label: "The Fed cut rates in December", wantYes: true },
          { label: "The US government shut down", wantYes: false },
        ],
        stock: { symbol: "NVDA", direction: "above", strike: "220", date: "2026-12-03" },
      },
    }),
  );
  const text = html.replace(/<[^>]+>/g, "");
  expect(text).toBe(
    "If the Fed cut rates in December and NOthe US government shut down, NVDA closes above $220 on Thu, Dec 3",
  );
});
