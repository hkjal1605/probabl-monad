import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { LegEntry } from "../../src/lib/worlds/types";

const dom = new Window({ url: "http://localhost:3001" });
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

// The screen: a phone or not, as `usePhone` asks it.
let phone = false;
const { PHONE_QUERY } = await import("../../src/hooks/usePhone");
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: query === PHONE_QUERY ? phone : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
});

const { createRoot } = await import("react-dom/client");
const { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } = await import(
  "../../src/components/ui/responsive-popover"
);
const { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle } =
  await import("../../src/components/ui/responsive-dialog");
const { useInSheet } = await import("../../src/components/ui/drawer");
const { EventRow } = await import("../../src/components/worlds/EventSearch");

const host = document.createElement("div");
document.body.appendChild(host);
let root = createRoot(host);

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}
const render = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
};

function Where() {
  return <span data-testid="where">{useInSheet() ? "sheet" : "popover"}</span>;
}
function Picker() {
  return (
    <ResponsivePopover>
      <ResponsivePopoverTrigger data-testid="trigger">Pick</ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Choose a stock" done>
        <Where />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  phone = false;
});
afterAll(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
});

test("a picker opens under its trigger on a wide screen", async () => {
  await render(<Picker />);
  await click(document.querySelector('[data-testid="trigger"]'));
  expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
  expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("popover");
  // Named for assistive technology, without a visible heading or a Done button.
  expect(document.querySelector('[data-slot="popover-title"]')?.className).toContain("sr-only");
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent === "Done"),
  ).toBeFalse();
});

test("on a phone the same picker is a bottom sheet with its title and a way to close it", async () => {
  phone = true;
  await render(<Picker />);
  const trigger = document.querySelector('[data-testid="trigger"]');
  await click(trigger);
  const sheet = document.querySelector('[data-slot="drawer-content"]');
  expect(sheet).not.toBeNull();
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  expect(sheet?.querySelector('[data-slot="drawer-title"]')?.textContent).toBe("Choose a stock");
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("sheet");
  // The trigger says its picker is open (the worlds page holds its samples while one is).
  expect(trigger?.hasAttribute("data-popup-open")).toBeTrue();
  const done = [...(sheet?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Done");
  await click(done ?? null);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  expect(trigger?.hasAttribute("data-popup-open")).toBeFalse();
});

test("a dialog is a centred card on a wide screen and a bottom sheet on a phone", async () => {
  for (const onPhone of [false, true]) {
    phone = onPhone;
    await render(
      <ResponsiveDialog open onOpenChange={() => {}}>
        <ResponsiveDialogContent
          header={
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Rules</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
          }
        >
          <Where />
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(document.querySelector('[data-slot="dialog-content"]') !== null).toBe(!onPhone);
    expect(document.querySelector('[data-slot="drawer-content"]') !== null).toBe(onPhone);
    expect(document.querySelector('[data-testid="where"]')?.textContent).toBe(
      onPhone ? "sheet" : "popover",
    );
    await act(async () => root.unmount());
    root = createRoot(host);
  }
});

test("an event row is picked by a tap anywhere on it, once, and never when it can't be", async () => {
  const event: LegEntry = {
    id: "polymarket:1",
    source: "polymarket",
    marketId: "1",
    question: "Will the Fed cut in December?",
    label: "The Fed cuts in December",
    event: "fed-december",
    outcome: null,
    yes: 0.4,
    bid: 0.39,
    ask: 0.41,
    endTime: "2026-12-10T19:00:00Z",
    url: "https://polymarket.com/event/fed",
    image: null,
    rules: "",
    exclusive: false,
    group: "fed-december",
    volume: 1_000_000,
    themes: [],
  };
  const picks: string[] = [];
  const onPick = (e: { id: string }) => picks.push(e.id);
  await render(
    <>
      <EventRow event={event} onPick={onPick} action="Use" />
      <EventRow event={{ ...event, id: "polymarket:2", yes: 0.99 }} onPick={onPick} />
    </>,
  );
  const [open, decided] = [...document.querySelectorAll(".line-clamp-2")];
  await click(open ?? null);
  expect(picks).toEqual(["polymarket:1"]);
  // Its button picks it once (the row doesn't pick it again).
  const use = [...document.querySelectorAll("button")].find((b) => b.textContent === "Use");
  await click(use ?? null);
  expect(picks).toEqual(["polymarket:1", "polymarket:1"]);
  // The venue link opens the venue, not the pick.
  const link = document.querySelector('a[aria-label="Open on the venue"]');
  link?.addEventListener("click", (e) => e.preventDefault());
  await click(link);
  expect(picks).toHaveLength(2);
  // A decided event can't be picked from its row.
  await click(decided ?? null);
  expect(picks).toHaveLength(2);
});
