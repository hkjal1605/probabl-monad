import { expect, test } from "bun:test";
import { RequestPacer } from "../src/request-pacer.ts";

test("calls start in order, spaced by the rate, however many arrive at once", async () => {
  const pacer = new RequestPacer(50);
  const started: number[] = [];
  const t0 = Date.now();
  const results = await Promise.all(
    [0, 1, 2, 3, 4].map((i) =>
      pacer.run(async () => {
        started.push(Date.now() - t0);
        return i;
      }),
    ),
  );
  expect(results).toEqual([0, 1, 2, 3, 4]);
  for (let i = 1; i < started.length; i++)
    expect((started[i] ?? 0) - (started[i - 1] ?? 0)).toBeGreaterThanOrEqual(18);
});
