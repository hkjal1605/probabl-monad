/** The public side of world trading: the board of orders out for quotes, a wallet's own quote on
 * one, and every trade (docs/version-2-plan.md §10.2).
 *
 * - `GET /v2/worlds/board`: every open order, newest first, with its standing quotes and its
 *   world (a book's view, once per book).
 * - `GET /v2/worlds/board/stream`: the same once, then each order as it changes (a quote
 *   arrives, is replaced, taken back or runs out; the order fills, is cancelled or expires), and
 *   each trade as it confirms.
 * - `POST /v2/worlds/board/:id/quote`: the signed-in wallet's own quote on another wallet's
 *   order (a signed `WorldQuote`), standing beside the makers' for the taker to choose.
 * - `POST /v2/worlds/board/:id/withdraw`: takes it back.
 * - `GET /v2/worlds/trades`: every world fill, newest first, a page at a time.
 *
 * The board is read from memory: no RPC call and no database read. A page of trades is one
 * database read (kept two seconds, so many readers cost one); its worlds come from the
 * replica. */
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import { fillView } from "@conditional-stocks/indexer/worlds";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import type { Auth } from "../auth/routes.ts";
import { RateLimiter } from "../common/rate-limit.ts";
import { parseWorldMessage } from "../rfq/world-protocol.ts";
import type { OpenRfq, WorldRfqs } from "./rfqs.ts";

const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR = /^(\d{1,20}):(\d{1,9})$/;
const STREAMS = 2_000;
const TRADES_PAGE = 100;
/** How long a page of trades is served again without reading the database. */
const TRADES_FRESH_MS = 2_000;
/** Frames one slow reader may have waiting before the oldest give way. */
const MAX_QUEUED = 512;

type Fill = ReturnType<typeof fillView>;

export function mountWorldBoard(
  app: Hono,
  options: { indexer: WorldIndexer; auth: Auth; rfqs: WorldRfqs | null },
) {
  const { indexer, auth, rfqs } = options;
  const answer = (c: Context, body: unknown, status: 200 | 201 = 200) =>
    c.text(json(body), status, { "content-type": "application/json", "Cache-Control": "no-store" });
  /** A book's view, or null while the chain view is unavailable or the book unknown. */
  const bookOf = (id: number) => {
    try {
      return indexer.book(id) ?? null;
    } catch {
      return null;
    }
  };
  const booksOf = (ids: Iterable<number>) => [...new Set(ids)].flatMap((id) => bookOf(id) ?? []);
  /** A fill as the trades list shows it: who made it is named when it is a world vault. */
  const trade = (f: Fill) => ({
    ...f,
    vault: indexer.deployment.vaults.includes(f.maker),
  });
  const board = () => {
    const open = rfqs?.all() ?? [];
    return {
      available: Boolean(rfqs),
      now: Date.now(),
      rfqSeconds: rfqs?.options.rfqSeconds ?? null,
      /** The least lifetime a quote must have left when it arrives. */
      minQuoteSeconds: rfqs?.options.minQuoteSeconds ?? null,
      rfqs: rfqs ? open.map((r) => rfqs.publicView(r)) : [],
      books: booksOf(open.map((r) => r.order.book)),
    };
  };

  app.get("/v2/worlds/board", (c) => answer(c, board()));

  // One subscription to the requests and to the fills, however many read the stream. A frame
  // is serialized once; a reader that has not been sent the frame's book yet gets it with the
  // frame (the board it opened on carried the books of the orders open then).
  interface Frame {
    key: string;
    event: string;
    book: number;
    plain: string;
    /** The frame with its book's view (`sent` is false while the book cannot be read). */
    full(): { data: string; sent: boolean };
  }
  const readers = new Set<(frame: Frame) => void>();
  const publish = (key: string, event: string, body: Record<string, unknown>, book: number) => {
    if (!readers.size) return;
    let full: { data: string; sent: boolean } | undefined;
    const frame: Frame = {
      key,
      event,
      book,
      plain: json(body),
      full: () => {
        if (!full) {
          const view = bookOf(book);
          full = { data: json({ ...body, book: view }), sent: view !== null };
        }
        return full;
      },
    };
    for (const send of readers) send(frame);
  };
  rfqs?.watch((rfq: OpenRfq) =>
    publish(`rfq:${rfq.id}`, "rfq", { rfq: rfqs.publicView(rfq) }, rfq.order.book),
  );
  indexer.onFill((row) => {
    if (!readers.size) return;
    const f = fillView(row, "confirmed");
    publish(`trade:${f.transactionHash}:${f.logIndex}`, "trade", { trade: trade(f) }, f.book);
  });

  app.get("/v2/worlds/board/stream", (c) => {
    if (readers.size >= STREAMS) return c.json({ error: "Stream capacity reached" }, 503);
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      // A request's later frame replaces its earlier one still waiting to be written.
      const queued = new Map<string, Frame>();
      let wake: (() => void) | undefined;
      const send = (frame: Frame) => {
        queued.delete(frame.key);
        queued.set(frame.key, frame);
        if (queued.size > MAX_QUEUED) {
          const oldest = queued.keys().next().value;
          if (oldest !== undefined) queued.delete(oldest);
        }
        wake?.();
      };
      readers.add(send);
      stream.onAbort(() => wake?.());
      try {
        const first = board();
        const known = new Set(first.books.map((b) => b.id));
        await stream.writeSSE({ event: "board", data: json(first) });
        while (!stream.aborted) {
          if (!queued.size) {
            const idle = await Promise.race([
              new Promise<false>((resolve) => {
                wake = () => resolve(false);
              }),
              stream.sleep(15_000).then(() => true),
            ]);
            wake = undefined;
            if (idle && !stream.aborted) await stream.writeSSE({ event: "ping", data: "{}" });
            continue;
          }
          const batch = [...queued.values()];
          queued.clear();
          for (const frame of batch) {
            let data = frame.plain;
            if (!known.has(frame.book)) {
              const full = frame.full();
              data = full.data;
              if (full.sent) known.add(frame.book);
            }
            await stream.writeSSE({ event: frame.event, data });
          }
        }
      } finally {
        readers.delete(send);
      }
    });
  });

  // ---------------------------------------------------------------- a wallet's own quote

  const book = () => {
    if (!rfqs) throw new HTTPException(503, { message: "Requests for quotes are unavailable" });
    return rfqs;
  };
  const rfqId = (c: { req: { param(name: string): string } }) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HTTPException(400, { message: "Invalid order id" });
    return id;
  };
  // A person quotes at a human pace; each quote costs a signature recovery.
  const offers = new RateLimiter(30, 60_000);

  /** The signed-in wallet's quote on an open order of another wallet: `units`, `refund`,
   * `price`, `expiry`, `nonce` (decimal strings; a wallet's nonce is below 2^96) and its
   * `signature` of the `WorldQuote` they make with the order. It replaces the wallet's earlier
   * quote on the order. Nothing is set aside: the quote fills from the wallet's world credit if
   * the taker accepts it. */
  app.post("/v2/worlds/board/:id/quote", async (c) => {
    const { owner } = await auth.trader(c);
    const requests = book();
    offers.enforce(c, owner);
    const id = rfqId(c);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    let quote: ReturnType<typeof parseWorldMessage>;
    try {
      quote = parseWorldMessage({ ...(body ?? {}), type: "world.quote", rfqId: id });
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Invalid quote",
      });
    }
    if (quote.type !== "world.quote") throw new HTTPException(400, { message: "Invalid quote" });
    const { type: _type, rfqId: _rfq, ...terms } = quote;
    return answer(c, { rfq: requests.publicView(await requests.offer(owner, id, terms)) }, 201);
  });

  /** Takes the signed-in wallet's quote off an order. */
  app.post("/v2/worlds/board/:id/withdraw", async (c) => {
    const { owner } = await auth.trader(c);
    const requests = book();
    return answer(c, { rfq: requests.publicView(requests.retract(owner, rfqId(c))) });
  });

  // ---------------------------------------------------------------- trades

  /** Every world fill, newest first: `limit` of them (25 by default, 100 at most) after the
   * fill `before` names (`next` of the page before), each with who took and who made it, and
   * the worlds they are in. `next` is null on the last page. */
  // A page is the same for everyone for a moment: many readers cost one database read.
  const pages = new Map<string, { at: number; body: string }>();
  app.get("/v2/worlds/trades", async (c) => {
    const limit = Math.min(
      Math.max(Math.trunc(Number(c.req.query("limit")) || 25), 1),
      TRADES_PAGE,
    );
    const raw = c.req.query("before");
    const at = raw ? CURSOR.exec(raw) : null;
    const [, block, logIndex] = at ?? [];
    if (raw && (block === undefined || logIndex === undefined))
      throw new HTTPException(400, { message: "Invalid cursor" });
    const key = `${limit}:${raw ?? ""}`;
    const kept = pages.get(key);
    if (kept && Date.now() - kept.at < TRADES_FRESH_MS)
      return c.text(kept.body, 200, {
        "content-type": "application/json",
        "Cache-Control": "no-store",
      });
    const fills = await indexer.fills({
      limit: limit + 1,
      ...(block !== undefined && logIndex !== undefined
        ? { before: { block: BigInt(block), logIndex: Number(logIndex) } }
        : {}),
    });
    const page = fills.slice(0, limit);
    const last = page.at(-1);
    const body = json({
      trades: page.map(trade),
      books: booksOf(page.map((f) => f.book)),
      next: fills.length > limit && last ? `${last.block}:${last.logIndex}` : null,
    });
    if (pages.size >= 128) pages.clear();
    pages.set(key, { at: Date.now(), body });
    return c.text(body, 200, { "content-type": "application/json", "Cache-Control": "no-store" });
  });
}
