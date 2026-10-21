import { expect, test } from "bun:test";
import { API_URL } from "../src/services/constants";
import { subscribeProbability } from "../src/services/probability-stream";

test("a page's conditions share one API SSE connection; new ones get their own, and streams close when unused", async () => {
  const original = globalThis.EventSource;
  const sources: FakeSource[] = [];
  class FakeSource extends EventTarget {
    closed = false;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      super();
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  globalThis.EventSource = FakeSource as unknown as typeof EventSource;
  const a = `0x${"11".repeat(32)}`,
    b = `0x${"22".repeat(32)}`;
  const tick = (condition: string, midpointX6: string) =>
    new MessageEvent("probability", {
      data: JSON.stringify({
        topic: `probability.${condition}`,
        value: {
          conditionId: condition,
          quality: "valid",
          midpointX6,
          bestBidX6: String(Number(midpointX6) - 10_000),
          bestAskX6: String(Number(midpointX6) + 10_000),
          observedAtMs: String(Date.now()),
        },
      }),
    });
  const received: Record<string, number[]> = { a: [], b: [] };
  const statuses: string[] = [];
  const stops: Array<() => void> = [];
  try {
    const into = (key: string) => (value: { value: number | null }) => {
      if (value.value !== null) received[key]!.push(value.value);
    };
    // The cards of a page subscribe together: one stream serves them all.
    stops.push(subscribeProbability(a, into("a"), () => {}));
    stops.push(subscribeProbability(a, into("a"), () => {}));
    stops.push(subscribeProbability(b, into("b"), (s) => statuses.push(s)));
    await Promise.resolve();
    expect(sources).toHaveLength(1);
    const first = sources[0]!;
    expect(first.url).toBe(`${API_URL}/v1/probabilities/stream?conditions=${a},${b}`);
    first.dispatchEvent(tick(a, "280000"));
    first.dispatchEvent(tick(b, "610000"));
    expect(received).toEqual({ a: [0.28, 0.28], b: [0.61] });
    first.dispatchEvent(
      new MessageEvent("unavailable", { data: JSON.stringify({ conditionId: b }) }),
    );
    expect(statuses.at(-1)).toBe("reconnecting");
    // a's cards unmount: b keeps the stream it shares, nothing reopens.
    stops.shift()?.();
    stops.shift()?.();
    await Promise.resolve();
    expect(first.closed).toBe(false);
    expect(sources).toHaveLength(1);
    // A new card's condition gets a stream of its own; the shared one stays as it is.
    const c = `0x${"33".repeat(32)}`;
    stops.push(
      subscribeProbability(
        c,
        () => {},
        () => {},
      ),
    );
    await Promise.resolve();
    expect(sources).toHaveLength(2);
    expect(sources[1]!.url).toBe(`${API_URL}/v1/probabilities/stream?conditions=${c}`);
    // The last subscribers leave: every stream closes.
    stops.shift()?.();
    stops.shift()?.();
    await Promise.resolve();
    expect(sources.every((source) => source.closed)).toBe(true);
  } finally {
    for (const stop of stops) stop();
    await Promise.resolve();
    globalThis.EventSource = original;
  }
});
