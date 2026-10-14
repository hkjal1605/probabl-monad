/** The vault on the API's RFQ stream (docs/rfq.md): one WebSocket per vault, keyed by the
 * vault's approved API key. Every request is priced from memory (`Keeper.rfqQuote`) and answered
 * at once, signed by the keeper wallet; the nonce names the vault as the maker, so the exchange
 * asks the vault to accept the fill against its own on-chain limits. A request the vault cannot
 * quote is declined straight away, so it never holds an order's window open. */
import {
  contractQuoteNonce,
  packQuoteTerms,
  QUOTE_TYPES,
  quoteDomain,
  quote as quoteNotional,
} from "@conditional-stocks/evm-client";
import { type Address, getAddress } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Keeper } from "./engine.ts";

/** What the client needs of a WebSocket (tests substitute their own). */
export interface RfqSocket {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  send(data: string): void;
  close(): void;
}
type Message = Record<string, unknown>;
const MAX_BACKOFF_MS = 30_000;

export class RfqMaker {
  private socket: RfqSocket | undefined;
  private stopped = false;
  private retryMs = 1_000;
  private minQuoteSeconds = 3;
  private ready = false;
  /** Quote nonces, unique per vault: microseconds at start, then one per quote. Consecutive
   * nonces share their 256-nonce word, so most fills set a bit of a word already in use. */
  private counter = BigInt(Date.now()) * 1000n;

  constructor(
    private readonly options: {
      keeper: Keeper;
      url: string;
      apiKey: string;
      /** The keeper wallet; absent in dry-run, which logs the quotes it would sign and declines. */
      account?: PrivateKeyAccount;
      connect?: (url: string, apiKey: string) => RfqSocket;
    },
  ) {}

  get keeper() {
    return this.options.keeper;
  }

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
        this.keeper.log("rfq-error", { reason: (error as Error).message }),
      );
    };
    socket.onclose = (event) => {
      this.ready = false;
      if (this.socket === socket) this.socket = undefined;
      if (this.stopped) return;
      // A revoked key (4001) stays revoked: an operator must issue a new one.
      if (event?.code === 4001) {
        this.keeper.log("rfq-key-revoked");
        return;
      }
      const delay = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, MAX_BACKOFF_MS);
      setTimeout(() => this.start(), delay);
    };
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
  }

  private send(message: object) {
    this.socket?.send(JSON.stringify(message));
  }

  private async receive(m: Message) {
    const k = this.keeper;
    if (m.type === "welcome") {
      const maker = m.maker as { wallet?: string } | undefined;
      // The key must belong to this vault, on this chain and exchange.
      if (
        !maker?.wallet ||
        getAddress(maker.wallet) !== k.vault ||
        m.chainId !== k.chainId ||
        typeof m.exchange !== "string" ||
        getAddress(m.exchange) !== k.identity.exchange
      ) {
        k.log("rfq-misconfigured", { reason: "The API key or stream belongs to another vault" });
        this.stop();
        return;
      }
      if (typeof m.minQuoteSeconds === "number") this.minQuoteSeconds = m.minQuoteSeconds;
      this.ready = true;
      this.retryMs = 1_000;
      k.log("rfq-connected", { minQuoteSeconds: this.minQuoteSeconds });
      return;
    }
    if (m.type === "rfq") return this.respond(m);
    if (m.type === "rfq.result" && typeof m.rfqId === "string") {
      k.quoteOutcome(m.rfqId, String(m.outcome));
      if (k.outstanding.has(m.rfqId) || m.outcome !== "lost")
        k.log("rfq-result", { rfq: m.rfqId, outcome: m.outcome, filled: m.filled });
      return;
    }
    if (m.type === "quote.rejected")
      k.log("rfq-quote-rejected", { rfq: m.rfqId, reason: m.reason });
  }

  /** Answers one request: a signed quote or a decline. */
  private async respond(m: Message) {
    const started = performance.now();
    const k = this.keeper;
    const id = String(m.id);
    const decline = (reason: string, logged: boolean) => {
      this.send({ type: "decline", rfqId: id });
      if (logged) k.log("rfq-declined", { rfq: id, reason });
    };
    if (!this.ready) return decline("Not ready", false);
    const market = Number((m.market as { id?: unknown } | undefined)?.id);
    const o = m.order as Record<string, unknown> | undefined;
    const signing = m.signing as { domain?: Record<string, unknown> } | undefined;
    const domain = quoteDomain(k.chainId, k.identity.exchange);
    // Another vault's stock: not this vault's request to answer.
    if (!k.latest?.v.markets.some((x) => x.market === market))
      return decline("Other market", false);
    if (
      !o ||
      !signing?.domain ||
      signing.domain.chainId !== domain.chainId ||
      typeof signing.domain.verifyingContract !== "string" ||
      getAddress(signing.domain.verifyingContract) !== domain.verifyingContract ||
      signing.domain.name !== domain.name ||
      signing.domain.version !== domain.version
    )
      return decline("Malformed request", true);
    let order: { branch: 0 | 1; side: 0 | 1; quantity: bigint; limit: bigint; taker: Address };
    try {
      order = {
        branch: o.branch === 1 ? 1 : 0,
        side: o.side === 1 ? 1 : 0,
        quantity: BigInt(String(o.quantity)),
        limit: BigInt(String(o.limitPriceRawX18)),
        taker: getAddress(String(o.taker)),
      };
    } catch {
      return decline("Malformed request", true);
    }
    const priced = k.rfqQuote({ market, order }, this.minQuoteSeconds);
    if ("decline" in priced) return decline(priced.decline, true);
    const { price, quantity, fundingKind, expiry } = priced;
    const sells = order.side === 0;
    const terms = packQuoteTerms(
      {
        marketId: market,
        branch: order.branch,
        side: sells ? 1 : 0,
        fundingKind,
        expiry,
        priceRawX18: price,
        quantity,
      },
      k.follower.confirmed.markets.get(market)!.tick,
    );
    const nonce = contractQuoteNonce(k.vault, ++this.counter);
    const account = this.options.account;
    if (!account) {
      k.log("rfq-dry-run", { rfq: id, market, price, quantity, fundingKind });
      return decline("Dry run", false);
    }
    // Counted against the vault's limits before it leaves, so the next request sees it.
    k.outstanding.set(id, {
      market,
      branch: order.branch,
      sells,
      fundingKind,
      quantity,
      notional: quoteNotional(quantity, price, true),
      expiresAtMs: Number(expiry) * 1000,
    });
    let signature: `0x${string}`;
    try {
      signature = await account.signTypedData({
        domain,
        types: QUOTE_TYPES,
        primaryType: "Quote",
        message: { taker: order.taker, terms, nonce },
      });
    } catch (error) {
      k.outstanding.delete(id);
      return decline((error as Error).message, true);
    }
    this.send({
      type: "quote",
      rfqId: id,
      price: price.toString(),
      quantity: quantity.toString(),
      fundingKind,
      expiry: expiry.toString(),
      nonce: nonce.toString(),
      signature,
    });
    k.log("rfq-quoted", {
      rfq: id,
      market,
      branch: order.branch,
      side: sells ? "sell" : "buy",
      price,
      quantity,
      fair: priced.fair,
      gapPpm: priced.gapPpm,
      halfSpreadBps: priced.halfSpreadBps,
      ms: Math.round((performance.now() - started) * 100) / 100,
    });
  }
}
