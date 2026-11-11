/** Connected RFQ makers and the requests open to them, in one API process.
 *
 * A request goes to every approved maker with a live connection (except the order's own owner)
 * and stays open for the quote window, or until every recipient has quoted or declined, so a
 * fully answered request never waits out the window, and with no maker online `collect` returns
 * at once without a timer. Each quote is checked as it arrives and the maker hears whether it
 * stands; a later quote from the same maker replaces its earlier one. Makers also post their
 * current prices for a standard order (`indications`), which `prices` combines across them.
 *
 * A standing request (`open`: a world order out for quotes) is not decided by a window. It
 * stays open until its owner closes it; meanwhile any maker approved for its kind quotes it,
 * replaces its quote, or withdraws it with `decline`. A maker that connects later receives every
 * standing request, and one whose last connection drops takes its quotes with it (it can no
 * longer withdraw them). The window only bounds how long the owner waits for the first answers
 * (`firstRound`, and each `ask` after it). */
import type { Address } from "viem";
import {
  type MakerIdentity,
  type MakerIndication,
  type MakerMessage,
  type MakerQuote,
  parseMakerMessage,
  RFQ_PROTOCOL_VERSION,
} from "./protocol.ts";
import type {
  WorldAnalytics,
  WorldIndication,
  WorldMakerQuote,
  WorldPreviewAnswer,
} from "./world-protocol.ts";

/** One maker connection. `send` returns false when the socket could not take the frame. */
export interface RfqSession {
  readonly maker: MakerIdentity;
  send(message: object): boolean;
  close(code: number, reason: string): void;
}
export interface CollectedQuote<T = MakerQuote> {
  maker: MakerIdentity;
  terms: T;
  /** When it arrived (ms since the epoch); its place in arrival order breaks price ties. */
  receivedAt: number;
  arrival: number;
}
export interface MakerStats {
  requests: number;
  quotes: number;
  declines: number;
  rejections: number;
  awards: number;
}
/** Why a quote cannot stand (a signature check makes it asynchronous), or null. */
export type QuoteCheck<T = MakerQuote> = (
  maker: MakerIdentity,
  terms: T,
) => string | null | Promise<string | null>;
/** A request's kind: a market order of the exchange, or a world order (version 2). */
export type RequestKind = "market" | "world";
/** Why a standing quote left its request other than by the request closing: its maker
 * withdrew it, or went offline. */
export type QuoteWithdrawal = "withdrawn" | "offline";
/** A request that stays open until `close`. */
export interface OpenRequest<T = MakerQuote> {
  /** Settles once every maker the request first went to has answered, or the window passed. */
  firstRound: Promise<void>;
  /** The standing quotes, in arrival order. */
  quotes(): CollectedQuote<T>[];
  /** Sends the request again to the makers online that hold no quote on it; settles like
   * `firstRound`. */
  ask(): Promise<void>;
  /** Forgets a maker's standing quote (it expired or no longer fills), so the maker is asked
   * again. */
  drop(makerId: string): void;
  /** Ends the request: later quotes are refused. */
  close(): void;
}
interface Pending {
  kind: RequestKind;
  open: boolean;
  /** The makers this round waits for. */
  recipients: Set<string>;
  done: Set<string>;
  quotes: Map<string, CollectedQuote<unknown>>;
  attempts: Map<string, number>;
  validate: QuoteCheck<unknown>;
  /** Ends the round (and a request that is not standing). */
  finish(): void;
  /** A standing request's own. */
  standing: {
    request(replay: boolean): object;
    exclude: Address | undefined;
    onQuote(quote: CollectedQuote<unknown>, replaced: CollectedQuote<unknown> | null): void;
    onWithdrawn(quote: CollectedQuote<unknown>, why: QuoteWithdrawal): void;
  } | null;
}
/** The best indicative prices of one world book across the makers online: each product's
 * highest bid and lowest ask, and the newest maker's atom marks. */
export interface WorldBookPrices {
  products: Map<string, { bid: number | null; ask: number | null; at: number }>;
  marks: number[] | null;
  /** The newest maker's analytics (the chance chain, the stock in the world). */
  analytics: WorldAnalytics | null;
  at: number;
}

/** The best indicative prices of one market branch across the makers online. */
export interface QuotePrice extends MakerIndication {
  /** When the newest of them arrived (ms since the epoch). */
  at: number;
}
/** How long a maker's indications stand without an update (its keeper posts them every round). */
export const INDICATION_TTL_MS = 30_000;

/** Close codes (4000-4999 are the application's). */
export const CLOSE_REVOKED = 4001;
export const CLOSE_LIMIT = 4002;
/** The maker's approval changed: reconnect to pick it up. */
export const CLOSE_RECONNECT = 4003;
/** Quotes a maker may send per request, replacements included. */
const MAX_ATTEMPTS = 5;
/** The same for a standing request, which a maker quotes again as its quotes run out or the
 * price moves. */
const MAX_STANDING_ATTEMPTS = 256;
/** Standing requests a connecting maker receives per burst, and the pause between bursts: a
 * long list never fills a connection's send buffer. */
const REPLAY_BURST = 25;
const REPLAY_PAUSE_MS = 20;

export class RfqHub {
  private readonly sessions = new Map<string, Set<RfqSession>>();
  private readonly pending = new Map<string, Pending>();
  private readonly counters = new Map<string, MakerStats>();
  /** Each maker's latest indications and when they arrived. */
  private readonly indications = new Map<string, { at: number; prices: MakerIndication[] }>();
  /** Each world maker's latest indications per book, and when each arrived. */
  private readonly worldIndications = new Map<
    string,
    Map<number, WorldIndication & { at: number }>
  >();
  private arrivals = 0;
  /** Previews in flight: the first priced answer wins; every maker declining ends it too. */
  private readonly previews = new Map<
    string,
    {
      recipients: Set<string>;
      declines: Map<string, WorldPreviewAnswer>;
      finish(answer: WorldPreviewAnswer | null): void;
    }
  >();

  constructor(
    readonly options: {
      /** How long a request stays open for quotes. */
      windowMs: number;
      /** Live connections allowed per API key. */
      maxSessionsPerMaker: number;
      /** What makers learn on connecting (the settlement delegate, the chain, and for makers
       * approved for worlds the world signing domain). */
      welcome: (maker: MakerIdentity) => Record<string, unknown>;
      now?: () => number;
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private stats(makerId: string) {
    let s = this.counters.get(makerId);
    if (!s) {
      s = { requests: 0, quotes: 0, declines: 0, rejections: 0, awards: 0 };
      this.counters.set(makerId, s);
    }
    return s;
  }

  /** Registers a new connection; false (and closed) when its key has too many. */
  attach(session: RfqSession) {
    const id = session.maker.id;
    const live = this.sessions.get(id) ?? new Set<RfqSession>();
    if (live.size >= this.options.maxSessionsPerMaker) {
      session.close(CLOSE_LIMIT, "Too many connections for this API key");
      return false;
    }
    live.add(session);
    this.sessions.set(id, live);
    session.send({
      type: "welcome",
      version: RFQ_PROTOCOL_VERSION,
      maker: session.maker,
      quoteWindowMs: this.options.windowMs,
      ...this.options.welcome(session.maker),
    });
    this.replay(session);
    return true;
  }

  /** Whether `maker` may quote a request of `kind` that `exclude` owns. */
  private eligible(maker: MakerIdentity, kind: RequestKind, exclude?: Address) {
    return maker.wallet !== exclude && (kind === "market" || maker.worlds === true);
  }

  /** Sends a maker that just connected every standing request it holds no quote on, oldest
   * first, in bursts. */
  private replay(session: RfqSession) {
    const maker = session.maker;
    const ids = [...this.pending.entries()]
      .filter(([, p]) => p.standing && this.eligible(maker, p.kind, p.standing.exclude))
      .map(([id]) => id);
    if (!ids.length) return;
    const burst = () => {
      if (!this.sessions.get(maker.id)?.has(session)) return;
      for (const id of ids.splice(0, REPLAY_BURST)) {
        const p = this.pending.get(id);
        if (!p?.open || !p.standing || p.quotes.has(maker.id)) continue;
        this.stats(maker.id).requests++;
        if (!session.send(p.standing.request(true))) return;
      }
      if (ids.length) setTimeout(burst, REPLAY_PAUSE_MS);
    };
    burst();
  }

  detach(session: RfqSession) {
    const id = session.maker.id;
    const live = this.sessions.get(id);
    if (!live?.delete(session)) return;
    if (live.size) return;
    this.sessions.delete(id);
    this.indications.delete(id);
    this.worldIndications.delete(id);
    for (const p of [...this.pending.values()]) {
      // A maker gone offline cannot withdraw a standing quote: it goes with the maker.
      const held = p.standing ? p.quotes.get(id) : undefined;
      if (held) {
        p.quotes.delete(id);
        p.standing?.onWithdrawn(held, "offline");
      }
      // A maker gone mid-request cannot answer it: the request stops waiting for it.
      if (p.recipients.has(id)) this.answered(p, id);
    }
  }

  /** Closes every connection of a maker (its key was revoked). */
  disconnect(makerId: string, reason = "API key revoked", code = CLOSE_REVOKED) {
    for (const session of [...(this.sessions.get(makerId) ?? [])]) {
      session.close(code, reason);
      this.detach(session);
    }
  }

  /** Closes every connection (the process is stopping); makers reconnect to the next one. */
  closeAll() {
    for (const live of [...this.sessions.values()])
      for (const session of [...live]) {
        session.close(1001, "Server restarting");
        this.detach(session);
      }
  }

  /** Distinct makers online, leaving out `excluding` (the order's owner never quotes itself);
   * for world orders, only the makers approved for worlds. */
  makers(excluding?: Address, kind: RequestKind = "market") {
    let count = 0;
    for (const [, live] of this.sessions) {
      const first = live.values().next().value;
      if (first && first.maker.wallet !== excluding && (kind === "market" || first.maker.worlds))
        count++;
    }
    return count;
  }

  /** Connections and counters per maker id, for the admin console. */
  status(makerId: string) {
    return { connections: this.sessions.get(makerId)?.size ?? 0, ...this.stats(makerId) };
  }

  /** The best indicative bid and ask of every market branch: the highest bid and lowest ask of
   * the makers online whose indications are under `INDICATION_TTL_MS` old. */
  prices(): QuotePrice[] {
    const now = this.now(),
      best = new Map<string, QuotePrice>();
    for (const [, { at, prices }] of this.indications) {
      if (now - at > INDICATION_TTL_MS) continue;
      for (const p of prices) {
        const key = `${p.market}:${p.branch}`;
        const b = best.get(key) ?? { market: p.market, branch: p.branch, bid: null, ask: null, at };
        if (p.bid !== null && (b.bid === null || p.bid > b.bid)) b.bid = p.bid;
        if (p.ask !== null && (b.ask === null || p.ask < b.ask)) b.ask = p.ask;
        b.at = Math.max(b.at, at);
        best.set(key, b);
      }
    }
    return [...best.values()].sort((a, b) => a.market - b.market || a.branch - b.branch);
  }

  /** Every world book's best indications across the makers online (under the TTL). */
  worldPrices(): Map<number, WorldBookPrices> {
    const now = this.now(),
      best = new Map<number, WorldBookPrices>();
    for (const [, books] of this.worldIndications)
      for (const [book, ind] of books) {
        if (now - ind.at > INDICATION_TTL_MS) continue;
        const b = best.get(book) ?? { products: new Map(), marks: null, analytics: null, at: 0 };
        for (const p of ind.products) {
          const q = b.products.get(p.key) ?? { bid: null, ask: null, at: ind.at };
          if (p.bid !== null && (q.bid === null || p.bid > q.bid)) q.bid = p.bid;
          if (p.ask !== null && (q.ask === null || p.ask < q.ask)) q.ask = p.ask;
          q.at = Math.max(q.at, ind.at);
          b.products.set(p.key, q);
        }
        if (ind.marks && ind.at >= b.at) b.marks = ind.marks;
        if (ind.analytics && ind.at >= b.at) b.analytics = ind.analytics;
        b.at = Math.max(b.at, ind.at);
        best.set(book, b);
      }
    return best;
  }

  /** Counts a quote that won part of an order. */
  awarded(makerId: string) {
    this.stats(makerId).awards++;
  }

  /** Sends to every connection of a maker. */
  notify(makerId: string, message: object) {
    for (const session of this.sessions.get(makerId) ?? []) session.send(message);
  }

  /** Sends to every maker online that may quote requests of `kind` (never `exclude`). */
  broadcast(kind: RequestKind, message: object, exclude?: Address) {
    for (const live of this.sessions.values())
      for (const session of live)
        if (this.eligible(session.maker, kind, exclude)) session.send(message);
  }

  /** Broadcasts `request` and resolves with the standing quotes, in arrival order. A world
   * request (`kind: "world"`) goes only to the makers approved for worlds. */
  collect<T = MakerQuote>(input: {
    id: string;
    request: object;
    exclude?: Address;
    kind?: RequestKind;
    validate: QuoteCheck<T>;
  }): Promise<CollectedQuote<T>[]> {
    const kind = input.kind ?? "market";
    const recipients = [...this.sessions.entries()].filter(([, live]) => {
      const first = live.values().next().value;
      return (
        first !== undefined &&
        first.maker.wallet !== input.exclude &&
        (kind === "market" || first.maker.worlds === true)
      );
    });
    if (!recipients.length) return Promise.resolve([]);
    return new Promise((resolve) => {
      const p: Pending = {
        kind,
        open: true,
        recipients: new Set(recipients.map(([id]) => id)),
        done: new Set(),
        quotes: new Map(),
        attempts: new Map(),
        validate: input.validate as QuoteCheck<unknown>,
        standing: null,
        finish: () => {
          if (!p.open) return;
          p.open = false;
          clearTimeout(timer);
          this.pending.delete(input.id);
          resolve(
            [...p.quotes.values()].sort((a, b) => a.arrival - b.arrival) as CollectedQuote<T>[],
          );
        },
      };
      const timer = setTimeout(p.finish, this.options.windowMs);
      this.pending.set(input.id, p);
      for (const [id, live] of recipients) {
        this.stats(id).requests++;
        let delivered = false;
        for (const session of live) delivered = session.send(input.request) || delivered;
        if (!delivered) this.answered(p, id);
      }
    });
  }

  /** Opens a standing request: `request(false)` goes to every eligible maker online now, and
   * `request(true)` to each that connects later or is asked again. Every quote that stands is
   * reported (`onQuote`, with the one it replaced), and every one that leaves before `close`
   * (`onWithdrawn`). With no maker online the first round settles at once. */
  open<T = MakerQuote>(input: {
    id: string;
    kind: RequestKind;
    request(replay: boolean): object;
    exclude?: Address;
    validate: QuoteCheck<T>;
    onQuote(quote: CollectedQuote<T>, replaced: CollectedQuote<T> | null): void;
    onWithdrawn(quote: CollectedQuote<T>, why: QuoteWithdrawal): void;
  }): OpenRequest<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle: (() => void) | undefined;
    const p: Pending = {
      kind: input.kind,
      open: true,
      recipients: new Set(),
      done: new Set(),
      quotes: new Map(),
      attempts: new Map(),
      validate: input.validate as QuoteCheck<unknown>,
      standing: {
        request: input.request,
        exclude: input.exclude,
        onQuote: input.onQuote as never,
        onWithdrawn: input.onWithdrawn as never,
      },
      finish: () => {
        clearTimeout(timer);
        timer = undefined;
        p.recipients = new Set();
        p.done = new Set();
        settle?.();
        settle = undefined;
      },
    };
    /** One round: the request to the eligible makers online that hold no quote on it. */
    const round = (replay: boolean) => {
      // A round still waiting ends here: its makers are asked again with the rest.
      p.finish();
      if (!p.open) return Promise.resolve();
      const recipients = [...this.sessions.entries()].filter(([id, live]) => {
        const first = live.values().next().value;
        return (
          first !== undefined &&
          !p.quotes.has(id) &&
          this.eligible(first.maker, p.kind, input.exclude)
        );
      });
      if (!recipients.length) return Promise.resolve();
      return new Promise<void>((resolve) => {
        settle = resolve;
        p.recipients = new Set(recipients.map(([id]) => id));
        timer = setTimeout(p.finish, this.options.windowMs);
        const frame = input.request(replay);
        for (const [id, live] of recipients) {
          this.stats(id).requests++;
          let delivered = false;
          for (const session of live) delivered = session.send(frame) || delivered;
          if (!delivered) this.answered(p, id);
        }
      });
    };
    this.pending.set(input.id, p);
    return {
      firstRound: round(false),
      quotes: () =>
        [...p.quotes.values()].sort((a, b) => a.arrival - b.arrival) as CollectedQuote<T>[],
      ask: () => round(true),
      drop: (makerId) => void p.quotes.delete(makerId),
      close: () => {
        if (!p.open) return;
        p.open = false;
        this.pending.delete(input.id);
        p.finish();
      },
    };
  }

  /** Asks the makers approved for worlds to price a world not created yet (`world.preview`).
   * Resolves with the first priced answer, or when every maker declined with the first
   * decline, or null when none answered within `timeoutMs`. Nothing is signed. */
  preview(id: string, request: object, timeoutMs: number): Promise<WorldPreviewAnswer | null> {
    const recipients = [...this.sessions.entries()].filter(
      ([, live]) => live.values().next().value?.maker.worlds === true,
    );
    if (!recipients.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      const entry = {
        recipients: new Set(recipients.map(([makerId]) => makerId)),
        declines: new Map<string, WorldPreviewAnswer>(),
        finish: (answer: WorldPreviewAnswer | null) => {
          if (!this.previews.has(id)) return;
          this.previews.delete(id);
          clearTimeout(timer);
          resolve(answer);
        },
      };
      const timer = setTimeout(
        () => entry.finish(entry.declines.values().next().value ?? null),
        timeoutMs,
      );
      this.previews.set(id, entry);
      for (const [makerId, live] of recipients) {
        let delivered = false;
        for (const session of live) delivered = session.send(request) || delivered;
        if (!delivered) entry.recipients.delete(makerId);
      }
      if (!entry.recipients.size) entry.finish(null);
    });
  }

  /** Handles one frame from a maker connection. */
  receive(session: RfqSession, text: string) {
    let message: MakerMessage;
    try {
      message = parseMakerMessage(text);
    } catch (error) {
      session.send({ type: "error", message: (error as Error).message });
      return;
    }
    if (message.type === "ping") {
      session.send({ type: "pong", id: message.id, time: this.now() });
      return;
    }
    if (message.type === "indications") {
      this.indications.set(session.maker.id, { at: this.now(), prices: message.prices });
      return;
    }
    if (message.type === "world.previewed") {
      const entry = this.previews.get(message.id);
      if (!entry?.recipients.has(session.maker.id)) return;
      const { type: _, id: __, ...answer } = message;
      if (answer.decline === null) return entry.finish(answer);
      entry.declines.set(session.maker.id, answer);
      if (entry.declines.size >= entry.recipients.size)
        entry.finish(entry.declines.values().next().value ?? null);
      return;
    }
    if (message.type === "world.indications") {
      if (!session.maker.worlds) {
        session.send({ type: "error", message: "This API key is not approved for worlds" });
        return;
      }
      const at = this.now();
      const books = this.worldIndications.get(session.maker.id) ?? new Map();
      for (const b of message.books) books.set(b.book, { ...b, at });
      // A maker's books beyond the TTL are dropped, so its map never outgrows what it quotes.
      for (const [book, ind] of books) if (at - ind.at > INDICATION_TTL_MS) books.delete(book);
      this.worldIndications.set(session.maker.id, books);
      return;
    }
    const maker = session.maker,
      p = this.pending.get(message.rfqId);
    // A standing request is any eligible maker's to quote; another only its recipients'.
    const asked =
      p &&
      (p.standing ? this.eligible(maker, p.kind, p.standing.exclude) : p.recipients.has(maker.id));
    if (!p || !asked) {
      if (message.type === "quote" || message.type === "world.quote")
        session.send({
          type: "quote.rejected",
          rfqId: message.rfqId,
          reason: "The request is closed or was not sent to this maker",
        });
      return;
    }
    const stats = this.stats(maker.id);
    if (message.type === "decline") {
      stats.declines++;
      // Declining after a quote withdraws it.
      const held = p.quotes.get(maker.id);
      p.quotes.delete(maker.id);
      if (held) p.standing?.onWithdrawn(held, "withdrawn");
      this.answered(p, maker.id);
      return;
    }
    const attempts = (p.attempts.get(maker.id) ?? 0) + 1;
    p.attempts.set(maker.id, attempts);
    const rfqId = message.rfqId;
    if ((message.type === "world.quote") !== (p.kind === "world")) {
      stats.rejections++;
      session.send({
        type: "quote.rejected",
        rfqId,
        reason:
          p.kind === "world" ? "Answer a world request with world.quote" : "Answer with quote",
      });
      return;
    }
    const terms: MakerQuote | WorldMakerQuote =
      message.type === "world.quote"
        ? {
            units: message.units,
            refund: message.refund,
            price: message.price,
            expiry: message.expiry,
            makerData: message.makerData,
            nonce: message.nonce,
            signature: message.signature,
          }
        : {
            price: message.price,
            quantity: message.quantity,
            fundingKind: message.fundingKind,
            expiry: message.expiry,
            nonce: message.nonce,
            signature: message.signature,
          };
    const quote = { maker, terms, receivedAt: this.now(), arrival: ++this.arrivals };
    const reject = (reason: string) => {
      stats.rejections++;
      session.send({ type: "quote.rejected", rfqId, reason });
    };
    const most = p.standing ? MAX_STANDING_ATTEMPTS : MAX_ATTEMPTS;
    if (attempts > most) return reject(`At most ${most} quotes per request`);
    const settle = (reason: string | null) => {
      if (!p.open) return reject("The request closed before the quote was checked");
      if (reason) return reject(reason);
      // A later quote of the same maker, checked sooner, stands.
      const held = p.quotes.get(maker.id);
      if (held && held.arrival > quote.arrival) return;
      stats.quotes++;
      p.quotes.set(maker.id, quote);
      session.send({ type: "quote.accepted", rfqId });
      p.standing?.onQuote(quote, held ?? null);
      this.answered(p, maker.id);
    };
    let check: ReturnType<QuoteCheck>;
    try {
      check = p.validate(maker, terms);
    } catch (error) {
      return reject((error as Error).message);
    }
    if (check instanceof Promise)
      check.then(settle, (error: Error) => settle(error.message || "Invalid quote"));
    else settle(check);
  }

  private answered(p: Pending, makerId: string) {
    // A standing request between rounds waits for nobody.
    if (!p.recipients.has(makerId)) return;
    p.done.add(makerId);
    if (p.done.size >= p.recipients.size) p.finish();
  }
}
