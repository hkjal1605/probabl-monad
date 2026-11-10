/** The Explore page in a browser-like DOM, every API call counted: one stream carries the board
 * and the trades, one read the first page of trades, and nothing else is asked until a person
 * acts. Rows keep their place as orders arrive and close; an order opens into the bet in full,
 * the quotes on it and a quote of the reader's own (one figure, with what it means before
 * anything is signed); a quote is signed and sent, stands, is replaced, turned down, taken back
 * and accepted; and the trades list grows from the stream and by the page. */
import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, type ReactNode } from "react";

const dom = new Window({ url: "http://localhost:3001/worlds/explore" });
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "ShadowRoot",
  "MutationObserver",
  "ResizeObserver",
  "Event",
  "InputEvent",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "FocusEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: Reflect.get(dom, key),
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const BOOKS = "0x00000000000000000000000000000000000000b0";
process.env.NEXT_PUBLIC_WORLD_BOOKS_ADDRESS = BOOKS;
process.env.NEXT_PUBLIC_CHAIN_ID = "46630";
process.env.NEXT_PUBLIC_EXPLORER_URL = "https://explorer.test";
/** Whether the screen is a phone's (the order then opens as a bottom sheet). */
let phone = false;
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: phone && query.includes("max-width: 767px"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
});

const OWNER = "0x00000000000000000000000000000000000000A1";
const OTHER = "0x00000000000000000000000000000000000000B2";
const THIRD = "0x00000000000000000000000000000000000000C3";
const VAULT = "0x00000000000000000000000000000000000000D4";
const calls: string[] = [];
const toasts: string[] = [];
const errors: string[] = [];
const signed: string[] = [];

/** The board's stream, as the page opens it. */
class FakeSource {
  static readonly CLOSED = 2;
  readyState = 1;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, ((event: { data: string }) => void)[]>();
  constructor(readonly url: string) {
    sources.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) });
  }
}
const sources: FakeSource[] = [];
Object.assign(globalThis, { EventSource: FakeSource });

interface Quote {
  maker: string;
  makerId: string;
  wallet: string | null;
  vault: boolean;
  units: string;
  refund: string;
  price: string;
  expiry: string;
  receivedAt: number;
  fills: boolean;
}
interface Rfq {
  id: string;
  status: "open" | "filled" | "cancelled" | "expired";
  reason: string | null;
  book: number;
  taker: string;
  order: {
    side: "buy" | "sell";
    mask: number;
    units: string | null;
    refund: string;
    stake: string | null;
    conditional: boolean;
    limit: string;
  };
  now: number;
  createdAt: number;
  expiresAt: number;
  closedAt: number | null;
  received: number;
  quotes: Quote[];
  fill: Record<string, unknown> | null;
}
const raw = (dollars: number) => String(Math.round(dollars * 1e6));
const vaultQuote = (units: number, seconds = 300): Quote => ({
  maker: "World vault",
  makerId: "vault",
  wallet: null,
  vault: true,
  units: raw(units),
  refund: "0",
  price: "19801980",
  expiry: String(Math.floor(Date.now() / 1000) + seconds),
  receivedAt: Date.now(),
  fills: true,
});
const myQuote = (units: string, expiry: string): Quote => ({
  maker: "0x0000…00A1",
  makerId: `wallet:${OWNER}`,
  wallet: OWNER,
  vault: false,
  units,
  refund: "0",
  price: "19801980",
  expiry,
  receivedAt: Date.now(),
  fills: true,
});
/** An order placed `agoSeconds` ago (it stays open 15 minutes). */
const rfq = (id: string, agoSeconds: number, over: Partial<Rfq> = {}): Rfq => {
  const now = Date.now();
  return {
    id,
    status: "open",
    reason: null,
    book: 7,
    taker: OTHER,
    order: {
      side: "buy",
      mask: 4,
      units: null,
      refund: "0",
      stake: "19801980",
      conditional: false,
      limit: "0",
    },
    now,
    createdAt: now - agoSeconds * 1000,
    expiresAt: now + (900 - agoSeconds) * 1000,
    closedAt: null,
    received: 1,
    quotes: [vaultQuote(84.2)],
    fill: null,
    ...over,
  };
};
/** The orders as the API holds them now (what its calls answer from). */
const held = new Map<string, Rfq>();
const hold = (...list: Rfq[]) => {
  for (const r of list) held.set(r.id, r);
  return list;
};
const best = (quotes: Quote[]) => [...quotes].sort((a, b) => Number(b.units) - Number(a.units));

const leg = (key: string, question: string, wantYes: boolean) => ({
  eventKey: key,
  wantYes,
  state: "open",
  outcome: null,
  resolvedAt: null,
  venue: {
    source: "polymarket",
    marketId: key,
    conditionId: key,
    question,
    url: `https://polymarket.com/event/${key}`,
    endTime: "2026-12-10T05:00:00.000Z",
    themes: [],
  },
});
const book = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  feeBps: 100,
  tradable: true,
  eventOnly: false,
  atoms: 3,
  marks: [700_000, 80_000, 220_000],
  legs: [
    leg("0xe1", "Will the Fed cut rates in December?", true),
    leg("0xe2", "Will CPI inflation be above 3.8% for the year ending November 2026?", false),
  ],
  opinion: {
    sentence: "",
    direction: "above",
    strike: "240",
    symbol: "NVDA",
    fixingDate: "2026-12-11",
  },
  underlying: "US:NVDA",
  feedDecimals: 2,
  fixingTime: "1797022800",
  strikes: [{ raw: "24000", price: "240" }],
  products: [
    { key: "bet:above:1", kind: "world-bet", outcome: { kind: "above", strike: 1 }, mask: 4 },
    { key: "cond:above:1", kind: "conditional", outcome: { kind: "above", strike: 1 }, mask: 4 },
    { key: "bet:below:1", kind: "world-bet", outcome: { kind: "below", strike: 1 }, mask: 2 },
  ],
  analytics: {
    legs: [
      { eventKey: "0xe1", chance: 620_000 },
      { eventKey: "0xe2", chance: 410_000 },
    ],
    chain: [],
    naive: [],
    world: 300_000,
    spot: 23_140,
    forward: null,
    move: null,
  },
  winner: null,
  ...over,
});
const trade = (block: number, over: Record<string, unknown> = {}) => ({
  book: 7,
  block: String(block),
  logIndex: 0,
  time: String(Math.floor(Date.now() / 1000) - 300),
  transactionHash: `0xt${block}`,
  maker: VAULT,
  taker: OTHER,
  mask: 4,
  sell: false,
  units: "84200000",
  refund: "0",
  price: "19801980",
  fee: "198020",
  vault: true,
  ...over,
});
/** The pages of trades the API holds, by cursor. */
let pages: Record<string, { trades: unknown[]; books: unknown[]; next: string | null }> = {};

mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
mock.module("../../src/components/ui/toast", () => ({
  toast: { add: (t: { title: string }) => toasts.push(t.title) },
}));
/** The reader: a member with a wallet, or (`me = null`) nobody. */
let me: string | null = OWNER;
mock.module("../../src/components/providers/WalletProvider", () => ({
  useWallet: () => ({
    account: me,
    signTypedData: async (typed: string) => {
      signed.push(typed);
      return `0x${"ab".repeat(65)}`;
    },
  }),
  useMemberAccount: () => me,
}));
const account = {
  owner: OWNER,
  step: null as null | {
    kind: string;
    label: string;
    action(): void;
    disabled: boolean;
    busy: boolean;
  },
  permissionLoaded: true,
  credit: 500_000_000n,
  walletBalance: 1_000_000_000n,
  busy: false,
  run: async (work: (assertCurrent: () => void) => Promise<void>) => {
    try {
      await work(() => {});
    } catch (error) {
      errors.push((error as Error).message);
    }
  },
  deposit: (amount: bigint) => void calls.push(`deposit:${amount}`),
};
mock.module("../../src/hooks/useWorldAccount", () => ({ useWorldAccount: () => account }));
mock.module("../../src/services/worlds-api", () => ({
  worldsApi: {
    // Read only for a world the stream could not send.
    book: async (id: number) => {
      calls.push(`book:${id}`);
      return book(id);
    },
    trades: async (limit: number, before: string | null) => {
      calls.push(`trades:${limit}:${before}`);
      return pages[before ?? "first"] ?? { trades: [], books: [], next: null };
    },
    board: {
      quote: async (id: string, quote: Record<string, string>) => {
        calls.push(`board.quote:${id}:${JSON.stringify(quote)}`);
        const r = held.get(id)!;
        const next = {
          ...r,
          now: Date.now(),
          received: r.received + 1,
          quotes: best([
            ...r.quotes.filter((q) => q.wallet !== OWNER),
            myQuote(quote.units!, quote.expiry!),
          ]),
        };
        held.set(id, next);
        return next;
      },
      withdraw: async (id: string) => {
        calls.push(`board.withdraw:${id}`);
        const r = held.get(id)!;
        const next = { ...r, now: Date.now(), quotes: r.quotes.filter((q) => q.wallet !== OWNER) };
        held.set(id, next);
        return next;
      },
    },
  },
}));

const { createRoot } = await import("react-dom/client");
const { Explore } = await import("../../src/modules/WorldsExplorePageModule/components/Explore");

const host = document.createElement("div");
document.body.appendChild(host);
let root = createRoot(host);
const settle = async (ms = 60) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
const render = async () => {
  await act(async () => root.render(<Explore />));
  await settle();
};
const source = () => sources.at(-1)!;
/** A frame of the stream, as the API would push it. */
async function emit(type: string, data: unknown) {
  await act(async () => source().emit(type, data));
  await settle();
}
const boardOf = (rfqs: Rfq[], books: unknown[] = [book(7)]) => ({
  available: true,
  now: Date.now(),
  rfqSeconds: 900,
  minQuoteSeconds: 10,
  rfqs,
  books,
});
const tables = () => [...host.querySelectorAll("table")] as HTMLElement[];
const bodyRows = (table: HTMLElement | undefined) =>
  [...(table?.querySelectorAll("tbody tr") ?? [])] as HTMLElement[];
/** The open orders' rows, when there are any (otherwise the first table is the trades'). */
const orderRows = () => bodyRows(tables()[0]);
const sheet = () => document.querySelector('[data-slot="sheet-content"]') as HTMLElement | null;
const within = (scope: Element | null | undefined, label: string | RegExp) =>
  [...(scope?.querySelectorAll("button, a") ?? [])].find((b) =>
    typeof label === "string" ? b.textContent?.trim() === label : label.test(b.textContent ?? ""),
  ) ?? null;
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await settle(80);
}
async function type(text: string) {
  const input = sheet()?.querySelector("input") as HTMLInputElement | null;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
const payout = () => (sheet()?.querySelector("input") as HTMLInputElement | null)?.value;
/** Opens the sheet of the order in row `index`. */
const openRow = (index: number) =>
  click(within(orderRows()[index], /^(Quote|Your order|Your quote)/));
const closeSheet = async () => {
  await click(within(sheet(), "Close"));
  await settle(300);
};

afterEach(async () => {
  await act(async () => root.unmount());
  await settle(300);
  root = createRoot(host);
  calls.length = 0;
  toasts.length = 0;
  errors.length = 0;
  signed.length = 0;
  sources.length = 0;
  held.clear();
  pages = {};
  me = OWNER;
  phone = false;
  account.step = null;
  account.credit = 500_000_000n;
});
afterAll(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
});

test("one stream and one read; orders keep their rows, the one closing soonest first", async () => {
  await render();
  // The page asks for two things, once each: the board's stream and the first page of trades.
  expect(sources).toHaveLength(1);
  expect(source().url.endsWith("/v2/worlds/board/stream")).toBe(true);
  expect(calls).toEqual(["trades:25:null"]);
  expect(host.textContent).toContain("Connecting…");
  // Two orders, listed newest first by the API: the page puts the one closing soonest first.
  const [a, b] = hold(
    rfq("a", 300),
    rfq("b", 60, {
      taker: OWNER,
      quotes: [],
      received: 0,
      order: { ...rfq("x", 0).order, conditional: true },
    }),
  );
  await emit("board", boardOf([b!, a!]));
  expect(host.textContent).toContain("2 open · live");
  expect(orderRows()).toHaveLength(2);
  const [first, second] = orderRows();
  // A row says the bet in two lines (the stock's move, then the first event and how many more),
  // what its taker pays and for which bet, the best quote and how long it stays open.
  expect(first!.textContent).toContain("NVDA");
  expect(first!.textContent).toContain("above$240");
  expect(first!.textContent).toContain("Fri, Dec 11");
  expect(first!.textContent).toContain("ifYESThe Fed cut rates in December+1 more");
  expect(first!.textContent).toContain("$20All-in");
  expect(first!.textContent).toContain("$84.204.2×1 quote");
  expect(first!.textContent).toMatch(/(10:00|9:5\d)/);
  expect(within(first, "Quote")).not.toBeNull();
  // The whole bet is said on hover, and in the order's own view.
  expect(first!.querySelector("[title]")?.getAttribute("title")).toBe(
    "NVDA closes above $240 on Fri, Dec 11 · YES: The Fed cut rates in December · NO: CPI inflation is above 3.8% for the year ending November 2026",
  );
  // The reader's own order is marked, and not theirs to quote.
  expect(second!.textContent).toContain("Money-back");
  expect(second!.textContent).toContain("No quote yet");
  expect(second!.textContent).toMatch(/(14:00|13:5\d)/);
  expect(within(second, /^Your order/)).not.toBeNull();
  expect(within(second, "Quote")).toBeNull();
  // A new order joins at the end (it closes last), with its world; no row above it moves.
  const c = rfq("c", 0, {
    book: 8,
    taker: THIRD,
    order: { ...rfq("x", 0).order, mask: 2 },
  });
  await emit("rfq", { rfq: c, book: book(8, { opinion: { ...book(8).opinion, symbol: "QQQ" } }) });
  expect(orderRows().map((r) => r.textContent?.includes("QQQ"))).toEqual([false, false, true]);
  // The bet is the order's own side of its world: this one takes the other way.
  expect(orderRows()[2]!.textContent).toContain("below$240");
  expect(host.textContent).toContain("3 open · live");
  // A quote on an order updates its row where it is.
  await emit("rfq", { rfq: { ...b!, now: Date.now(), received: 1, quotes: [vaultQuote(51)] } });
  expect(orderRows()[1]!.textContent).toContain("$51");
  // An order that closes stays a moment, greyed, saying how it ended.
  await emit("rfq", { rfq: { ...a!, now: Date.now(), status: "cancelled", quotes: [] } });
  expect(orderRows()).toHaveLength(3);
  expect(orderRows()[0]!.textContent).toContain("Cancelled");
  expect(within(orderRows()[0], "Quote")).toBeNull();
  expect(host.textContent).toContain("2 open · live");
  // All of it came down the stream: nothing more was read.
  expect(calls).toEqual(["trades:25:null"]);
  expect(sources).toHaveLength(1);
});

test("an order opens into the bet in full, the quotes on it, and one figure with what it means", async () => {
  await render();
  const [a] = hold(rfq("a", 300));
  await emit("board", boardOf([a!]));
  expect(sheet()).toBeNull();
  await openRow(0);
  const s = () => sheet()?.textContent ?? "";
  expect(s()).toContain("Take the other side");
  // Whose bet it is, the whole sentence, every event with the side it needs and its chance,
  // the stock now and what it must do, and what is paid for which bet.
  expect(s()).toContain("0x0000…00B2 bets that");
  expect(s()).toMatch(/Open for(10:00|9:5\d)/);
  expect(s()).toContain("If the Fed cut rates in December and NOCPI inflation is above 3.8%");
  expect(s()).toContain("NVDA closes above $240 on Fri, Dec 11");
  expect(s()).toContain("YESThe Fed cut rates in December");
  expect(s()).toContain("62%");
  expect(s()).toContain("41%");
  expect(s()).toContain("Polymarket");
  expect(s()).toContain("now $231.40, must close above $240");
  expect(s()).toContain("All-inthey pay $20");
  expect(within(sheet(), /^World page/)?.getAttribute("href")).toBe("/worlds/7");
  // The quotes standing on it.
  expect(s()).toContain("Quotes so far");
  expect(s()).toContain("World vault$84.204.2×");
  // A figure to start from: a little over the best quote. With it, each ending with its chance,
  // and what the quote is worth at the market's odds.
  expect(payout()).toBe("85.05");
  expect(s()).toContain("If accepted, you receive now$19.80");
  expect(s()).toContain("If they're right · 22%you pay them $85.05−$65.25");
  expect(s()).toContain("If they're wrong · 78%you keep their stake+$19.80");
  expect(s()).toContain("On average, at market odds+$1.09");
  expect(s()).toContain("Best quote so far$84.20");
  expect(s()).toContain("Break-even at market oddsMore$90.01");
  expect(within(sheet(), "Sign and send quote")?.hasAttribute("disabled")).toBe(false);
  // The references set the figure.
  await click(within(sheet(), "Use 3% under"));
  expect(payout()).toBe("87.30");
  await click(within(sheet(), "Beat it"));
  expect(payout()).toBe("85.05");
  // A payout no higher than their stake cannot fill: the button says what to do.
  await type("15");
  expect(within(sheet(), "Offer more than their stake of $19.80")?.hasAttribute("disabled")).toBe(
    true,
  );
  expect(s()).not.toContain("If accepted, you receive now");
  // More than the world balance backs: the button adds what is missing.
  await type("900");
  expect(s()).toContain("This quote needs $880.20 in your world balance; it holds $500.");
  await click(within(sheet(), "Add $381 to quote"));
  expect(calls).toEqual(["trades:25:null", "deposit:381000000"]);
  // A reader with no wallet is asked to connect one, there.
  let asked = 0;
  account.step = {
    kind: "connect",
    label: "Connect wallet",
    action: () => void asked++,
    disabled: false,
    busy: false,
  };
  await type("85.05");
  await click(within(sheet(), "Connect wallet"));
  expect(asked).toBe(1);
  expect(signed).toEqual([]);
  expect(errors).toEqual([]);
});

test("a quote is signed and sent once; it stands, is replaced, turned down and taken back", async () => {
  await render();
  const [a] = hold(rfq("a", 300));
  await emit("board", boardOf([a!]));
  await openRow(0);
  const s = () => sheet()?.textContent ?? "";
  await click(within(sheet(), "Sign and send quote"));
  // One signature, of the books' own typed quote for exactly this order, and one call.
  expect(errors).toEqual([]);
  expect(signed).toHaveLength(1);
  const typed = JSON.parse(signed[0]!) as {
    primaryType: string;
    domain: Record<string, unknown>;
    message: Record<string, unknown>;
  };
  expect(typed.primaryType).toBe("WorldQuote");
  // The domain is this build's world books: the signature fills nowhere else.
  const domain: Record<string, unknown> = {
    ...typed.domain,
    verifyingContract: String(typed.domain.verifyingContract).toLowerCase(),
  };
  expect(domain).toEqual({
    name: "Probabl Worlds",
    version: "1",
    chainId: 46630,
    verifyingContract: BOOKS,
  });
  expect(typed.message).toMatchObject({
    taker: OTHER,
    book: "7",
    mask: 4,
    units: "85050000",
    refund: "0",
    sell: false,
    price: "19801980",
    makerData: "0",
  });
  // Held for five minutes by default, on the API's clock.
  const life = Number(typed.message.expiry) - Math.floor(Date.now() / 1000);
  expect(life).toBeGreaterThan(296);
  expect(life).toBeLessThan(302);
  const sent = calls.filter((c) => c.startsWith("board.quote:"));
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]!.slice("board.quote:a:".length))).toEqual({
    units: "85050000",
    refund: "0",
    price: "19801980",
    expiry: String(typed.message.expiry),
    nonce: typed.message.nonce,
    signature: `0x${"ab".repeat(65)}`,
  });
  expect(toasts).toEqual(["Quote sent"]);
  // It stands: in the order's quotes, marked as the reader's and as the best, and in its row.
  expect(s()).toContain("Your quote is live");
  expect(s()).toContain("YouBest$85.05");
  expect(s()).toMatch(/Your quote is live(5:00|4:5\d)/);
  expect(orderRows()[0]!.textContent).toContain("$85.054.3×yours");
  expect(within(orderRows()[0], "Your quote · $85.05")).not.toBeNull();
  // Changing it shows the figure again; it can be kept as it is.
  await click(within(sheet(), "Change"));
  expect(s()).toContain("Change your quote");
  expect(payout()).toBe("85.05");
  await click(within(sheet(), "Keep it"));
  expect(s()).toContain("Your quote is live");
  // A new figure, held one minute, replaces it: one more signature, one more call.
  await click(within(sheet(), "Change"));
  await type("86");
  await click(within(sheet(), "1 min"));
  await click(within(sheet(), "Sign and replace quote"));
  expect(signed).toHaveLength(2);
  const again = JSON.parse(signed[1]!).message as { units: string; expiry: number; nonce: string };
  expect(again.units).toBe("86000000");
  expect(again.expiry - Math.floor(Date.now() / 1000)).toBeLessThan(62);
  expect(again.nonce).not.toBe(typed.message.nonce);
  expect(held.get("a")!.quotes.filter((q) => q.wallet === OWNER)).toHaveLength(1);
  expect(s()).toContain("YouBest$86");
  // Its owner turns it down: the stream says so, and the figure is back for another try.
  await emit("rfq", { rfq: { ...held.get("a")!, now: Date.now(), quotes: [vaultQuote(84.2)] } });
  expect(s()).toContain("Its owner turned your quote down.");
  expect(within(sheet(), "Sign and send quote")).not.toBeNull();
  expect(within(orderRows()[0], "Quote")).not.toBeNull();
  // Sent again, then taken back: one call, and no talk of being turned down.
  held.set("a", { ...held.get("a")!, quotes: [vaultQuote(84.2)] });
  await click(within(sheet(), "Sign and send quote"));
  expect(s()).toContain("Your quote is live");
  await click(within(sheet(), "Take it back"));
  expect(calls.filter((c) => c.startsWith("board.withdraw:"))).toEqual(["board.withdraw:a"]);
  expect(toasts.at(-1)).toBe("Quote taken back");
  expect(s()).not.toContain("turned your quote down");
  expect(within(sheet(), "Sign and send quote")).not.toBeNull();
  expect(errors).toEqual([]);
  // Three quotes, three signatures, one withdrawal; the board itself was never read again.
  expect(calls.map((c) => c.split(":").slice(0, 2).join(":"))).toEqual([
    "trades:25",
    "board.quote:a",
    "board.quote:a",
    "board.quote:a",
    "board.withdraw:a",
  ]);
});

test("an accepted quote says so; a closed order says how it ended; an own order is not quoted", async () => {
  await render();
  const [a, b, c] = hold(rfq("a", 300), rfq("b", 200, { taker: OWNER }), rfq("c", 100));
  await emit("board", boardOf([c!, b!, a!]));
  await openRow(0);
  const s = () => sheet()?.textContent ?? "";
  await click(within(sheet(), "Sign and send quote"));
  expect(s()).toContain("Your quote is live");
  // The owner accepts it: the order fills with the reader's quote.
  await emit("rfq", {
    rfq: {
      ...held.get("a")!,
      now: Date.now(),
      status: "filled",
      quotes: [],
      fill: {
        maker: "0x0000…00A1",
        makerId: `wallet:${OWNER}`,
        wallet: OWNER,
        units: "85050000",
        refund: "0",
        price: "19801980",
        transactionHash: "0xfill",
      },
    },
  });
  expect(s()).toContain("Your quote was accepted");
  expect(s()).toContain("You received $19.80. $85.05 is held in this world until it settles.");
  expect(within(sheet(), "See my worlds")?.getAttribute("href")).toBe("/worlds/me");
  expect(sheet()?.querySelector("input")).toBeNull();
  expect(orderRows()[0]!.textContent).toContain("Filled");
  await click(within(sheet(), "Done"));
  await settle(300);
  // The reader's own order: its quotes are read, none is made.
  await openRow(1);
  expect(s()).toContain("You bet that");
  expect(s()).toContain("This is your order.");
  expect(sheet()?.querySelector("input")).toBeNull();
  await closeSheet();
  // An order another quote won, seen while its view is open.
  await openRow(2);
  expect(within(sheet(), "Sign and send quote")).not.toBeNull();
  await emit("rfq", {
    rfq: {
      ...c!,
      now: Date.now(),
      status: "filled",
      quotes: [],
      fill: {
        maker: "World vault",
        makerId: "vault",
        wallet: null,
        units: "84200000",
        refund: "0",
        price: "19801980",
        transactionHash: "0xother",
      },
    },
  });
  expect(s()).toContain("Filled by World vault at $84.20.");
  expect(sheet()?.querySelector("input")).toBeNull();
  expect(within(sheet(), "Back to open orders")).not.toBeNull();
  expect(errors).toEqual([]);
});

test("trades: a page, live ones on top, older ones on demand, each said in full", async () => {
  pages = {
    first: {
      trades: [
        trade(120),
        trade(110, { taker: OWNER, maker: THIRD, vault: false, refund: "19801980" }),
      ],
      books: [book(7)],
      next: "110:0",
    },
    "110:0": {
      trades: [trade(90, { book: 9, sell: true, units: "30000000" }), trade(80, { book: 9 })],
      books: [book(9, { winner: 2 })],
      next: null,
    },
  };
  await render();
  // No orders: the board says so, and what will show up here.
  await emit("board", boardOf([], []));
  expect(host.textContent).toContain("No open orders right now");
  expect(host.textContent).toContain("0 open · live");
  // With no open order the only table is the trades'.
  const rows = () => bodyRows(tables()[0]);
  expect(rows()).toHaveLength(2);
  const [first, second] = rows();
  expect(first!.textContent).toContain("5m ago");
  expect(first!.textContent).toContain("NVDA");
  expect(first!.textContent).toContain("All-in$20$84.204.2×");
  expect(first!.textContent).toContain("0x0000…00B2Vault");
  expect(first!.textContent).toContain("Open");
  expect(within(first, /5m ago/)?.getAttribute("href")).toBe("https://explorer.test/tx/0xt120");
  expect(first!.querySelector('a[href="/worlds/7"]')).not.toBeNull();
  // The reader's own trade, with another wallet as its maker.
  expect(second!.textContent).toContain("Money-back");
  expect(second!.textContent).toContain("You0x0000…00C3");
  // A trade confirmed while the page is open arrives on the stream, on top.
  await emit("trade", {
    trade: trade(130, { time: String(Math.floor(Date.now() / 1000)), units: "99000000" }),
    book: book(7),
  });
  expect(rows()).toHaveLength(3);
  expect(rows()[0]!.textContent).toContain("just now");
  expect(rows()[0]!.textContent).toContain("$99");
  // The same trade heard twice is one trade.
  await emit("trade", { trade: trade(130), book: book(7) });
  expect(rows()).toHaveLength(3);
  // Older trades come a page at a time, with their own worlds; a settled bet says how it ended.
  await click(within(host, "Show older trades"));
  expect(calls).toEqual(["trades:25:null", "trades:25:110:0"]);
  expect(rows()).toHaveLength(5);
  expect(rows()[3]!.textContent).toContain("Cash-out");
  expect(rows()[3]!.textContent).toContain("—");
  expect(rows()[4]!.textContent).toContain("Won");
  expect(within(host, "Show older trades")).toBeNull();
  // The stream dropped and came back: the first page is read again, in case a trade was missed.
  await emit("board", boardOf([], []));
  expect(calls).toEqual(["trades:25:null", "trades:25:110:0", "trades:25:null"]);
});

test("on a phone the order opens as a bottom sheet with the same parts; a visitor reads without a wallet", async () => {
  phone = true;
  me = null;
  account.step = {
    kind: "connect",
    label: "Connect wallet",
    action() {},
    disabled: false,
    busy: false,
  };
  await render();
  const [a] = hold(rfq("a", 300));
  await emit("board", boardOf([a!]));
  // The phone's list: a card an order, with the same facts and one wide button.
  const card = host.querySelector("ul li article") as HTMLElement | null;
  expect(card?.textContent).toContain("They pay$20All-in");
  expect(card?.textContent).toContain("Best quote$84.204.2×1 quote");
  expect(card?.textContent).toMatch(/Closes in(10:00|9:5\d)/);
  await click(within(card, "Quote"));
  expect(sheet()).toBeNull();
  const drawer = document.querySelector('[data-slot="drawer-content"]');
  expect(drawer?.textContent).toContain("Take the other side");
  expect(drawer?.textContent).toContain("NVDA closes above $240 on Fri, Dec 11");
  expect(drawer?.textContent).toContain("World vault$84.204.2×");
  // Everything can be read and tried before a wallet is connected; sending asks for one.
  expect((drawer?.querySelector("input") as HTMLInputElement | null)?.value).toBe("85.05");
  expect(drawer?.textContent).toContain("you pay them $85.05−$65.25");
  expect(within(drawer, "Connect wallet")).not.toBeNull();
  expect(within(drawer, "Sign and send quote")).toBeNull();
  expect(calls).toEqual(["trades:25:null"]);
});

test("a world the stream could not send is read once", async () => {
  await render();
  const [a] = hold(rfq("a", 300, { book: 12 }));
  await emit("board", boardOf([a!], []));
  await settle(100);
  expect(calls).toEqual(["trades:25:null", "book:12"]);
  expect(orderRows()[0]!.textContent).toContain("NVDA");
  // Later frames of the same world ask nothing more.
  await emit("rfq", { rfq: { ...a!, now: Date.now(), quotes: [vaultQuote(90)] } });
  expect(calls).toEqual(["trades:25:null", "book:12"]);
});
