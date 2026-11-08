import { expect, test } from "bun:test";
import { join } from "node:path";
import { isWorldsPath } from "../src/lib/worlds/paths";
import { worldPortfolioValue } from "../src/lib/worlds/portfolio";

test("worlds pages are /worlds and everything under it", () => {
  for (const path of ["/worlds", "/worlds/me", "/worlds/new", "/worlds/live", "/worlds/12"])
    expect(isWorldsPath(path)).toBeTrue();
  for (const path of ["/", "/portfolio", "/worldsx", "/markets/1", null])
    expect(isWorldsPath(path)).toBeFalse();
});

test("a world account is worth its balance and its positions now", () => {
  expect(worldPortfolioValue({ credit: "0", positions: [] })).toBe(0);
  expect(
    worldPortfolioValue({
      credit: "1500000",
      positions: [
        { value: "2250000", minPayout: "0" },
        // Decided: its payout.
        { value: "10000000", minPayout: "0" },
        // No maker prices it now: the least it pays.
        { value: null, minPayout: "3000000" },
      ] as never,
    }),
  ).toBe(16.75);
});

// The header and its deposit dialog in a browser-like DOM, each read counted.
test("the header shows and funds the world account on worlds pages", async () => {
  const child = Bun.spawn([process.execPath, "test", "./test/fixtures/world-header.tsx"], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
}, 60_000);
