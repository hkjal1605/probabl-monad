import { expect, test } from "bun:test";
import { join } from "node:path";

// The world ticket's order flow (Place, the quotes board, accept, decline, cancel, running out) in
// a browser-like DOM, each API call counted.
test("a world order is placed, quoted and settled from the ticket", async () => {
  const child = Bun.spawn([process.execPath, "test", "./test/fixtures/world-rfq.tsx"], {
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
}, 120_000);
