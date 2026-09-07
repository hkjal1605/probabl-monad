import { expect, test } from "bun:test";
import { assertNoModeSwitch, beginModeSwitch } from "@/lib/demo/navigation";

test("mode-changing navigation blocks subsequent wallet operations in the old document", () => {
  expect(() => assertNoModeSwitch()).not.toThrow();
  beginModeSwitch();
  expect(() => assertNoModeSwitch()).toThrow("Application mode is changing");
});
