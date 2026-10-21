"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/services/constants";
import {
  indexHealthSnapshot,
  parseIndexUpdate,
  parseStreamWallet,
  setIndexStreamHealthy,
  subscribeIndexHealth,
} from "@/services/index-stream";
import { refreshStores, resources } from "@/stores/createResourceStore";
import { useMemberAccount, useWallet } from "./WalletProvider";

/** Prices with streams of their own. */
const OWN_STREAMS = ["spot-prices", "quote-prices", "probability"];
/** The last block a frame reported, across reconnects: a reset at the same block missed nothing. */
let lastBlock = -1n;
/** How long the stream stays healthy without a frame. The server sends one at least every 5 s,
 * but a heartbeat skipped right after a frame can leave a gap of nearly 10 s. */
const HEALTHY_FOR_MS = 15_000;
/** Whole lists ("all": every market or trade) are read again at most this often when frames
 * name their items. Any market's activity names it, so busy markets would otherwise reread the
 * whole list back to back. A single market's or wallet's read follows its frames at once. */
const LIST_REFRESH_MS = 15_000;
const listRefreshes = new Map<
  string,
  { at: number; timer?: ReturnType<typeof setTimeout> | undefined }
>();
function refreshList(id: string, refresh: () => Promise<unknown>) {
  const last = listRefreshes.get(id) ?? { at: 0 };
  listRefreshes.set(id, last);
  if (last.timer) return; // A refresh is already due; it reads whatever changed by then.
  const wait = last.at + LIST_REFRESH_MS - Date.now();
  if (wait <= 0) {
    last.at = Date.now();
    void refresh();
    return;
  }
  last.timer = setTimeout(() => {
    last.timer = undefined;
    last.at = Date.now();
    void refresh();
  }, wait);
}

const IndexStreamProvider = ({ children }: { children: ReactNode }) => {
  // A wallet's own updates ride its member session's cookie. A bearer session (an API on another
  // site) cannot ride a stream: it rereads its data when the public stream names the wallet.
  const member = useMemberAccount();
  const { sessionTransport } = useWallet();
  const account = sessionTransport === "cookie" ? member : null;
  // Bumped to reopen a stream the server closed for good (a non-200 answer, which EventSource
  // does not retry by itself).
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  useEffect(() => {
    // Whatever the stream stops covering is read again when it goes unhealthy.
    let wasHealthy = indexHealthSnapshot();
    return subscribeIndexHealth(() => {
      const healthy = indexHealthSnapshot();
      if (wasHealthy && !healthy)
        void refreshStores([...resources.keys()].filter((name) => !OWN_STREAMS.includes(name)));
      wasHealthy = healthy;
    });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` reopens the stream.
  useEffect(() => {
    const stream = new EventSource(
      apiUrl(`/stream${account ? `?owner=${encodeURIComponent(account)}` : ""}`),
      { withCredentials: account !== null },
    );
    const openedAt = Date.now();
    let block = -1n,
      stopped = false,
      retry: ReturnType<typeof setTimeout> | undefined;
    const receive = (event: MessageEvent, reset: boolean) => {
      if (stopped) return;
      try {
        const update = parseIndexUpdate(event.data);
        const at = BigInt(update.block);
        if (at < block && !reset) throw new Error("Index stream moved backwards");
        const wallet =
          update.wallet && account ? parseStreamWallet(update.wallet, account) : undefined;
        // A reset (each connection opens with one) refetches what the stream may have missed:
        // nothing if it is at the block last seen, and not data read just before it opened.
        const missed = reset && at !== lastBlock,
          first = lastBlock === -1n;
        block = at;
        lastBlock = at;
        failures.current = 0;
        setIndexStreamHealthy(Date.now() + HEALTHY_FOR_MS);
        for (const [name, resource] of resources) {
          if (OWN_STREAMS.includes(name)) continue;
          for (const [key, active] of resource.active) {
            if (name === "positions" && wallet && key === account) {
              resource.setData(key, wallet, wallet.observedAt);
              continue;
            }
            if (name === "trading-readiness") {
              const next = update.readiness[key] as { healthy?: boolean; reason?: string };
              const current = resource.get(key).data as typeof next | undefined;
              if (next && (current?.healthy !== next.healthy || current?.reason !== next.reason))
                resource.setData(key, next, update.observedAt);
              if (next) continue;
            }
            const entry = resource.get(key);
            // A read still running when a reset reports a new block may predate it: it reads
            // again when done. A finished one is skipped only on the first connection, right
            // after the page read it.
            const missedRead =
              missed && (resource.pending.has(key) || !first || entry.updatedAt < openedAt - 5_000);
            const named =
              (name === "markets" && update.markets.some((m) => key === "all" || key === m)) ||
              (["trades", "resolution"].includes(name) &&
                (key === "all" ? update.markets.length > 0 : update.markets.includes(key))) ||
              (["wallet-orders", "wallet-trades", "payout-credits", "positions"].includes(name) &&
                update.owners.includes(key));
            if (missedRead) void active.refresh();
            else if (named && key === "all") refreshList(`${name}:all`, active.refresh);
            else if (named) void active.refresh();
          }
        }
      } catch {
        setIndexStreamHealthy(0);
      }
    };
    stream.addEventListener("index", (e) => receive(e as MessageEvent, false));
    stream.addEventListener("reset", (e) => receive(e as MessageEvent, true));
    stream.addEventListener("unavailable", () => setIndexStreamHealthy(0));
    stream.onerror = () => {
      setIndexStreamHealthy(0);
      if (stream.readyState === EventSource.CLOSED && !stopped)
        retry = setTimeout(
          () => setAttempt((n) => n + 1),
          Math.min(30_000, 2_000 * 2 ** failures.current++),
        );
    };
    return () => {
      stopped = true;
      clearTimeout(retry);
      // Closed only to reopen (a new wallet or a retry): the next stream's reset rereads what it
      // missed, and health lapses by itself if none follows. Marking it unhealthy here would
      // reread every resource on each account switch.
      stream.close();
    };
  }, [account, attempt]);
  return children;
};

export { IndexStreamProvider };
export default IndexStreamProvider;
