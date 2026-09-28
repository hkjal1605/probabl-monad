import type { ChainState, Touched } from "@conditional-stocks/evm-client/ledger";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getAddress } from "viem";
import { readiness } from "./projection.ts";

export interface IndexUpdate {
  block: string;
  observedAt: number;
  markets: string[];
  owners: string[];
}

export const updateOf = (block: bigint, changes: Touched): IndexUpdate => ({
  block: block.toString(),
  observedAt: Date.now(),
  markets: [...changes.markets].map(String),
  owners: [...changes.owners],
});

/** One broadcaster per process, never a polling loop per connected browser. A subscribed
 * wallet (`?owner=`) also receives its image whenever it changes. */
export function createIndexStream() {
  const listeners = new Set<(value: IndexUpdate) => void>();
  return {
    publish(value: IndexUpdate) {
      for (const listener of listeners) listener(value);
    },
    get size() {
      return listeners.size;
    },
    mount(
      app: Hono,
      state: () => ChainState,
      wallet: (owner: string, changed: boolean) => Promise<{ observedAt: number } | undefined>,
    ) {
      app.get("/stream", (c) => {
        const raw = c.req.query("owner");
        let owner: string | undefined;
        try {
          owner = raw ? getAddress(raw) : undefined;
        } catch {
          return c.json({ error: "Invalid owner" }, 400);
        }
        if (listeners.size >= 2000) return c.json({ error: "Stream capacity reached" }, 503);
        c.header("X-Accel-Buffering", "no");
        c.header("Cache-Control", "no-cache, no-transform");
        return streamSSE(c, async (stream) => {
          let pending: IndexUpdate | undefined;
          let reset = true;
          let walletStamp = 0;
          let wake: (() => void) | undefined;
          const listener = (value: IndexUpdate) => {
            // Slow clients get one coalesced invalidation set, not every intermediate block.
            pending = pending
              ? {
                  ...value,
                  markets: [...new Set([...pending.markets, ...value.markets])],
                  owners: [...new Set([...pending.owners, ...value.owners])],
                }
              : value;
            wake?.();
          };
          listeners.add(listener);
          stream.onAbort(() => {
            listeners.delete(listener);
          });
          try {
            while (!stream.aborted) {
              try {
                const s = state();
                const changed = Boolean(owner && (reset || pending?.owners.includes(owner)));
                const image = owner ? await wallet(owner, changed) : undefined;
                const value = {
                  ...(pending ?? {
                    block: s.block.toString(),
                    observedAt: Date.now(),
                    markets: [],
                    owners: [],
                  }),
                  wallet: image && image.observedAt !== walletStamp ? image : undefined,
                  readiness: Object.fromEntries(
                    [...s.markets.values()].map((m) => [
                      String(m.id),
                      { ...readiness(s, m), checkedAt: Date.now(), chain: "evm" },
                    ]),
                  ),
                };
                walletStamp = image?.observedAt ?? walletStamp;
                pending = undefined;
                await stream.writeSSE({
                  event: reset ? "reset" : "index",
                  id: s.block.toString(),
                  data: JSON.stringify(value),
                });
                reset = false;
              } catch {
                await stream.writeSSE({ event: "unavailable", data: "{}" });
                reset = true;
                await stream.sleep(1000);
                continue;
              }
              await Promise.race([
                new Promise<void>((resolve) => {
                  wake = resolve;
                  if (pending) resolve();
                }),
                stream.sleep(15_000),
              ]);
              wake = undefined;
            }
          } finally {
            listeners.delete(listener);
          }
        });
      });
    },
  };
}
