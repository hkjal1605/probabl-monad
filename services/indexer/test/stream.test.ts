import { expect, test } from "bun:test";
import { emptyState } from "@conditional-stocks/evm-client/ledger";
import { Hono } from "hono";
import { type Address, getAddress } from "viem";
import { createIndexStream } from "../src/stream.ts";

const owner = getAddress("0x00000000000000000000000000000000000000bb");

/** Reads server-sent events from a response body as they arrive. */
function events(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A read outlives a timed-out wait: the next wait resumes it instead of losing its chunk.
  let reading: ReturnType<typeof reader.read> | undefined;
  return async (timeoutMs = 1_000) => {
    const until = Date.now() + timeoutMs;
    while (!buffer.includes("\n\n")) {
      reading ??= reader.read();
      const chunk = await Promise.race([
        reading,
        Bun.sleep(Math.max(0, until - Date.now())).then(() => null),
      ]);
      if (!chunk) return null;
      reading = undefined;
      if (chunk.done) return null;
      buffer += decoder.decode(chunk.value);
    }
    const end = buffer.indexOf("\n\n");
    const text = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const field = (name: string) =>
      text
        .split("\n")
        .find((line) => line.startsWith(`${name}: `))
        ?.slice(name.length + 2);
    return { event: field("event"), data: JSON.parse(field("data") ?? "null") };
  };
}

test("shares one frame per update, folds idle blocks into heartbeats and sends wallets on change", async () => {
  const s = emptyState(getAddress("0x00000000000000000000000000000000000000a1"));
  s.block = 7n;
  let reads = 0;
  let stamp = 1;
  const stream = createIndexStream();
  const app = new Hono();
  stream.mount(
    app,
    () => {
      reads++;
      return s;
    },
    async (wallet) => ({ owner: wallet as Address, observedAt: stamp }),
  );
  try {
    const clients = await Promise.all(
      [`/stream?owner=${owner}`, "/stream", "/stream"].map(async (path) =>
        events(await app.request(path)),
      ),
    );
    const [mine, ...others] = clients;
    const first = await mine!();
    expect(first).toMatchObject({
      event: "reset",
      data: { block: "7", wallet: { observedAt: 1 } },
    });
    for (const other of others) expect((await other!())?.event).toBe("reset");

    // A block that changed nothing, right after another update: folded into the heartbeat.
    reads = 0;
    const idle = { block: "8", observedAt: Date.now(), markets: [], owners: [] };
    stream.publish({ ...idle, markets: ["00000000000000aa"] });
    stream.publish(idle);
    const next = await mine!();
    expect(next).toMatchObject({ event: "index", data: { block: "8" } });
    expect(next!.data.markets).toEqual(["00000000000000aa"]);
    // Unchanged wallet image: not resent.
    expect(next!.data.wallet).toBeUndefined();
    for (const other of others) expect((await other!())?.data.block).toBe("8");
    // The frame was built once for all three clients.
    expect(reads).toBe(1);
    expect(await mine!(300)).toBeNull();

    // A changed image is sent with the next update.
    stamp = 2;
    stream.publish({ ...idle, block: "9", owners: [owner] });
    expect((await mine!())?.data.wallet).toMatchObject({ observedAt: 2 });
  } finally {
    stream.stop();
  }
});
