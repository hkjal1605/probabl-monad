import { expect, test } from "bun:test";
import { conditionalPositionRows, positionGroups } from "../src/lib/portfolio/positions";
import { fixtureMarkets, fixtureState } from "./fixtures/protocol";

const e18 = (n: number) => `${BigInt(n) * 10n ** 18n}`;
const market = (id: string, question: string) => ({ ...fixtureMarkets[0]!, id, question });
const position = (marketId: string, held: Partial<Record<string, string>>) => ({
  ...fixtureState.positions[0]!,
  marketId,
  ...{ quoteYes: "0", quoteNo: "0", baseYes: "0", baseNo: "0" },
  ...held,
});
const markets = [
  market("a", "Alpha?"),
  market("b", "Bravo?"),
  market("c", "Charlie?"),
  market("d", "Delta?"),
  market("e", "Echo?"),
];
const positions = [
  // NO at a 217.40 midpoint.
  position("a", { baseNo: e18(1) }),
  // YES at a 254.80 midpoint, beside a cash claim.
  position("b", { baseYes: e18(2), quoteNo: "10000000" }),
  // Cash claims only.
  position("c", { quoteYes: "5000000", quoteNo: "7000000" }),
  position("d", { quoteYes: "1000000" }),
  // Nothing held: no group.
  position("e", {}),
];

test("positions group by market, the one on screen first, then the largest by value", () => {
  const groups = positionGroups(conditionalPositionRows(markets, positions, []), "c");
  expect(
    groups.map((g) => [
      g.market.id,
      g.stock.map((row) => row.branch),
      g.cash.map((row) => row.branch),
      Math.round(g.value * 100) / 100,
    ]),
  ).toEqual([
    ["c", [], [0, 1], 0],
    ["b", [0], [1], 509.6],
    ["a", [1], [], 217.4],
    ["d", [], [0], 0],
  ]);
  // With none on screen, equal values fall back to the question.
  expect(
    positionGroups(conditionalPositionRows(markets, positions, []), undefined).map(
      (g) => g.market.id,
    ),
  ).toEqual(["b", "a", "c", "d"]);
});
