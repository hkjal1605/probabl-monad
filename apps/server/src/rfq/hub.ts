/** Connected RFQ makers and the requests open to them, in one API process.
 *
 * A request goes to every approved maker with a live connection (except the order's own owner)
 * and stays open for the quote window, or until every recipient has quoted or declined, so a
 * fully answered request never waits out the window, and with no maker online `collect` returns
 * at once without a timer. Each quote is checked as it arrives and the maker hears whether it
 * stands; a later quote from the same maker replaces its earlier one. Makers also post their
 * current prices for a standard order (`indications`), which `prices` combines across them. */
import type { Address } from "viem";
import {
  type MakerIdentity,
  type MakerIndication,
  type MakerMessage,
  type MakerQuote,
  parseMakerMessage,
  RFQ_PROTOCOL_VERSION,
} from "./protocol.ts";

/** One maker connection. `send` returns false when the socket could not take the frame. */
export interface RfqSession {
  readonly maker: MakerIdentity;
  send(message: object): boolean;
  close(code: number, reason: string): void;
}
export interface CollectedQuote {
  maker: MakerIdentity;
  terms: MakerQuote;
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
export type QuoteCheck = (
  maker: MakerIdentity,
  terms: MakerQuote,
) => string | null | Promise<string | null>;
interface Pending {
  open: boolean;
  recipients: Set<string>;
  done: Set<string>;
  quotes: Map<string, CollectedQuote>;
  attempts: Map<string, number>;
  validate: QuoteCheck;
  finish(): void;
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
/** Quotes a maker may send per request, replacements included. */
const MAX_ATTEMPTS = 5;

export class RfqHub {
  private readonly sessions = new Map<string, Set<RfqSession>>();
  private readonly pending = new Map<string, Pending>();
  private readonly counters = new Map<string, MakerStats>();
  /** Each maker's latest indications and when they arrived. */
  private readonly indications = new Map<string, { at: number; prices: MakerIndication[] }>();
  private arrivals = 0;

  constructor(
    readonly options: {
      /** How long a request stays open for quotes. */
      windowMs: number;
      /** Live connections allowed per API key. */
      maxSessionsPerMaker: number;
      /** What makers learn on connecting (the settlement delegate, the chain). */
      welcome: () => Record<string, unknown>;
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
      ...this.options.welcome(),
    });
    return true;
  }

  detach(session: RfqSession) {
    const id = session.maker.id;
    const live = this.sessions.get(id);
    if (!live?.delete(session)) return;
    if (live.size) return;
    this.sessions.delete(id);
    this.indications.delete(id);
    // A maker gone mid-request cannot answer it: the request stops waiting for it.
    for (const p of this.pending.values()) if (p.recipients.has(id)) this.answered(p, id);
  }

  /** Closes every connection of a maker (its key was revoked). */
  disconnect(makerId: string, reason = "API key revoked") {
    for (const session of [...(this.sessions.get(makerId) ?? [])]) {
      session.close(CLOSE_REVOKED, reason);
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

  /** Distinct makers online, leaving out `excluding` (the order's owner never quotes itself). */
  makers(excluding?: Address) {
    let count = 0;
    for (const [, live] of this.sessions) {
      const first = live.values().next().value;
      if (first && first.maker.wallet !== excluding) count++;
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

  /** Counts a quote that won part of an order. */
  awarded(makerId: string) {
    this.stats(makerId).awards++;
  }

  /** Sends to every connection of a maker. */
  notify(makerId: string, message: object) {
    for (const session of this.sessions.get(makerId) ?? []) session.send(message);
  }

  /** Broadcasts `request` and resolves with the standing quotes, in arrival order. */
  collect(input: {
    id: string;
    request: object;
    exclude?: Address;
    validate: QuoteCheck;
  }): Promise<CollectedQuote[]> {
    const recipients = [...this.sessions.entries()].filter(([, live]) => {
      const first = live.values().next().value;
      return first !== undefined && first.maker.wallet !== input.exclude;
    });
    if (!recipients.length) return Promise.resolve([]);
    return new Promise((resolve) => {
      const p: Pending = {
        open: true,
        recipients: new Set(recipients.map(([id]) => id)),
        done: new Set(),
        quotes: new Map(),
        attempts: new Map(),
        validate: input.validate,
        finish: () => {
          if (!p.open) return;
          p.open = false;
          clearTimeout(timer);
          this.pending.delete(input.id);
          resolve([...p.quotes.values()].sort((a, b) => a.arrival - b.arrival));
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
    const maker = session.maker,
      p = this.pending.get(message.rfqId);
    if (!p?.recipients.has(maker.id)) {
      if (message.type === "quote")
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
      p.quotes.delete(maker.id);
      this.answered(p, maker.id);
      return;
    }
    const attempts = (p.attempts.get(maker.id) ?? 0) + 1;
    p.attempts.set(maker.id, attempts);
    const rfqId = message.rfqId;
    const terms: MakerQuote = {
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
    if (attempts > MAX_ATTEMPTS) return reject(`At most ${MAX_ATTEMPTS} quotes per request`);
    const settle = (reason: string | null) => {
      if (!p.open) return reject("The request closed before the quote was checked");
      if (reason) return reject(reason);
      // A later quote of the same maker, checked sooner, stands.
      const held = p.quotes.get(maker.id);
      if (held && held.arrival > quote.arrival) return;
      stats.quotes++;
      p.quotes.set(maker.id, quote);
      session.send({ type: "quote.accepted", rfqId });
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
    p.done.add(makerId);
    if (p.done.size >= p.recipients.size) p.finish();
  }
}
