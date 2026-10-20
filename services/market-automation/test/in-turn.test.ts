import { expect, test } from "bun:test";
import { inTurn } from "../src/in-turn.ts";

test("one account's sends run one at a time, a failure doesn't block the next, others run freely", async () => {
  const log: string[] = [];
  const send =
    (name: string, ms: number, fail = false) =>
    async () => {
      log.push(`${name}:start`);
      await Bun.sleep(ms);
      log.push(`${name}:end`);
      if (fail) throw new Error(name);
      return name;
    };
  const a = "0x00000000000000000000000000000000000000a1";
  const b = "0x00000000000000000000000000000000000000b1";
  const results = await Promise.allSettled([
    inTurn(a, send("a1", 30, true)),
    inTurn(a, send("a2", 5)),
    inTurn(b, send("b1", 5)),
  ]);
  expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  expect(log.indexOf("a2:start")).toBeGreaterThan(log.indexOf("a1:end"));
  expect(log.indexOf("b1:start")).toBeLessThan(log.indexOf("a1:end"));
});
