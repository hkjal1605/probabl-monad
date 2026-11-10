/** The world vault on the API's RFQ stream (protocol version 2): one WebSocket with the vault's
 * approved key. Every `world.rfq` is priced from memory (`WorldKeeper.price`) and answered at
 * once with a quote signed by the keeper (its nonce names the vault, so `WorldBooks` asks the
 * vault's hook to accept the fill), or declined straight away so it never holds a window open.
 * Market orders of the exchange (version 1) are declined. While connected, the vault posts its
 * indications every `indicationMs`, at most 12 books a frame. It also prices worlds not
 * created yet (`world.preview`), from memory, without signing.
 *
 * An open request (`open: true`) is answered just as fast, with a quote that lives minutes
 * (`quotes.openTtlSeconds`) so its taker can choose it. Each second (`review`, after the model
 * refresh) a quote that ran out unaccepted is followed by a fresh one, and so is one the price
 * moved against (the new quote replaces it); one the vault could not give at all any more is
 * withdrawn with `decline`. The vault gives each ask `quotes.openQuotes` quotes of its own
 * accord (two: the first and one more), so a request its taker never means to fill does not
 * hold the vault's capacity for the request's whole life. Asked again (the request repeats),
 * it quotes afresh. When the stream closes the API drops the vault's standing quotes, and so
 * does the keeper.
 *
 * An open request the vault cannot see well enough to price when it arrives (its models are
 * not built yet just after a start, when the API sends every open request at once; or its
 * references or chain view are down) is kept and answered as soon as it can, until the request
 * ends. A quote withdrawn for the same reason is given again the same way. */
import { type Address, getAddress, type Hex, isAddress } from "viem";
import {
  PRICE_MOVED,
  type PreviewBook,
  QUOTE_EXPIRED,
  type WorldKeeper,
  type WorldOrderRequest,
} from "./engine.ts";

export interface RfqSocket {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  send(data: string): void;
  close(): void;
}
type Message = Record<string, unknown>;
const MAX_BACKOFF_MS = 30_000;
/** Books per `world.indications` frame: each carries its products and analytics. */
const BOOKS_PER_FRAME = 12;
/** Why the vault had no price that say nothing of the order: it could not see. An open request
 * declined (or a quote withdrawn) for one of these is answered once the vault sees again. */
const UNSIGHTED = new Set([
  "Not ready",
  "The book is not quoted",
  "Chain view unavailable",
  "The vault is not followed",
]);
/** Open requests kept to answer later. */
const MAX_WAITING = 1_000;

export class WorldRfqMaker {
  private socket: RfqSocket | undefined;
  private stopped = false;
  private retryMs = 1_000;
  private minQuoteSeconds = 3;
  private ready = false;
  private indicating: ReturnType<typeof setInterval> | undefined;
  /** The open requests the vault quotes or waits to quote, as asked, until they end. */
  private readonly requests = new Map<string, Message>();
  /** Those it could not price when asked, to answer once it can. */
  private readonly waiting = new Set<string>();
  /** The quotes the vault gave each since it was last asked. */
  private readonly given = new Map<string, number>();

  constructor(
    private readonly options: {
      keeper: WorldKeeper;
      url: string;
      apiKey: string;
      chainId: number;
      indicationMs: number;
      /** Whether to sign (live) or log and decline (dry run). */
      live: boolean;
      connect?: (url: string, apiKey: string) => RfqSocket;
      log: (event: string, detail?: Record<string, unknown>) => void;
    },
  ) {}

  start() {
    if (this.stopped) return;
    const { url, apiKey } = this.options;
    const socket =
      this.options.connect?.(url, apiKey) ??
      (new WebSocket(url, {
        headers: { authorization: `Bearer ${apiKey}` },
      } as never) as unknown as RfqSocket);
    this.socket = socket;
    socket.onmessage = (event) => {
      let message: Message;
      try {
        message = JSON.parse(String(event.data)) as Message;
      } catch {
        return;
      }
      void this.receive(message).catch((error) =>
        this.options.log("rfq-error", { reason: (error as Error).message }),
      );
    };
    socket.onclose = (event) => {
      this.ready = false;
      if (this.socket === socket) this.socket = undefined;
      // The API drops a maker's standing quotes with its connection: they fill no more. It
      // sends the open requests again on the next one.
      this.options.keeper.dropStanding();
      this.requests.clear();
      this.waiting.clear();
      this.given.clear();
      if (this.stopped) return;
      if (event?.code === 4001) {
        this.options.log("rfq-key-revoked");
        return;
      }
      const delay = this.retryMs;
      this.retryMs = Math.min(delay * 2, MAX_BACKOFF_MS);
      setTimeout(() => this.start(), event?.code === 4003 ? 250 : delay);
    };
  }

  stop() {
    this.stopped = true;
    clearInterval(this.indicating);
    this.socket?.close();
  }

  private send(message: object) {
    this.socket?.send(
      JSON.stringify(message, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  }

  /** Handles one frame (exposed for tests). */
  async receive(m: Message) {
    const k = this.options.keeper;
    if (m.type === "welcome") {
      const maker = m.maker as { wallet?: string; worlds?: boolean } | undefined;
      const worlds = m.worlds as { books?: string; vaults?: string[] } | undefined;
      const books = k.options.follower.confirmed.deployment.books;
      if (
        !maker?.wallet ||
        getAddress(maker.wallet) !== k.vault ||
        m.chainId !== this.options.chainId ||
        !worlds?.books ||
        getAddress(worlds.books) !== books ||
        !(worlds.vaults ?? []).some((v) => getAddress(v) === k.vault)
      ) {
        this.options.log("rfq-misconfigured", {
          reason: "The API key or stream is not this world vault's",
        });
        this.stop();
        return;
      }
      if (typeof m.minQuoteSeconds === "number") this.minQuoteSeconds = m.minQuoteSeconds;
      this.ready = true;
      this.retryMs = 1_000;
      this.options.log("rfq-connected", { minQuoteSeconds: this.minQuoteSeconds });
      this.indicate();
      if (!this.indicating) {
        this.indicating = setInterval(() => this.indicate(), this.options.indicationMs);
        this.indicating.unref?.();
      }
      return;
    }
    if (m.type === "rfq") {
      // The exchange's market orders are the Δ-vaults'.
      this.send({ type: "decline", rfqId: m.id });
      return;
    }
    if (m.type === "world.rfq") {
      // An ask (the first, or the taker asking again) starts the count of quotes over.
      if (typeof m.id === "string") this.given.delete(m.id);
      return this.respond(m);
    }
    if (m.type === "world.preview") return this.previewed(m);
    if (m.type === "world.result" && typeof m.rfqId === "string") {
      this.forget(m.rfqId);
      k.outcome(m.rfqId, String(m.outcome));
      if (m.outcome !== "lost")
        this.options.log("rfq-result", { rfq: m.rfqId, outcome: m.outcome });
      return;
    }
    // The taker turned the vault's quote down: its capacity is free at once, and the vault
    // quotes the request again only if it is asked again.
    if (m.type === "world.declined" && typeof m.rfqId === "string") {
      k.withdraw(m.rfqId);
      this.forget(m.rfqId);
      this.options.log("rfq-quote-declined", { rfq: m.rfqId });
      return;
    }
    // An open request ended: nothing is left to quote or wait for (a quote of the vault's on
    // it has its own `world.result`).
    if (m.type === "world.closed" && typeof m.rfqId === "string") return this.forget(m.rfqId);
    if (m.type === "quote.rejected" && typeof m.rfqId === "string") {
      // A refused quote never fills: its capacity is free at once (not at its expiry, minutes
      // away on an open request), and nothing of the vault's stands on the request.
      this.forget(m.rfqId);
      k.outcome(m.rfqId, "rejected");
      this.options.log("rfq-quote-rejected", { rfq: m.rfqId, reason: m.reason });
    }
  }

  /** Looks at the vault's standing quotes again (`WorldKeeper.review`): one that ran out
   * unaccepted, or that the price moved against, is followed by a fresh quote while its
   * request is open; one the vault cannot give any more is withdrawn. Then answers the open
   * requests it was waiting to price. Returns how many quotes no longer stood. */
  review() {
    if (!this.ready) return 0;
    const k = this.options.keeper;
    const stale = k.review();
    const now = Date.now();
    // What the vault gives one ask of its own accord: past it, it waits to be asked again.
    const spent = (id: string) => (this.given.get(id) ?? 0) >= k.options.settings.quotes.openQuotes;
    for (const { id, reason } of stale) {
      const m = this.requests.get(id);
      const open = m !== undefined && Number(m.quoteDeadline) - now > this.minQuoteSeconds * 1000;
      if (open && !spent(id) && (reason === QUOTE_EXPIRED || reason === PRICE_MOVED)) {
        // The answer replaces the earlier quote at the API, or withdraws it if the vault
        // cannot price the request now.
        this.options.log("rfq-requoting", { rfq: id, reason });
        void this.respond(m).catch((error) =>
          this.options.log("rfq-error", { reason: (error as Error).message }),
        );
        continue;
      }
      // Declining a request the vault quoted withdraws its quote (one that ran out is gone).
      if (reason !== QUOTE_EXPIRED) {
        this.send({ type: "decline", rfqId: id });
        this.options.log("rfq-withdrawn", { rfq: id, reason });
      } else if (open) this.options.log("rfq-quotes-spent", { rfq: id, given: this.given.get(id) });
      k.withdraw(id);
      if (open && !spent(id) && UNSIGHTED.has(reason)) this.waiting.add(id);
      else this.forget(id);
    }
    for (const id of [...this.waiting]) {
      const m = this.requests.get(id);
      if (!m || Number(m.quoteDeadline) <= now) {
        this.forget(id);
        continue;
      }
      // Answered once the vault sees again: its chain view is healthy and the book modelled
      // (the answer may still put the request back to wait).
      if (
        !k.options.follower.health().healthy ||
        !k.model(Number((m.book as { id?: unknown } | undefined)?.id))
      )
        continue;
      this.waiting.delete(id);
      void this.respond(m).catch((error) =>
        this.options.log("rfq-error", { reason: (error as Error).message }),
      );
    }
    return stale.length;
  }

  private forget(id: string) {
    this.requests.delete(id);
    this.waiting.delete(id);
    this.given.delete(id);
  }
  /** Open requests waiting for the vault to be able to price them. */
  get waitingRequests() {
    return this.waiting.size;
  }

  /** Posts the vault's current indications (none while disconnected). */
  indicate() {
    if (!this.ready) return;
    const books = this.options.keeper.indications(this.minQuoteSeconds);
    for (let i = 0; i < books.length; i += BOOKS_PER_FRAME)
      this.send({ type: "world.indications", books: books.slice(i, i + BOOKS_PER_FRAME) });
  }

  /** Answers a preview of a world not created yet (`world.preview`) from memory. */
  previewed(m: Message) {
    const id = typeof m.id === "string" ? m.id : "";
    if (!id) return;
    const answer = (body: Record<string, unknown>) =>
      this.send({ type: "world.previewed", id, ...body });
    if (!this.ready) return answer({ decline: "Not ready" });
    let book: PreviewBook, stakes: { allIn: bigint; moneyBack: bigint };
    try {
      book = previewBook(m.book);
      const raw = (m.stakes ?? {}) as Record<string, unknown>;
      stakes = { allIn: BigInt(String(raw.allIn)), moneyBack: BigInt(String(raw.moneyBack)) };
      if (stakes.allIn <= 0n || stakes.moneyBack <= 0n) throw new Error();
    } catch {
      return answer({ decline: "Malformed preview" });
    }
    const started = performance.now();
    const result = this.options.keeper.preview(book, stakes, this.minQuoteSeconds);
    answer(result as Record<string, unknown>);
    this.options.log("previewed", {
      legs: book.legs.length,
      priced: book.feed !== ZERO,
      decline: "decline" in result ? result.decline : null,
      declined:
        "products" in result
          ? Object.fromEntries(
              result.products.filter((p) => p.decline).map((p) => [p.key, p.decline]),
            )
          : undefined,
      ms: Math.round((performance.now() - started) * 100) / 100,
    });
  }

  private async respond(m: Message) {
    const started = performance.now();
    const k = this.options.keeper;
    const id = String(m.id);
    // An open request's taker chooses among the standing quotes: its quote lives minutes.
    const open = m.open === true;
    const decline = (reason: string, logged = true) => {
      this.send({ type: "decline", rfqId: id });
      // An open request the vault could not see to price is answered once it can.
      if (open && UNSIGHTED.has(reason) && this.requests.size < MAX_WAITING) {
        this.requests.set(id, m);
        this.waiting.add(id);
      } else this.forget(id);
      if (logged) this.options.log("rfq-declined", { rfq: id, reason });
    };
    if (!this.ready) return decline("Not ready", false);
    const signing = m.signing as { domain?: Record<string, unknown> } | undefined;
    const d = signing?.domain;
    const books = k.options.follower.confirmed.deployment.books;
    if (
      !d ||
      d.name !== "Probabl Worlds" ||
      d.version !== "1" ||
      d.chainId !== this.options.chainId ||
      typeof d.verifyingContract !== "string" ||
      getAddress(d.verifyingContract) !== books
    )
      return decline("Malformed request");
    const o = m.order as Record<string, unknown> | undefined;
    const book = Number((m.book as { id?: unknown } | undefined)?.id);
    let order: WorldOrderRequest;
    try {
      if (!o) throw new Error();
      order = {
        taker: getAddress(String(o.taker)),
        book,
        mask: Number(o.mask),
        side: o.side === "sell" ? "sell" : "buy",
        units: o.units === null || o.units === undefined ? null : BigInt(String(o.units)),
        refund: BigInt(String(o.refund ?? "0")),
        stake: o.stake === null || o.stake === undefined ? null : BigInt(String(o.stake)),
        conditional: o.conditional === true,
        limit: BigInt(String(o.limit ?? "0")),
      };
      if (!Number.isSafeInteger(order.book) || !Number.isInteger(order.mask)) throw new Error();
    } catch {
      return decline("Malformed request");
    }
    // Asked again, the vault's earlier quote on the request goes: the new one replaces it.
    k.withdraw(id);
    const priced = k.price(order, this.minQuoteSeconds, undefined, open);
    if ("decline" in priced) return decline(priced.decline);
    if (!this.options.live) {
      this.options.log("rfq-dry-run", {
        rfq: id,
        book,
        price: priced.quote.price,
        units: priced.quote.units,
      });
      return decline("Dry run", false);
    }
    let signed: Awaited<ReturnType<WorldKeeper["sign"]>>;
    try {
      signed = await k.sign(id, priced, open);
    } catch (error) {
      return decline((error as Error).message);
    }
    const q = signed.quote;
    if (open && this.requests.size < MAX_WAITING) {
      this.requests.set(id, m);
      this.given.set(id, (this.given.get(id) ?? 0) + 1);
    }
    this.waiting.delete(id);
    this.send({
      type: "world.quote",
      rfqId: id,
      units: q.units,
      refund: q.refund,
      price: q.price,
      expiry: q.expiry,
      makerData: q.makerData,
      nonce: q.nonce,
      signature: signed.signature,
    });
    this.options.log("rfq-quoted", {
      rfq: id,
      book,
      open,
      ttl: Number(q.expiry) - Math.floor(Date.now() / 1000),
      side: order.side,
      units: q.units,
      refund: q.refund,
      price: q.price,
      fair: Math.round(priced.fair),
      markupBps: Math.round(priced.markup * 10_000),
      components: Object.fromEntries(
        Object.entries(priced.components).map(([key, v]) => [key, Math.round(v)]),
      ),
      ms: Math.round((performance.now() - started) * 100) / 100,
    });
  }
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
/** A `world.preview` book, checked field by field (the API built it, but a frame is data). */
export function previewBook(value: unknown): PreviewBook {
  const b = (value ?? {}) as Record<string, unknown>;
  const fail = (what: string): never => {
    throw new Error(`Invalid preview ${what}`);
  };
  if (!Array.isArray(b.legs) || b.legs.length < 1 || b.legs.length > 6) fail("legs");
  const legs = (b.legs as Record<string, unknown>[]).map((l) => {
    if (typeof l.eventKey !== "string" || !HEX32.test(l.eventKey)) fail("eventKey");
    if (typeof l.conditionId !== "string" || !HEX32.test(l.conditionId)) fail("conditionId");
    if (l.source !== "polymarket" && l.source !== "kalshi") fail("source");
    const r = l.reference as Record<string, unknown> | null | undefined;
    const reference =
      r && typeof r.yes === "number" && typeof r.halfSpread === "number"
        ? {
            yes: r.yes,
            halfSpread: r.halfSpread,
            observedAtMs: Number(r.observedAtMs) || 0,
          }
        : null;
    return {
      eventKey: (l.eventKey as string).toLowerCase(),
      wantYes: l.wantYes !== false,
      source: l.source as "polymarket" | "kalshi",
      marketId: String(l.marketId ?? ""),
      conditionId: (l.conditionId as string).toLowerCase(),
      yesIndex: Number(l.yesIndex),
      noIndex: Number(l.noIndex),
      question: String(l.question ?? ""),
      url: String(l.url ?? ""),
      endTime: String(l.endTime ?? ""),
      themes: Array.isArray(l.themes) ? (l.themes as unknown[]).map(String).slice(0, 8) : [],
      reference,
    };
  });
  if (typeof b.feed !== "string" || !isAddress(b.feed)) fail("feed");
  const feed = getAddress(b.feed as string);
  const strikes = Array.isArray(b.strikes)
    ? (b.strikes as unknown[]).map((k) => BigInt(String(k)))
    : [];
  const int = (v: unknown, name: string) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) fail(name);
    return n;
  };
  return {
    legs,
    feed,
    underlying: typeof b.underlying === "string" ? b.underlying : null,
    feedDecimals:
      b.feedDecimals === null || b.feedDecimals === undefined
        ? null
        : int(b.feedDecimals, "feedDecimals"),
    fixingTime: int(b.fixingTime ?? 0, "fixingTime"),
    cutoff: int(b.cutoff, "cutoff"),
    maxStaleness: int(b.maxStaleness ?? 0, "maxStaleness"),
    strikes,
    feeBps: int(b.feeBps, "feeBps"),
    spot: typeof b.spot === "number" && b.spot > 0 ? b.spot : null,
  } as PreviewBook & { legs: { eventKey: Hex }[] };
}
