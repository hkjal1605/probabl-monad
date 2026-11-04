/** The world vault on the API's RFQ stream (protocol version 2): one WebSocket with the vault's
 * approved key. Every `world.rfq` is priced from memory (`WorldKeeper.price`) and answered at
 * once with a quote signed by the keeper (its nonce names the vault, so `WorldBooks` asks the
 * vault's hook to accept the fill), or declined straight away so it never holds a window open.
 * Market orders of the exchange (version 1) are declined. While connected, the vault posts its
 * indications every `indicationMs`, at most 24 books a frame. */
import { getAddress } from "viem";
import type { WorldKeeper, WorldOrderRequest } from "./engine.ts";

export interface RfqSocket {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  send(data: string): void;
  close(): void;
}
type Message = Record<string, unknown>;
const MAX_BACKOFF_MS = 30_000;
const BOOKS_PER_FRAME = 24;

export class WorldRfqMaker {
  private socket: RfqSocket | undefined;
  private stopped = false;
  private retryMs = 1_000;
  private minQuoteSeconds = 3;
  private ready = false;
  private indicating: ReturnType<typeof setInterval> | undefined;

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
    if (m.type === "world.rfq") return this.respond(m);
    if (m.type === "world.result" && typeof m.rfqId === "string") {
      k.outcome(m.rfqId, String(m.outcome));
      if (m.outcome !== "lost")
        this.options.log("rfq-result", { rfq: m.rfqId, outcome: m.outcome });
      return;
    }
    if (m.type === "quote.rejected")
      this.options.log("rfq-quote-rejected", { rfq: m.rfqId, reason: m.reason });
  }

  /** Posts the vault's current indications (none while disconnected). */
  indicate() {
    if (!this.ready) return;
    const books = this.options.keeper.indications(this.minQuoteSeconds);
    for (let i = 0; i < books.length; i += BOOKS_PER_FRAME)
      this.send({ type: "world.indications", books: books.slice(i, i + BOOKS_PER_FRAME) });
  }

  private async respond(m: Message) {
    const started = performance.now();
    const k = this.options.keeper;
    const id = String(m.id);
    const decline = (reason: string, logged = true) => {
      this.send({ type: "decline", rfqId: id });
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
    const priced = k.price(order, this.minQuoteSeconds);
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
      signed = await k.sign(id, priced);
    } catch (error) {
      return decline((error as Error).message);
    }
    const q = signed.quote;
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
