/** A world's events, as its sentence edits them: the list holds the events chosen and nothing
 * else, so one event is a whole world and no blank ever waits beside chosen events. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { addEvent, chosenEvent, MAX_EVENTS, removeEvent, setEvent } from "../src/lib/worlds/events";
import type { LegEntry } from "../src/lib/worlds/types";

const entry = (id: string): LegEntry => ({
  id,
  source: "polymarket",
  marketId: id,
  question: `Will ${id} happen?`,
  label: `${id} happens`,
  event: id,
  outcome: null,
  yes: 0.4,
  bid: 0.39,
  ask: 0.41,
  endTime: "2026-12-31T00:00:00Z",
  url: "https://polymarket.com",
  image: null,
  rules: "",
  exclusive: false,
  group: id,
  volume: 1,
  themes: [],
});
const ids = (legs: { entry: LegEntry }[]) => legs.map((l) => l.entry.id);

test("an event removed is taken out of the list; the last one leaves it empty", () => {
  const legs = [chosenEvent(entry("a")), chosenEvent(entry("b")), chosenEvent(entry("c"))];
  expect(ids(removeEvent(legs, 1))).toEqual(["a", "c"]);
  expect(ids(removeEvent(removeEvent(legs, 0), 0))).toEqual(["c"]);
  expect(removeEvent([chosenEvent(entry("a"))], 0)).toEqual([]);
});

test("an event picked with none chosen is the first; otherwise it changes the one in its place", () => {
  const picked = chosenEvent(entry("x"));
  expect(ids(setEvent([], 0, picked))).toEqual(["x"]);
  const legs = [chosenEvent(entry("a")), chosenEvent(entry("b"))];
  expect(ids(setEvent(legs, 1, picked))).toEqual(["a", "x"]);
  // The side an event needs is a change in place too.
  const no = { ...(legs[0] as (typeof legs)[number]), wantYes: false };
  expect(setEvent(legs, 0, no).map((l) => l.wantYes)).toEqual([false, true]);
});

test("an event added joins the end: never twice, never past what a world takes", () => {
  expect(ids(addEvent([], entry("a")))).toEqual(["a"]);
  const two = addEvent(addEvent([], entry("a")), entry("b"));
  expect(ids(two)).toEqual(["a", "b"]);
  expect(ids(addEvent(two, entry("a")))).toEqual(["a", "b"]);
  const full = ["a", "b", "c", "d"].map((id) => chosenEvent(entry(id)));
  expect(full).toHaveLength(MAX_EVENTS);
  expect(ids(addEvent(full, entry("e")))).toEqual(["a", "b", "c", "d"]);
  // A new event starts as "it happens".
  expect(addEvent([], entry("a"))[0]?.wantYes).toBeTrue();
});

test("the worlds page's sentence follows these rules through every state", async () => {
  const child = Bun.spawn([process.execPath, "test", "./test/fixtures/world-events.tsx"], {
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
