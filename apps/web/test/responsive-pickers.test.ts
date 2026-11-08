import { expect, test } from "bun:test";
import { join } from "node:path";

test("pickers and dialogs are popovers on a wide screen and bottom sheets on a phone", async () => {
  const child = Bun.spawn([process.execPath, "test", "./test/fixtures/responsive-pickers.tsx"], {
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
