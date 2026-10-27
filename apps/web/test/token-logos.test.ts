import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSET_CATALOG } from "@conditional-stocks/shared/token-catalog";

const PUBLIC = join(import.meta.dir, "../public");
const TOKENS = join(PUBLIC, "tokens");

test("every catalog asset has its own bundled logo", () => {
  for (const asset of ASSET_CATALOG) {
    expect(asset.logo).toStartWith("/tokens/");
    expect(readFileSync(join(PUBLIC, asset.logo)).byteLength).toBeGreaterThan(0);
  }
  // Each stock and ETF shows its own company or fund issuer, not Robinhood's shared token logo.
  const stocks = ASSET_CATALOG.filter((a) => a.kind === "stock" || a.kind === "etf");
  expect(new Set(stocks.map((a) => a.logo)).size).toBe(stocks.length);
});

test("bundled SVG logos are plain artwork: served from the app's origin, they must not run", () => {
  const active =
    /<script|\son\w+\s*=|javascript:|<foreignObject|<iframe|<object|<embed|<image|href\s*=\s*["'](?!#)|url\((?!#)|@import/i;
  for (const file of readdirSync(TOKENS).filter((f) => f.endsWith(".svg"))) {
    const svg = readFileSync(join(TOKENS, file), "utf8");
    expect({ file, active: active.test(svg) }).toEqual({ file, active: false });
  }
});
