/** The `/v2` worlds API: opinions read into worlds, previews, opening a world, the public feed,
 * a world's book, holders and fills, and a wallet's world account. Reads are public unless they
 * name a wallet; anything that trades carries the session. */
import type {
  BoardRfq,
  BookView,
  Draft,
  ExploringWorld,
  FeedWorld,
  Holder,
  LegEntry,
  Preview,
  Rfq,
  Spec,
  SpotHistory,
  Stock,
  Trade,
  WorldFill,
  WorldPermission,
  WorldWallet,
} from "@/lib/worlds/types";
import { requestEvents, requestJson } from "./api";

const opt = (signal?: AbortSignal) => (signal ? { signal } : {});

export const worldsApi = {
  /** The stocks a world can fix on, and how far ahead (the vault's tenor, in seconds). */
  stocks: (signal?: AbortSignal) =>
    requestJson<{ stocks: Stock[]; maxTenor?: number | null }>("/v2/worlds/stocks", opt(signal)),
  searchEvents: (q: string, signal?: AbortSignal) =>
    requestJson<{ events: LegEntry[] }>(
      `/v2/worlds/events/search?q=${encodeURIComponent(q)}`,
      opt(signal),
    ).then((r) => r.events),
  /** What the worlds page starts from (the same for everyone, refreshed every ten minutes): live
   * Polymarket events to suggest, and the curated worlds it opens on, each priced (a preview). */
  samples: (signal?: AbortSignal) =>
    requestJson<{ events: LegEntry[]; worlds?: Preview[] }>(
      "/v2/worlds/events/samples",
      opt(signal),
    ).then((r) => ({ events: r.events, worlds: r.worlds ?? [] })),
  parse: (text: string, signal?: AbortSignal) =>
    requestJson<Draft>("/v2/worlds/parse", { body: { text }, timeoutMs: 30_000, ...opt(signal) }),
  /** A world priced by the makers. `explore` says a person asked for it (their own world, or
   * one they opened), so once quoted it shows among the worlds people explore. */
  preview: (
    spec: Spec,
    stakes: { allIn: string; moneyBack: string },
    signal?: AbortSignal,
    options: { explore?: boolean } = {},
  ) =>
    requestJson<Preview>("/v2/worlds/preview", {
      body: { spec, stakes, ...(options.explore ? { explore: true } : {}) },
      timeoutMs: 15_000,
      ...opt(signal),
    }),
  /** The first `limit` worlds people priced lately that nobody holds yet (the same for everyone
   * for half a minute), and how many there are. */
  exploring: (limit: number, signal?: AbortSignal) =>
    requestJson<{ worlds: ExploringWorld[]; total?: number }>(
      `/v2/worlds/exploring?limit=${limit}`,
      opt(signal),
    ).then((r) => ({ worlds: r.worlds, total: r.total ?? r.worlds.length })),
  open: (spec: Spec) =>
    requestJson<{ defHash: string; specHash: string; book: number | null; status: string }>(
      "/v2/worlds/open",
      { body: { spec }, auth: true, timeoutMs: 30_000 },
    ),
  opened: (defHash: string, signal?: AbortSignal) =>
    requestJson<{ book: number | null; status: string; tradable: boolean }>(
      `/v2/worlds/open/${defHash}`,
      opt(signal),
    ),
  /** The first `limit` traded worlds in a sort (of one stock, or all), how many there are, and
   * every traded world's stock (the filter). */
  feed: (sort: string, underlying: string, limit: number, signal?: AbortSignal) =>
    requestJson<{
      worlds: FeedWorld[];
      total?: number;
      underlyings?: { underlying: string; symbol: string }[];
    }>(
      `/v2/worlds/feed?sort=${encodeURIComponent(sort)}&limit=${limit}${underlying ? `&underlying=${encodeURIComponent(underlying)}` : ""}`,
      opt(signal),
    ).then((r) => ({
      worlds: r.worlds,
      total: r.total ?? r.worlds.length,
      underlyings: r.underlyings ?? [],
    })),
  book: (book: number, signal?: AbortSignal) =>
    requestJson<BookView>(`/v2/books/${book}`, opt(signal)),
  books: (signal?: AbortSignal) =>
    requestJson<{ books: BookView[] }>("/v2/books", opt(signal)).then((r) => r.books),
  holders: (book: number, signal?: AbortSignal) =>
    requestJson<{ holders: Holder[]; traders: number }>(`/v2/books/${book}/holders`, opt(signal)),
  fills: (book: number, signal?: AbortSignal) =>
    requestJson<{ fills: WorldFill[] }>(`/v2/books/${book}/fills?limit=50`, opt(signal)).then(
      (r) => r.fills,
    ),
  packet: (uri: string, signal?: AbortSignal) => {
    const path = new URL(uri).pathname;
    return requestJson<{
      packet: {
        legs: {
          eventKey: string;
          question: string;
          rules: string;
          endTime: string;
          canonicalUrl: string;
          resolutionSource: string;
        }[];
      };
    }>(path, opt(signal));
  },
  status: (signal?: AbortSignal) =>
    requestJson<{ available: boolean; makers: number; delegate: string | null }>(
      "/v2/worlds/status",
      opt(signal),
    ),
  /** A stock's recorded price (its token's, as the market charts record it) over `range`. */
  spotHistory: (token: string, range: "1d" | "1w" | "1m" | "all", signal?: AbortSignal) =>
    requestJson<SpotHistory>(`/v1/tokens/${token}/spot-history?range=${range}`, opt(signal)),
  deployment: (signal?: AbortSignal) =>
    requestJson<{ chainId: number; books: string; quote: string; vaults: string[] }>(
      "/v2/deployment",
      opt(signal),
    ),
  wallet: (owner: string, signal?: AbortSignal) =>
    requestJson<WorldWallet>(`/v2/positions/${owner}`, { auth: true, ...opt(signal) }),
  myFills: (owner: string, signal?: AbortSignal) =>
    requestJson<{ fills: WorldFill[] }>(`/v2/fills?owner=${owner}&limit=500`, {
      auth: true,
      ...opt(signal),
    }).then((r) => r.fills),
  permission: (owner: string, signal?: AbortSignal) =>
    requestJson<WorldPermission>(`/v2/worlds/permission?owner=${owner}`, {
      auth: true,
      ...opt(signal),
    }),
  prepare: <T = { transactions: unknown[] }>(path: string, body: unknown) =>
    requestJson<T>(`/v2/${path}`, { body, auth: true, timeoutMs: 20_000 }),
  /** A world order out for quotes: it stays open for minutes, each maker's quote is listed
   * with its own expiry, and nothing fills until one is accepted. */
  rfq: {
    /** Opens the order for quotes; answers with the quotes of the makers online now. */
    open: (order: Record<string, unknown>, replaces?: string) =>
      requestJson<{ rfq: Rfq }>("/v2/worlds/rfqs", {
        body: { order, ...(replaces ? { replaces } : {}) },
        auth: true,
        timeoutMs: 20_000,
      }).then((r) => r.rfq),
    read: (owner: string, id: string, signal?: AbortSignal) =>
      requestJson<{ rfq: Rfq }>(`/v2/worlds/rfqs/${id}?owner=${owner}`, {
        auth: true,
        ...opt(signal),
      }).then((r) => r.rfq),
    /** Fills the quote chosen, through one-tap trading. The same `clientId` never fills twice. */
    accept: (id: string, quote: string, clientId: string) =>
      requestJson<{ transactionHash: string; rfq?: Rfq }>(`/v2/worlds/rfqs/${id}/execute`, {
        body: { quote, clientId },
        auth: true,
        timeoutMs: 90_000,
      }),
    /** Turns one quote down: it leaves the order, and its maker is told. */
    decline: (id: string, quote: string) =>
      requestJson<{ rfq: Rfq }>(`/v2/worlds/rfqs/${id}/decline`, {
        body: { quote },
        auth: true,
      }).then((r) => r.rfq),
    /** Asks the makers with no quote on the order again. */
    again: (id: string) =>
      requestJson<{ rfq: Rfq }>(`/v2/worlds/rfqs/${id}/requote`, {
        body: {},
        auth: true,
        timeoutMs: 20_000,
      }).then((r) => r.rfq),
    /** Ends the order. `leaving` lets the call finish as the page is left. */
    cancel: (id: string, leaving = false) =>
      requestJson<{ rfq: Rfq }>(`/v2/worlds/rfqs/${id}/cancel`, {
        body: {},
        auth: true,
        ...(leaving ? { keepalive: true } : {}),
      }).then((r) => r.rfq),
    /** The wallet's open orders as they change: `onRfq` with each, as quotes arrive, are
     * replaced, withdrawn or run out, and when it closes. Resolves when the stream ends. */
    follow: (owner: string, signal: AbortSignal, onRfq: (rfq: Rfq) => void) =>
      requestEvents(`/v2/worlds/rfqs/stream?owner=${owner}`, {
        auth: true,
        signal,
        onEvent: (event, data) => {
          const d = data as { rfq?: Rfq; rfqs?: Rfq[] };
          if (event === "rfq" && d.rfq) onRfq(d.rfq);
          else if (event === "rfqs") for (const rfq of d.rfqs ?? []) onRfq(rfq);
        },
      }),
  },
  /** The public board: every order out for quotes, and a wallet's own quote on one. */
  board: {
    /** The wallet's signed quote on another wallet's open order (it replaces its earlier one). */
    quote: (
      id: string,
      quote: {
        units: string;
        refund: string;
        price: string;
        expiry: string;
        nonce: string;
        signature: string;
      },
    ) =>
      requestJson<{ rfq: BoardRfq }>(`/v2/worlds/board/${id}/quote`, {
        body: quote,
        auth: true,
        timeoutMs: 20_000,
      }).then((r) => r.rfq),
    /** Takes the wallet's quote off an order. */
    withdraw: (id: string) =>
      requestJson<{ rfq: BoardRfq }>(`/v2/worlds/board/${id}/withdraw`, {
        body: {},
        auth: true,
      }).then((r) => r.rfq),
  },
  /** Every world trade, newest first: a page, the worlds it names, and where the next starts. */
  trades: (limit: number, before: string | null, signal?: AbortSignal) =>
    requestJson<{ trades: Trade[]; books: BookView[]; next: string | null }>(
      `/v2/worlds/trades?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
      opt(signal),
    ),
  /** A firm quote the wallet fills itself, at once (a position's cash-out). */
  quote: (order: Record<string, unknown>) =>
    requestJson<{
      quote: Record<string, unknown> & {
        units: string;
        refund: string;
        price: string;
        expiry: string;
      };
      cost: { price: string; fee: string; total: string } | null;
      transaction: { to: string; data: string; value: string };
    }>("/v2/worlds/quote", { body: { order }, auth: true, timeoutMs: 20_000 }),
};
