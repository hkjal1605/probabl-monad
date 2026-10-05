import { expect, test } from "bun:test";
import { join } from "node:path";

test("signing keeps the operator console mounted, and a failed network check closes it", async () => {
  // A separate process: the fixture renders into its own DOM and mocks modules globally.
  const child = Bun.spawn([process.execPath, "test", "./test/fixtures/admin-provider.tsx"], {
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
}, 30_000);
