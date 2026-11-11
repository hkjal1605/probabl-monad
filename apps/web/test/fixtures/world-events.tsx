/** A world's events, edited in its sentence on the worlds page, in a browser-like DOM. The
 * sentence holds the events chosen and nothing else: an event removed goes with its place, the
 * last one leaves one selector asking for an event, "+ event" opens the search, and one event is
 * a world a bet can be placed on. The page's examples (curated worlds, or live events) are the
 * person's from their first change. */
import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, type ReactNode } from "react";
import type { LegEntry, Preview, Stock } from "../../src/lib/worlds/types";

const dom = new Window({ url: "http://localhost:3001/worlds" });
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
// A wide screen, and a reader who asked for less motion: the examples stay on their first set.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
});

const event = (id: string, label: string): LegEntry => ({
  id: `polymarket:${id}`,
  source: "polymarket",
  marketId: id,
  question: `Will ${label}?`,
  label,
  event: id,
  outcome: null,
  yes: 0.4,
  bid: 0.39,
  ask: 0.41,
  endTime: "2026-12-10T19:00:00Z",
  url: `https://polymarket.com/event/${id}`,
  image: null,
  rules: "",
  exclusive: false,
  group: id,
  volume: 1_000_000,
  themes: [],
});
const FED = event("fed", "The Fed cuts in December");
const NVDA_BEATS = event("nvda", "Nvidia beats earnings");
const BTC = event("btc", "Bitcoin tops $150k");
const ETF = event("etf", "A Solana ETF is approved");
const CPI = event("cpi", "Inflation falls under 3%");
const DEAL = event("deal", "A trade deal is signed");
const OIL = event("oil", "Oil closes above $90");
const SAMPLES = [CPI, DEAL, OIL, FED];

const NVDA: Stock = {
  underlying: "NASDAQ:NVDA",
  symbol: "NVDA",
  name: "Nvidia",
  kind: "stock",
  logo: null,
  spot: 200,
};
const curated = (story: string, legs: LegEntry[]): Preview =>
  ({
    world: {
      legs: legs.map((l) => ({ ...l, wantYes: true })),
      stock: {
        underlying: NVDA.underlying,
        symbol: "NVDA",
        name: "Nvidia",
        direction: "above",
        strike: "240",
        date: "2026-12-11",
        spot: 200,
      },
    },
    curated: { story, short: legs.map((l) => l.label) },
  }) as unknown as Preview;

/** What the samples read answers: the curated worlds (none: the page shows live events). */
let worlds: Preview[] = [];
let sampleEvents: LegEntry[] = SAMPLES;
const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
mock.module("../../src/services/worlds-api", () => ({
  worldsApi: {
    stocks: async () => ({ stocks: [NVDA], maxTenor: 365 * 86_400 }),
    samples: async () => ({ events: sampleEvents, worlds }),
    // "sol" finds the Solana event, and one already in the world (never offered again).
    searchEvents: async (q: string) => (q.includes("sol") ? [ETF, NVDA_BEATS] : []),
  },
}));

const { createRoot } = await import("react-dom/client");
const { WorldStarter } = await import("../../src/modules/WorldsPageModule/components/WorldStarter");
const { EditableSentence } = await import("../../src/components/worlds/EditableSentence");

const host = document.createElement("div");
document.body.appendChild(host);
let root = createRoot(host);
const settle = (ms = 60) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
async function click(element: Element | null | undefined) {
  expect(element ?? null).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await settle(80);
}
async function start() {
  await act(async () => root.render(<WorldStarter />));
  await settle(120);
}
const button = (scope: Element | null | undefined, label: string) =>
  [...(scope?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label) ??
  null;

/** The sentence the reader sees (not the unseen layouts of the other example sets). */
const live = () => host.querySelector("div.grid > div:not(.invisible)") as HTMLElement;
/** The events chosen, as their chips read. */
const chosen = () =>
  [...live().querySelectorAll('[data-atom^="leg-"]')].map((el) => el.textContent ?? "");
/** The places still asking for an event (or showing an example of one). */
const slots = () => [...live().querySelectorAll('[data-slot="event"]')] as HTMLElement[];
const slotText = () => slots().map((el) => el.textContent ?? "");
const placeBet = () => button(host, "Place bet") as HTMLButtonElement;
const addEvent = () => live().querySelector('[data-atom="add"]') as HTMLButtonElement;
/** The picker open now: a chip's popover, or the "Add an event" dialog. */
const popover = () => document.querySelector('[data-slot="popover-content"]');
const dialog = () => document.querySelector('[data-slot="dialog-content"]');
/** Picks a suggested event in the open picker. */
const pickIn = async (scope: Element | null, question: string) => {
  const row = [...(scope?.querySelectorAll(".line-clamp-2") ?? [])].find(
    (el) => el.textContent === question,
  );
  await click(row);
};
const closePicker = async () => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle(300);
};
const chipOf = (label: string) =>
  [...live().querySelectorAll('[data-atom^="leg-"]')].find((el) => el.textContent === label);
const removeChosen = async (label: string) => {
  await click(chipOf(label));
  await click(button(popover(), "Remove this event"));
  await settle(300);
};

/** The questions offered in the open picker, as its rows read. */
const offeredIn = (scope: Element | null) =>
  [...(scope?.querySelectorAll(".line-clamp-2") ?? [])].map((el) => el.textContent ?? "");
/** Types into the open picker's search, and waits for what it finds. */
async function search(scope: Element | null, text: string) {
  const input = scope?.querySelector('input[type="search"]') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(450);
}

afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  worlds = [];
  sampleEvents = SAMPLES;
  pushed.length = 0;
});
afterAll(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
});

test("an example event removed is gone, the last event leaves one selector, and + event adds", async () => {
  worlds = [curated("AI boom", [FED, NVDA_BEATS]), curated("Crypto", [BTC, ETF])];
  await start();
  // The curated world on screen: an example in each event's place, nothing the reader's yet.
  expect(slotText()).toEqual(["the Fed cuts in December", "Nvidia beats earnings"]);
  expect(chosen()).toEqual([]);
  expect(placeBet().disabled).toBeTrue();

  // Removing one example: it goes with its place, and the rest of that world is the reader's.
  await click(slots()[0]);
  await click(button(popover(), "Remove this event"));
  await settle(300);
  expect(chosen()).toEqual(["Nvidia beats earnings"]);
  expect(slots()).toHaveLength(0);
  expect(live().textContent).not.toContain(" and ");
  // One event is a world: the bet can be placed.
  expect(placeBet().disabled).toBeFalse();

  // Removing the only event: one selector asks for an event (no example, nothing cycling).
  await removeChosen("Nvidia beats earnings");
  expect(chosen()).toEqual([]);
  expect(slotText()).toEqual(["Select an event"]);
  expect(slots()[0]?.getAttribute("data-sample")).toBe("");
  expect(placeBet().disabled).toBeTrue();
  // The only selector cannot be removed; it offers live events to start from.
  await click(slots()[0]);
  expect(button(popover(), "Remove this event")).toBeNull();
  expect(popover()?.textContent).toContain("Will Inflation falls under 3%?");
  await pickIn(popover(), "Will A trade deal is signed?");
  await settle(300);
  expect(chosen()).toEqual(["a trade deal is signed"]);
  expect(slots()).toHaveLength(0);
  expect(placeBet().disabled).toBeFalse();

  // + event opens the search; the event picked joins the end. No blank place is ever left.
  await click(addEvent());
  expect(dialog()?.textContent).toContain("Add an event");
  // An event already in the world is not offered again.
  expect(dialog()?.textContent).not.toContain("Will A trade deal is signed?");
  await pickIn(dialog(), "Will Oil closes above $90?");
  await settle(300);
  expect(chosen()).toEqual(["a trade deal is signed", "Oil closes above $90"]);
  expect(slots()).toHaveLength(0);

  // With more than one, a removed event is taken out whole: no placeholder in its place.
  await removeChosen("a trade deal is signed");
  expect(chosen()).toEqual(["Oil closes above $90"]);
  expect(slots()).toHaveLength(0);

  await click(placeBet());
  expect(pushed).toHaveLength(1);
  const spec = JSON.parse(decodeURIComponent((pushed[0] ?? "").split("?w=")[1] ?? "{}"));
  expect(spec.legs).toEqual([{ id: OIL.id, wantYes: true }]);
  expect(spec.stock.underlying).toBe("NASDAQ:NVDA");
});

test("+ event on the selector fills it, and closing the search changes nothing", async () => {
  worlds = [curated("AI boom", [FED, NVDA_BEATS]), curated("Crypto", [BTC, ETF])];
  await start();
  // + event on a curated world: that world is the one the event joins, so it is the reader's.
  await click(addEvent());
  expect(dialog()).not.toBeNull();
  await closePicker();
  expect(dialog()).toBeNull();
  expect(chosen()).toEqual(["the Fed cuts in December", "Nvidia beats earnings"]);
  expect(slots()).toHaveLength(0);
  expect(placeBet().disabled).toBeFalse();

  await removeChosen("the Fed cuts in December");
  await removeChosen("Nvidia beats earnings");
  expect(slotText()).toEqual(["Select an event"]);
  // + event with no event yet: the event picked takes the selector's place (never a second one).
  await click(addEvent());
  await closePicker();
  expect(slotText()).toEqual(["Select an event"]);
  expect(chosen()).toEqual([]);
  await click(addEvent());
  await pickIn(dialog(), "Will Inflation falls under 3%?");
  await settle(300);
  expect(chosen()).toEqual(["Inflation falls under 3%"]);
  expect(slots()).toHaveLength(0);
});

test("an event picked in a curated world's place changes that event and keeps the rest", async () => {
  worlds = [curated("AI boom", [FED, NVDA_BEATS]), curated("Crypto", [BTC, ETF])];
  await start();
  await click(slots()[1]);
  await pickIn(popover(), "Will A Solana ETF is approved?");
  await settle(300);
  expect(chosen()).toEqual(["the Fed cuts in December", "a Solana ETF is approved"]);
  expect(slots()).toHaveLength(0);
  expect(placeBet().disabled).toBeFalse();
});

test("without curated worlds, the first event picked is the world: no second one is asked for", async () => {
  await start();
  // Two live events as examples, each in an event's place.
  expect(slots()).toHaveLength(2);
  expect(chosen()).toEqual([]);
  expect(placeBet().disabled).toBeTrue();
  const other = slotText()[1];
  await click(slots()[0]);
  // Each example's search offers the live events it steps through.
  await pickIn(popover(), "Will Inflation falls under 3%?");
  await settle(300);
  // The reader's world is the event they picked. The other example is gone, not left to fill.
  expect(chosen()).toEqual(["Inflation falls under 3%"]);
  expect(slots()).toHaveLength(0);
  expect(live().textContent).not.toContain(other ?? "?");
  expect(placeBet().disabled).toBeFalse();
});

test("without curated worlds, an example removed leaves one fewer, and the last one stays", async () => {
  await start();
  await click(slots()[1]);
  await click(button(popover(), "Remove this event"));
  await settle(300);
  expect(slots()).toHaveLength(1);
  expect(chosen()).toEqual([]);
  await click(slots()[0]);
  expect(button(popover(), "Remove this event")).toBeNull();
});

test("with nothing to show as an example, the sentence asks for an event once", async () => {
  sampleEvents = [];
  await start();
  expect(slotText()).toEqual(["Select an event"]);
  expect(placeBet().disabled).toBeTrue();
});

test("a world takes four events: + event is off at four and back on under it", async () => {
  worlds = [
    curated("Four", [FED, NVDA_BEATS, BTC, ETF]),
    curated("Other", [CPI, DEAL, OIL, event("x", "Something else happens")]),
  ];
  await start();
  await click(button(host, "Four"));
  expect(chosen()).toHaveLength(4);
  expect(addEvent().disabled).toBeTrue();
  await removeChosen("Bitcoin tops $150k");
  expect(chosen()).toHaveLength(3);
  expect(addEvent().disabled).toBeFalse();
});

test("an event is swapped for another in one step, in its own dropdown, keeping its place", async () => {
  worlds = [curated("AI boom", [FED, NVDA_BEATS]), curated("Crypto", [BTC, ETF])];
  await start();
  await click(button(host, "AI boom"));
  expect(chosen()).toEqual(["the Fed cuts in December", "Nvidia beats earnings"]);

  // The event's dropdown: the event, the side it needs, the search for another, its removal.
  await click(chipOf("the Fed cuts in December"));
  const dropdown = popover();
  expect(dropdown?.textContent).toContain("Will The Fed cuts in December?");
  expect(button(dropdown, "It doesn't happen")).not.toBeNull();
  const field = dropdown?.querySelector('input[type="search"]') as HTMLInputElement | null;
  expect(field?.placeholder).toBe("Swap for another event");
  expect(button(dropdown, "Remove this event")).not.toBeNull();
  // It offers live events to take this one's place: never one already in the world.
  expect(dropdown?.textContent).toContain("Live on Polymarket");
  expect(offeredIn(dropdown)).toEqual([
    "Will Inflation falls under 3%?",
    "Will A trade deal is signed?",
    "Will Oil closes above $90?",
  ]);
  await pickIn(dropdown, "Will Oil closes above $90?");
  await settle(300);
  // One step: the event picked stands where the other stood, and the dropdown is closed.
  expect(chosen()).toEqual(["Oil closes above $90", "Nvidia beats earnings"]);
  expect(popover()).toBeNull();
  expect(slots()).toHaveLength(0);
  expect(placeBet().disabled).toBeFalse();

  // Or by searching, from the second event's dropdown.
  await click(chipOf("Nvidia beats earnings"));
  await search(popover(), "sol");
  expect(offeredIn(popover())).toEqual(["Will A Solana ETF is approved?"]);
  expect(button(popover(), "Use")).not.toBeNull();
  await pickIn(popover(), "Will A Solana ETF is approved?");
  await settle(300);
  expect(chosen()).toEqual(["Oil closes above $90", "a Solana ETF is approved"]);
});

test("an event the words may have meant keeps the side asked; any other starts as it happens", async () => {
  const changes: { id: string; wantYes: boolean; alternatives: string[] }[] = [];
  const sentence = (
    <EditableSentence
      legs={[{ entry: FED, wantYes: false, note: null, alternatives: [CPI] }]}
      stock={null}
      dates={{ earliest: "2026-11-11", last: "2027-11-05", suggested: null }}
      suggestions={[DEAL]}
      onLeg={(_, leg) =>
        changes.push({
          id: leg.entry.id,
          wantYes: leg.wantYes,
          alternatives: leg.alternatives.map((a) => a.id),
        })
      }
      onRemoveLeg={() => {}}
      onAddEvent={() => {}}
      onStock={() => {}}
    />
  );
  await act(async () => root.render(sentence));
  const chip = () => host.querySelector('[data-atom^="leg-"]');
  await click(chip());
  // Both lists, the ones meant first; a snug dropdown has no room kept for an empty list.
  expect(popover()?.textContent).toContain("Or did you mean");
  expect(offeredIn(popover())).toEqual([
    "Will Inflation falls under 3%?",
    "Will A trade deal is signed?",
  ]);
  await pickIn(popover(), "Will Inflation falls under 3%?");
  await settle(300);
  // The same question asked another way: its side stays, and the first stays among the ones meant.
  expect(changes).toEqual([{ id: CPI.id, wantYes: false, alternatives: [FED.id] }]);

  await click(chip());
  await pickIn(popover(), "Will A trade deal is signed?");
  await settle(300);
  // Another event altogether: it starts as "it happens", with nothing it may have meant.
  expect(changes[1]).toEqual({ id: DEAL.id, wantYes: true, alternatives: [] });
});

test("with nothing to offer yet, an event's dropdown shows the search field and no empty list", async () => {
  await act(async () =>
    root.render(
      <EditableSentence
        legs={[{ entry: FED, wantYes: true, note: null, alternatives: [] }]}
        stock={null}
        dates={{ earliest: "2026-11-11", last: "2027-11-05", suggested: null }}
        onLeg={() => {}}
        onRemoveLeg={() => {}}
        onAddEvent={() => {}}
        onStock={() => {}}
      />,
    ),
  );
  await click(host.querySelector('[data-atom^="leg-"]'));
  expect(popover()?.querySelector('input[type="search"]')).not.toBeNull();
  expect(offeredIn(popover())).toEqual([]);
  expect(popover()?.textContent).not.toContain("Polymarket and Kalshi events");
  // The only event can still be removed (the sentence then asks for one).
  expect(button(popover(), "Remove this event")).not.toBeNull();
});
