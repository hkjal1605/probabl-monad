import { expect, test } from "bun:test";
import { Hono } from "hono";
import { mountMarketData, PROBABILITY_BATCH_SIZE } from "../src/market-data/routes.ts";

const A = `0x${"aa".repeat(32)}`,
  B = `0x${"bb".repeat(32)}`;

function app() {
  const reads: string[] = [];
  const server = new Hono();
  mountMarketData(server, {
    indexer: {} as never,
    prices: {} as never,
    events: () => ({}) as never,
    db: {} as never,
    probabilities: {
      async get(condition: string) {
        reads.push(condition);
        if (condition === B) throw new Error("Probability is not currently valid");
        return { conditionId: condition, quality: "valid", isStale: false };
      },
    } as never,
  });
  return { server, reads };
}

/** The stream's first `count` events, as [event, data]. */
async function events(response: Response, count: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No stream body");
  const decoder = new TextDecoder();
  let text = "";
  const parsed = () =>
    text
      .split("\n\n")
      .filter((frame) => frame.includes("data:"))
      .map((frame) => [
        /event: (.*)/.exec(frame)?.[1] ?? "",
        JSON.parse(/data: (.*)/.exec(frame)?.[1] ?? "null"),
      ]);
  while (parsed().length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  await reader.cancel();
  return parsed().slice(0, count);
}

test("one stream serves a page's conditions: each one's probability, or unavailable", async () => {
  const { server, reads } = app();
  const response = await server.request(`/v1/probabilities/stream?conditions=${A},${B},${A}`);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(await events(response, 2)).toEqual([
    [
      "probability",
      { topic: `probability.${A}`, value: { conditionId: A, quality: "valid", isStale: false } },
    ],
    ["unavailable", { conditionId: B }],
  ]);
  // Duplicates are read once.
  expect(reads).toEqual([A, B]);
});

test("the shared stream takes 1 to 50 valid conditions; the per-condition stream still works", async () => {
  const { server } = app();
  for (const query of ["", "conditions=", "conditions=0x12", `conditions=${A},nope`])
    expect((await server.request(`/v1/probabilities/stream?${query}`)).status).toBe(400);
  const many = Array.from(
    { length: PROBABILITY_BATCH_SIZE + 1 },
    (_, i) => `0x${i.toString(16).padStart(64, "0")}`,
  );
  expect((await server.request(`/v1/probabilities/stream?conditions=${many}`)).status).toBe(400);
  const single = await server.request(`/v1/probabilities/${A}/stream`);
  expect((await events(single, 1))[0]?.[0]).toBe("probability");
});
