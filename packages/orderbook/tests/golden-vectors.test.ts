import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Branch, Side } from "@conditional-stocks/domain";

import { DeterministicMatcher, makeBookKey } from "../src/index.ts";
import { Events, hash, MARKET, order } from "./helpers.ts";

interface GoldenFixture {
  schemaVersion: number;
  vectors: Array<{
    expected: Array<{
      buyHashId: number;
      executionPriceRawX18: string;
      quantity: string;
      sellHashId: number;
    }>;
    name: string;
    orders: Array<{
      hashId: number;
      makerId: number;
      priceRawX18: string;
      quantity: string;
      side: "buy" | "sell";
    }>;
  }>;
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/price-time-vectors.json", import.meta.url), "utf8"),
) as GoldenFixture;

describe("golden price-time vectors", () => {
  for (const vector of fixture.vectors) {
    test(vector.name, () => {
      const events = new Events();
      const matcher = new DeterministicMatcher();
      for (const event of events.configure()) matcher.apply(event);
      vector.orders.forEach((item, sequence) => {
        matcher.apply(
          events.open(
            hash(item.hashId),
            BigInt(sequence),
            order(
              item.makerId,
              item.side === "buy" ? Side.Buy : Side.Sell,
              BigInt(item.priceRawX18),
              BigInt(item.quantity),
            ),
          ),
        );
      });
      const fills = matcher.preview(makeBookKey(MARKET, Branch.Yes)).proposal?.fills;
      expect(
        fills?.map((fill) => ({
          buyHashId: Number(BigInt(fill.buyOrderHash)),
          executionPriceRawX18: fill.executionPriceRawX18.toString(),
          quantity: fill.fillQuantity.toString(),
          sellHashId: Number(BigInt(fill.sellOrderHash)),
        })),
      ).toEqual(vector.expected);
    });
  }
});
