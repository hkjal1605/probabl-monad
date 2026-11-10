/** The world ticket's order flow in a browser-like DOM, every API call counted: nothing is asked
 * until Place; Place opens the world if it is new and sends one order for quotes; the board lists
 * each maker's quote with its own countdown, in the place it arrived; a quote is accepted,
 * declined, or the order cancelled; an order that runs out can be asked again; and leaving the
 * ticket cancels an open order. */
import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, type ReactNode } from "react";

const dom = new Window({ url: "http://localhost:3001/worlds/7" });
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
process.env.NEXT_PUBLIC_WORLD_BOOKS_ADDRESS = "0x00000000000000000000000000000000000000b0";
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
});

const OWNER = "0x00000000000000000000000000000000000000a1";
const calls: string[] = [];
const toasts: string[] = [];
const errors: string[] = [];
/** The stream's listener (the fixture sends frames through it), and the order it holds. */
let push: ((rfq: Rfq) => void) | null = null;
let streams = 0;
let current: Rfq | null = null;
let nextId = 1;

interface Quote {
  id: string;
  maker: string;
  makerId: string;
  vault: boolean;
  units: string;
  refund: string;
  price: string;
  fee: string;
  total: string;
  expiry: string;
  receivedAt: number;
  problem: string | null;
}
interface Rfq {
  id: string;
  status: "open" | "filled" | "cancelled" | "expired";
  reason: string | null;
  book: number;
  order: Record<string, unknown>;
  now: number;
  createdAt: number;
  expiresAt: number;
  closedAt: number | null;
  makers: number;
  received: number;
  quotes: Quote[];
  fill: Record<string, unknown> | null;
}
const quote = (maker: "vault" | "desk", units: number, seconds = 300, id?: string): Quote => ({
  id: id ?? `q${nextId++}`,
  maker: maker === "vault" ? "World vault" : "Desk one",
  makerId: maker,
  vault: maker === "vault",
  units: String(Math.round(units * 1e6)),
  refund: "0",
  price: "19801980",
  fee: "198020",
  total: "20000000",
  expiry: String(Math.floor(Date.now() / 1000) + seconds),
  receivedAt: Date.now(),
  problem: null,
});
/** The order as the API would send it now, with these quotes (best first, as the API lists). */
const frame = (over: Partial<Rfq> = {}): Rfq => {
  current = { ...current!, now: Date.now(), ...over };
  return current;
};

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
mock.module("../../src/components/onboarding/OnboardingProvider", () => ({
  useOnboarding: () => ({ enabled: false, show() {} }),
}));
// A member ready to trade: signed in, one-tap trading on, $500 of balance.
const account = {
  owner: OWNER,
  step: null,
  permission: { active: true, available: true },
  permissionLoaded: true,
  credit: 500_000_000n,
  walletBalance: 0n,
  busy: false,
  run: async (work: (assertCurrent: () => void) => Promise<void>) => {
    try {
      await work(() => {});
    } catch (error) {
      errors.push((error as Error).message);
    }
  },
  refresh: () => void calls.push("account:refresh"),
  enable() {},
  deposit() {},
};
mock.module("../../src/hooks/useWorldAccount", () => ({ useWorldAccount: () => account }));

const book = {
  id: 7,
  feeBps: 100,
  tradable: true,
  eventOnly: false,
  atoms: 3,
  marks: [700_000, 80_000, 220_000],
  legs: [{ venue: { endTime: "2026-12-10T05:00:00.000Z" } }],
  products: [
    { key: "bet:above:1", kind: "world-bet", outcome: {}, mask: 4, bid: null, ask: 240_000 },
    { key: "cond:above:1", kind: "conditional", outcome: {}, mask: 4, bid: null, ask: 800_000 },
  ],
};
/** What the API answers each call with, and why it would refuse one. */
let refuse: Record<string, string> = {};
const answer = <T,>(name: string, value: T): T => {
  if (refuse[name]) throw new ApiError(refuse[name], 409, null);
  return value;
};
mock.module("../../src/services/worlds-api", () => ({
  worldsApi: {
    open: async (spec: unknown) => {
      calls.push(`open:${JSON.stringify(spec)}`);
      return { defHash: "0xdef", specHash: "0xspec", book: 7, status: "live" };
    },
    opened: async () => {
      calls.push("opened");
      return { book: 7, status: "live", tradable: true };
    },
    book: async (id: number) => {
      calls.push(`book:${id}`);
      return book;
    },
    rfq: {
      open: async (order: Record<string, unknown>) => {
        calls.push(`rfq.open:${JSON.stringify(order)}`);
        const now = Date.now();
        current = {
          id: `rfq${nextId++}`,
          status: "open",
          reason: null,
          book: 7,
          order,
          now,
          createdAt: now,
          expiresAt: now + 900_000,
          closedAt: null,
          makers: 1,
          received: 1,
          quotes: [quote("vault", 84.2)],
          fill: null,
        };
        return answer("rfq.open", current);
      },
      read: async (_owner: string, id: string) => {
        calls.push(`rfq.read:${id}`);
        return current;
      },
      accept: async (id: string, quoteId: string, clientId: string) => {
        calls.push(`rfq.accept:${id}:${quoteId}:${clientId.length}`);
        return answer("rfq.accept", { transactionHash: "0xfill" });
      },
      decline: async (id: string, quoteId: string) => {
        calls.push(`rfq.decline:${id}:${quoteId}`);
        return frame({ quotes: current!.quotes.filter((q) => q.id !== quoteId) });
      },
      again: async (id: string) => {
        calls.push(`rfq.again:${id}`);
        return frame({ quotes: [quote("vault", 83.5)], received: current!.received + 1 });
      },
      cancel: async (id: string, leaving = false) => {
        calls.push(`rfq.cancel:${id}${leaving ? ":leaving" : ""}`);
        return frame({ status: "cancelled", quotes: [] });
      },
      follow: (_owner: string, signal: AbortSignal, onRfq: (rfq: Rfq) => void) => {
        streams++;
        push = onRfq;
        return new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => {
            if (push === onRfq) push = null;
            resolve();
          }),
        );
      },
    },
  },
}));

const { ApiError } = await import("../../src/services/api");
const { createRoot } = await import("react-dom/client");
const { WorldTicket } = await import("../../src/components/worlds/WorldTicket");

const host = document.createElement("div");
document.body.appendChild(host);
let root = createRoot(host);
const settle = async (ms = 60) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
const sentence = {
  legs: [{ label: "The Fed cuts in December", wantYes: true }],
  stock: { symbol: "NVDA", direction: "above" as const, strike: "240", date: "2026-12-11" },
};
const render = async (world: unknown = { kind: "book", book }) => {
  await act(async () =>
    root.render(<WorldTicket world={world as never} sentence={sentence} direction="above" />),
  );
  await settle();
};
const page = () => host.textContent ?? "";
const button = (label: string | RegExp) =>
  [...host.querySelectorAll("button")].find((b) =>
    typeof label === "string" ? b.textContent?.trim() === label : label.test(b.textContent ?? ""),
  ) ?? null;
const rows = () => [...host.querySelectorAll("li[data-quote]")] as HTMLElement[];
/** A row's button, by its words. */
const inRow = (row: HTMLElement | undefined, label: string) =>
  [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label) ?? null;
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await settle(80);
}
/** A stream frame, as the API would push it. */
async function stream(next: Rfq) {
  expect(push).not.toBeNull();
  await act(async () => push?.(next));
  await settle();
}
const place = () => click(button(/^Place \$/));

afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  calls.length = 0;
  toasts.length = 0;
  errors.length = 0;
  refuse = {};
  current = null;
});
afterAll(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
});

test("until Place nothing is asked; Place sends one order and the board shows the quote", async () => {
  await render();
  // The ticket as before: an estimate from the world's live prices, and no call of its own.
  expect(page()).toContain("If you're right");
  expect(button(/^Place \$20/)).not.toBeNull();
  expect(calls).toEqual([]);
  expect(streams).toBe(0);
  await place();
  // The world exists: one call opens the order (the fee comes out of the $20), for any price.
  expect(calls).toEqual([
    `rfq.open:${JSON.stringify({ book: 7, mask: 4, side: "buy", stake: "19801980", conditional: false, limit: "0" })}`,
  ]);
  expect(streams).toBe(1);
  expect(errors).toEqual([]);
  // The board: how long the order stays open, the order said once, and the table of quotes.
  expect(page()).toContain("Choose a quote");
  expect(page()).toMatch(/Order open for1[45]:\d\d/);
  expect(page()).toContain("All-inYou pay $20");
  expect(page()).toContain("All-inYou pay $20$0.20 fee includedMaker");
  expect(rows()).toHaveLength(1);
  const row = rows()[0]!;
  expect(row.textContent).toContain("World vault");
  expect(row.textContent).toContain("$84.20");
  expect(row.textContent).toContain("4.2×");
  expect(row.textContent).toMatch(/Price held for[45]:\d\d/);
  // Each quote has its own two buttons; the order has its own way out.
  expect(inRow(row, "Accept")?.hasAttribute("disabled")).toBe(false);
  expect(inRow(row, "Decline")).not.toBeNull();
  expect(button("Cancel order")).not.toBeNull();
  // Accept asks once more on the same row, in the order's own terms; Back undoes it; no call yet.
  await click(inRow(row, "Accept"));
  expect(row.textContent).toContain("You pay $20 now and get $84.20 if you're right.");
  expect(inRow(row, "Confirm")).not.toBeNull();
  await click(inRow(row, "Back"));
  expect(inRow(row, "Accept")).not.toBeNull();
  expect(calls).toHaveLength(1);
  expect(page()).toContain("Nothing is charged until you accept a quote.");
  expect(page()).toContain("Open to 1 maker");
  // With one quote there is no "best" to mark.
  expect(page()).not.toContain("Best");
});

test("rows keep their place as quotes arrive and change; the best is marked", async () => {
  await render();
  await place();
  const vault = current!.quotes[0]!;
  // Another maker quotes more: the API lists it first, the board keeps the vault's row on top.
  const desk = quote("desk", 86, 60);
  await stream(frame({ quotes: [desk, vault], makers: 2, received: 2 }));
  expect(rows().map((r) => r.textContent?.includes("World vault"))).toEqual([true, false]);
  expect(rows().map((r) => r.textContent?.includes("Best"))).toEqual([false, true]);
  expect(rows()[1]!.textContent).toMatch(/Price held for[01]:\d\d/);
  expect(page()).toContain("Open to 2 makers");
  // A new row's Accept is live at once; nothing about the other row changed.
  expect(inRow(rows()[1], "Accept")?.hasAttribute("disabled")).toBe(false);
  expect(inRow(rows()[0], "Accept")?.hasAttribute("disabled")).toBe(false);
  // The vault replaces its quote: its row updates where it stands, and its Accept rests a
  // moment, so a tap meant for the old price cannot take the new one.
  const replaced = quote("vault", 81);
  await stream(frame({ quotes: [desk, replaced], received: 3 }));
  expect(rows().map((r) => r.textContent?.includes("World vault"))).toEqual([true, false]);
  expect(rows()[0]!.textContent).toContain("$81");
  expect(inRow(rows()[0], "Updated")?.hasAttribute("disabled")).toBe(true);
  expect(inRow(rows()[1], "Accept")?.hasAttribute("disabled")).toBe(false);
  await settle(1_400);
  expect(inRow(rows()[0], "Accept")?.hasAttribute("disabled")).toBe(false);
  // A quote that cannot fill says why, and cannot be accepted.
  await stream(
    frame({ quotes: [desk, { ...replaced, problem: "QuoteEpoch: a stale quote epoch" }] }),
  );
  expect(rows()[0]!.textContent).toContain("Can't be filled right now");
  expect(inRow(rows()[0], "Accept")?.hasAttribute("disabled")).toBe(true);
  // A row being confirmed whose quote is replaced goes back to asking: never the new price on
  // the old tap.
  await click(inRow(rows()[1], "Accept"));
  expect(inRow(rows()[1], "Confirm")).not.toBeNull();
  const better = quote("desk", 88, 2);
  await stream(frame({ quotes: [better, replaced] }));
  expect(inRow(rows()[1], "Confirm")).toBeNull();
  expect(rows()[1]!.textContent).toContain("$88");
  // That quote runs out in two seconds: it stays in its row, greyed, where its maker's next
  // quote would take its place; then the row goes. The vault's row never moved.
  await settle(2_300);
  expect(rows()).toHaveLength(2);
  expect(rows()[1]!.textContent).toContain("Expired");
  expect(inRow(rows()[1], "Accept")).toBeNull();
  await stream(frame({ quotes: [replaced] }));
  expect(rows()[1]!.textContent).toContain("Expired");
  const renewed = quote("desk", 85, 120);
  await stream(frame({ quotes: [renewed, replaced] }));
  expect(rows().map((r) => r.textContent?.includes("World vault"))).toEqual([true, false]);
  expect(rows()[1]!.textContent).toContain("$85");
  expect(rows()[1]!.textContent).not.toContain("Expired");
  // No call was made for any of it: the stream carried every change.
  expect(calls).toHaveLength(1);
});

test("accepting fills that quote once and shows the bet; declining one tells the API", async () => {
  await render();
  await place();
  const vault = current!.quotes[0]!;
  const desk = quote("desk", 80, 120);
  await stream(frame({ quotes: [vault, desk], makers: 2, received: 2 }));
  calls.length = 0;
  // Declining the other maker's quote removes its row.
  await click(host.querySelector('[aria-label="Decline Desk one\'s quote"]'));
  expect(calls).toEqual([`rfq.decline:${current!.id}:${desk.id}`]);
  expect(rows()).toHaveLength(1);
  calls.length = 0;
  // A refused accept (the quote just went) leaves the board up, with the reason.
  refuse = { "rfq.accept": "This quote is no longer available. Choose another, or ask again." };
  await click(inRow(rows()[0], "Accept"));
  expect(calls).toEqual([]);
  await click(inRow(rows()[0], "Confirm"));
  expect(errors).toEqual([
    "This quote is no longer available. Choose another, or ask again. Nothing was charged.",
  ]);
  expect(page()).toContain("Choose a quote");
  refuse = {};
  await click(inRow(rows()[0], "Confirm"));
  // The same quote is asked for with the same request id both times, so it can never fill twice.
  expect(calls).toEqual([
    `rfq.accept:${current!.id}:${vault.id}:36`,
    `rfq.accept:${current!.id}:${vault.id}:36`,
    "account:refresh",
  ]);
  expect(page()).toContain("You're in");
  expect(page()).toContain("All-in · quoted by World vault");
  expect(page()).toContain("You paid$20");
  expect(page()).toContain("If you're right$84.20");
  // The order is done: its stream is closed, and nothing is cancelled on the way out.
  expect(push).toBeNull();
  calls.length = 0;
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(calls).toEqual([]);
});

test("with no quote on the board it says what it is waiting for, and asks again on request", async () => {
  await render();
  await place();
  calls.length = 0;
  // The vault took its quote back: the row stays a moment, greyed, in case it sends another.
  await stream(frame({ quotes: [] }));
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.textContent).toContain("Taken back");
  expect(page()).toContain("Getting your quotes");
  expect(page()).toContain("Waiting for a new quote");
  expect(button("Ask again")).toBeNull();
  // None came: the row goes, and the board offers to ask.
  await settle(4_200);
  expect(rows()).toHaveLength(0);
  expect(page()).toContain("No quote at the moment");
  await click(button("Ask again"));
  expect(calls).toEqual([`rfq.again:${current!.id}`]);
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.textContent).toContain("$83.50");
  // Turning the only quote down leaves nothing to wait for: the offer to ask again is there at once.
  await click(inRow(rows()[0], "Decline"));
  expect(rows()).toHaveLength(0);
  expect(page()).toContain("You turned that quote down");
  expect(page()).toContain("Your order is still open");
  expect(button("Ask again")).not.toBeNull();
  // An order no maker has answered after a while, and one with nobody online to answer.
  await stream(frame({ quotes: [], received: 0, createdAt: Date.now() - 10_000 }));
  expect(page()).toContain("No maker has quoted yet");
  expect(button("Ask again")).not.toBeNull();
  await stream(frame({ quotes: [], makers: 0 }));
  expect(page()).toContain("No maker is online right now");
  expect(button("Ask again")).toBeNull();
});

test("cancelling ends the order and brings the ticket back; an order that ran out can be asked again", async () => {
  await render();
  await place();
  const first = current!.id;
  calls.length = 0;
  await click(button("Cancel order"));
  expect(calls).toEqual([`rfq.cancel:${first}`]);
  expect(toasts).toEqual(["Order cancelled. Nothing was charged."]);
  expect(button(/^Place \$20/)).not.toBeNull();
  expect(push).toBeNull();
  // A new order, which nobody accepts in time.
  await place();
  const second = current!.id;
  expect(second).not.toBe(first);
  await stream(frame({ status: "expired", quotes: [], reason: "The request ran out" }));
  expect(page()).toContain("Your order ran out");
  expect(page()).toContain("No quote was accepted in time, so nothing was charged.");
  calls.length = 0;
  await click(button("Ask for quotes again"));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toStartWith("rfq.open:");
  expect(page()).toContain("Choose a quote");
  // Or back to the ticket to change it.
  await stream(frame({ status: "expired", quotes: [] }));
  await click(button("Change the order"));
  expect(button(/^Place \$20/)).not.toBeNull();
});

test("leaving the ticket cancels an open order; an order filled elsewhere shows its bet", async () => {
  await render();
  await place();
  const id = current!.id;
  calls.length = 0;
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(calls).toEqual([`rfq.cancel:${id}:leaving`]);
  // The answer to an accept was lost, and the stream says the order filled.
  await render();
  await place();
  calls.length = 0;
  await stream(
    frame({
      status: "filled",
      quotes: [],
      fill: {
        quote: "q",
        maker: "World vault",
        units: "84200000",
        refund: "0",
        price: "19801980",
        transactionHash: "0xfill",
      },
    }),
  );
  expect(page()).toContain("You're in");
  expect(page()).toContain("If you're right$84.20");
  expect(calls).toEqual(["account:refresh"]);
});

test("a new world is opened by Place, then its order goes out", async () => {
  const spec = { legs: [{ id: "polymarket:1", wantYes: true }], stock: null };
  const preview = {
    world: { feeBps: 100, legs: [{ endTime: "2026-12-10T05:00:00.000Z" }] },
    problems: [],
    existing: null,
    marks: [700_000, 80_000, 220_000],
    offer: [
      {
        key: "bet:above:1",
        name: "All-in",
        stake: "19801980",
        units: "84000000",
        payout: "84000000",
        ask: 240_000,
        decline: null,
        endings: [],
      },
    ],
  };
  await render({ kind: "draft", spec, preview, pricing: false });
  expect(calls).toEqual([]);
  await place();
  // The world is opened, read once for its product, and the order sent: three calls.
  expect(calls).toEqual([
    `open:${JSON.stringify(spec)}`,
    "book:7",
    `rfq.open:${JSON.stringify({ book: 7, mask: 4, side: "buy", stake: "19801980", conditional: false, limit: "0" })}`,
  ]);
  expect(page()).toContain("Choose a quote");
});
