import { expect, test } from "bun:test";
import { Hono } from "hono";
import { EVENT_BATCH_SIZE, mountMarketData } from "../src/market-data/routes.ts";

const condition = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
/** Markets "a" and "b" share condition 1, "c" has condition 2 with a flipped orientation. */
const markets: Record<
  string,
  { id: bigint; condition: string; yesIndex: bigint; noIndex: bigint }
> = {
  a: { id: 1n, condition: condition(1), yesIndex: 1n, noIndex: 2n },
  b: { id: 2n, condition: condition(1), yesIndex: 1n, noIndex: 2n },
  c: { id: 3n, condition: condition(2), yesIndex: 2n, noIndex: 1n },
};

function app() {
  const reads: string[] = [];
  const server = new Hono();
  mountMarketData(server, {
    indexer: { market: (id: string) => markets[id] } as never,
    prices: {} as never,
    db: {} as never,
    events: () =>
      ({
        async metadata(conditionId: string) {
          reads.push(conditionId);
          return {
            normalized: {
              conditionId,
              source: "kalshi",
              outcomes: [
                { label: "YES", indexSet: "1" },
                { label: "NO", indexSet: "2" },
              ],
            },
          };
        },
      }) as never,
    probabilities: { get: async () => ({ quality: "valid" }) } as never,
  });
  return { server, reads };
}

test("one read returns many markets' events, each checked against its market like the single read", async () => {
  const { server, reads } = app();
  const response = await server.request("/v1/events?markets=a,b,c,missing,a");
  expect(response.status).toBe(200);
  const { events } = (await response.json()) as { events: Record<string, Record<string, unknown>> };
  expect(Object.keys(events)).toEqual(["a", "b", "c", "missing"]);
  expect(events.a).toMatchObject({
    localMarketId: "1",
    source: "kalshi",
    probability: { quality: "valid" },
  });
  expect(events.b).toMatchObject({ localMarketId: "2" });
  // A market whose orientation disagrees with its event, or that doesn't exist, says why.
  expect(events.c).toEqual({
    error: "External snapshot does not match immutable market orientation",
  });
  expect(events.missing).toEqual({ error: "Unknown market" });
  // The shared condition's metadata is read once.
  expect(reads.filter((c) => c === condition(1))).toHaveLength(1);
  // The single-market read answers as before.
  expect(await (await server.request("/v1/markets/a/event")).json()).toEqual(events.a!);
});

test("the batch takes 1 to 50 market ids", async () => {
  const { server } = app();
  expect((await server.request("/v1/events")).status).toBe(400);
  const many = Array.from({ length: EVENT_BATCH_SIZE + 1 }, (_, i) => `m${i}`).join(",");
  expect((await server.request(`/v1/events?markets=${many}`)).status).toBe(400);
});
