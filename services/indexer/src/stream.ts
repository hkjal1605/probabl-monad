import type { ChainState, Touched } from "@conditional-stocks/evm-client/ledger";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getAddress } from "viem";
import { marketIdentity, publicMarkets, readiness } from "./projection.ts";

export interface IndexUpdate {
  block: string;
  observedAt: number;
  markets: string[];
  owners: string[];
}

/** `marketId` maps on-chain market ids to the public ids clients key markets by. */
export const updateOf = (
  block: bigint,
  changes: Touched,
  marketId: (id: number) => string = String,
): IndexUpdate => ({
  block: block.toString(),
  observedAt: Date.now(),
  markets: [...new Set([...changes.markets].map(marketId))],
  owners: [...changes.owners],
});

/** Interval of updates while nothing changes (clients treat 10 s of silence as unhealthy). */
const HEARTBEAT_MS = 5_000;
const CAPACITY = 2_000;

/** One update as sent to every client: readiness and JSON are computed once, on first use. */
interface Frame {
  update: IndexUpdate;
  /** Readiness of every public market; null while the index is unavailable. */
  readonly readiness: Record<string, unknown> | null;
  readonly json: string | null;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** One broadcaster per process, never a polling loop per connected browser. Each update is
 * serialized once and shared by all clients; blocks that change nothing are folded into a
 * heartbeat. A subscribed wallet (`?owner=`) also receives its image whenever it changes. */
export function createIndexStream() {
  const clients = new Set<(frame: Frame) => void>();
  let state: () => ChainState = () => {
    throw new Error("Index stream is not mounted");
  };
  let lastSent = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const frame = (update: IndexUpdate): Frame => {
    let ready: Record<string, unknown> | null | undefined;
    let json: string | null | undefined;
    const value: Frame = {
      update,
      get readiness() {
        if (ready === undefined)
          try {
            const s = state();
            const checkedAt = Date.now();
            const now = BigInt(Math.floor(checkedAt / 1000));
            ready = Object.fromEntries(
              [...publicMarkets(s).values()].map((m) => [
                marketIdentity(s, m).id,
                { ...readiness(s, m, now), checkedAt, chain: "evm" },
              ]),
            );
          } catch {
            ready = null;
          }
        return ready;
      },
      get json() {
        if (json === undefined)
          json =
            value.readiness === null
              ? null
              : JSON.stringify({ ...update, readiness: value.readiness });
        return json;
      },
    };
    return value;
  };
  const current = (): IndexUpdate => {
    let block = "0";
    try {
      block = state().block.toString();
    } catch {}
    return { block, observedAt: Date.now(), markets: [], owners: [] };
  };
  const broadcast = (update: IndexUpdate) => {
    lastSent = Date.now();
    if (!clients.size) return;
    const shared = frame(update);
    for (const client of clients) client(shared);
  };

  return {
    publish(value: IndexUpdate) {
      if (!value.markets.length && !value.owners.length && Date.now() - lastSent < HEARTBEAT_MS)
        return;
      broadcast(value);
    },
    get size() {
      return clients.size;
    },
    stop() {
      clearInterval(heartbeat);
      heartbeat = undefined;
    },
    mount(
      app: Hono,
      read: () => ChainState,
      wallet: (owner: string) => Promise<{ observedAt: number } | undefined>,
    ) {
      state = read;
      heartbeat ??= setInterval(() => {
        if (clients.size && Date.now() - lastSent >= HEARTBEAT_MS) broadcast(current());
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      app.get("/stream", (c) => {
        const raw = c.req.query("owner");
        let owner: string | undefined;
        try {
          owner = raw ? getAddress(raw) : undefined;
        } catch {
          return c.json({ error: "Invalid owner" }, 400);
        }
        if (clients.size >= CAPACITY) return c.json({ error: "Stream capacity reached" }, 503);
        c.header("X-Accel-Buffering", "no");
        c.header("Cache-Control", "no-cache, no-transform");
        return streamSSE(c, async (stream) => {
          // The first message is a reset built for this client; later ones are shared frames.
          let pending: Frame | undefined = frame(current());
          // Updates a slow client missed, coalesced into the next frame it sends.
          let missed: IndexUpdate | undefined;
          let reset = true;
          let walletStamp = 0;
          let wake: (() => void) | undefined;
          const listener = (next: Frame) => {
            if (pending)
              missed = {
                ...next.update,
                markets: union((missed ?? pending.update).markets, next.update.markets),
                owners: union((missed ?? pending.update).owners, next.update.owners),
              };
            pending = next;
            wake?.();
          };
          clients.add(listener);
          stream.onAbort(() => {
            clients.delete(listener);
            wake?.();
          });
          try {
            while (!stream.aborted) {
              if (!pending) {
                await Promise.race([
                  new Promise<void>((resolve) => {
                    wake = resolve;
                  }),
                  stream.sleep(HEARTBEAT_MS * 3),
                ]);
                wake = undefined;
                continue;
              }
              const next: Frame = pending,
                coalesced = missed;
              pending = missed = undefined;
              const body =
                coalesced && next.readiness !== null
                  ? JSON.stringify({ ...coalesced, readiness: next.readiness })
                  : next.json;
              if (body === null) {
                await stream.writeSSE({ event: "unavailable", data: "{}" });
                reset = true;
                continue;
              }
              let data = body;
              const image = owner ? await wallet(owner) : undefined;
              if (image && image.observedAt !== walletStamp) {
                data = `${body.slice(0, -1)},"wallet":${JSON.stringify(image)}}`;
                walletStamp = image.observedAt;
              }
              await stream.writeSSE({
                event: reset ? "reset" : "index",
                id: next.update.block,
                data,
              });
              reset = false;
            }
          } finally {
            clients.delete(listener);
          }
        });
      });
    },
  };
}
