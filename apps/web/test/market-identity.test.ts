import { expect, test } from "bun:test";
import { marketPath, publicIdOf } from "../src/lib/markets/identity";

test("market paths are chain-independent: a readable slug over the public id", () => {
  expect(marketPath({ id: "00000000000000a1", slug: "nvda-00000000000000a1" })).toBe(
    "/markets/nvda-00000000000000a1",
  );
  expect(marketPath({ id: "00000000000000a1" })).toBe("/markets/00000000000000a1");
});

test("a URL segment names a public id; numeric on-chain ids are left for the API to resolve", () => {
  expect(publicIdOf("nvda-00000000000000a1")).toBe("00000000000000a1");
  expect(publicIdOf("00000000000000A1")).toBe("00000000000000a1");
  expect(publicIdOf(`0x${"ab".repeat(8)}${"00".repeat(24)}`)).toBe("abababababababab");
  expect(publicIdOf("brk.b-00000000000000a1")).toBe("00000000000000a1");
  expect(publicIdOf("12")).toBeNull();
  expect(publicIdOf("not-a-market")).toBeNull();
  expect(publicIdOf("%E0%A4%A")).toBeNull();
});
