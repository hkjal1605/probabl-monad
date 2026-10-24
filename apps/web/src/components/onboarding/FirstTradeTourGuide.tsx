"use client";
import { ArrowRight, MousePointerClick, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { useQuotePrices } from "@/hooks/useQuotePrices";
import {
  fullyQuoted,
  pickTourMarket,
  TOUR_STEPS,
  type TourStep,
  tourPage,
} from "@/lib/first-trade-tour";
import { cn } from "@/lib/utils";
import { finishFirstTradeTour, reachTourStep, skipFirstTradeTour } from "@/stores/first-trade-tour";

/** Viewport margin, gap to the target, the ring's padding around it, the card's width. */
const MARGIN = 12,
  GAP = 12,
  PAD = 6,
  CARD_WIDTH = 300;
/** Below md the card docks at the bottom of the screen instead of beside its target. */
const PHONE = "(max-width: 767px)";

type Box = { top: number; left: number; width: number; height: number };
type Place = "left" | "below" | "above";

const visible = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && el.getClientRects().length > 0;
function union(els: HTMLElement[]): Box {
  const rects = els.map((el) => el.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top)),
    left = Math.min(...rects.map((r) => r.left));
  return {
    top,
    left,
    width: Math.max(...rects.map((r) => r.right)) - left,
    height: Math.max(...rects.map((r) => r.bottom)) - top,
  };
}
const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);
const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));
/** What a page pins over its content: the markets list's header and filters above, a market
 * page's view bar below (phones). */
function pinned() {
  const top =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--home-sticky"),
    ) || 0;
  const bar = document.querySelector(".market-view-bar");
  return { top, bottom: visible(bar) ? bar.offsetHeight : 0 };
}
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The first-trade tour (research-led: four action-driven steps, no dimmed screen, skippable
 * at every step): the markets list asks for a market; a market page then goes through its
 * ticket. The step shown follows the page, so leaving for another page only hides it. */
export function FirstTradeTourGuide({ reached }: { reached: TourStep }) {
  const pathname = usePathname();
  const page = tourPage(pathname),
    onMarket = page === "market";
  const step: TourStep | null = onMarket
    ? reached === "market"
      ? "side"
      : reached
    : page === "list"
      ? "market"
      : null;
  useEffect(() => {
    if (onMarket) reachTourStep("side");
  }, [onMarket]);
  // Escape ends the tour, unless it closes something else (a dialog) first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]:not([data-tour-card]), [role="alertdialog"]'))
        return;
      skipFirstTradeTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      {step === "market" ? <MarketStep /> : step ? <TicketStep key={pathname} step={step} /> : null}
      {/* One live region for the whole tour: a new step is announced without taking focus. */}
      <span className="sr-only" role="status">
        {step
          ? `Trading guide, step ${TOUR_STEPS.indexOf(step) + 1} of ${TOUR_STEPS.length}: ${TITLES[step]}`
          : ""}
      </span>
    </>
  );
}

const TITLES: Record<TourStep, string> = {
  market: "Pick a market",
  side: "Choose YES or NO",
  amount: "Enter an amount",
  submit: "Place your order",
};

/** Step 1, on the markets list: the first market the vaults quote on both sides. */
function MarketStep() {
  const quotes = useQuotePrices();
  const quoted = useMemo(() => fullyQuoted(quotes.data?.prices ?? []), [quotes.data]);
  // The row first pointed at stays the one, while it is on the page.
  const chosen = useRef<string | null>(null);
  const find = () => {
    const rows = [...document.querySelectorAll("[data-tour-market]")]
      .filter(visible)
      .map((el) => ({ el, marketId: el.dataset.tourMarket ?? "" }));
    const row =
      rows.find((r) => r.marketId === chosen.current) ??
      (quotes.data || quotes.isError ? pickTourMarket(rows, quoted) : null);
    if (row) chosen.current = row.marketId;
    return row ? [row.el] : [];
  };
  return (
    <Coachmark
      step="market"
      find={find}
      title={TITLES.market}
      body="Each market pairs a stock with a real-world event. This one has live prices, so you can trade it right away."
      action={<Hint>Tap the highlighted market</Hint>}
    />
  );
}

/** Steps 2 to 4, on a market page: a side, an amount (and the price it gets), the button. */
function TicketStep({ step }: { step: Exclude<TourStep, "market"> }) {
  const [ticker, setTicker] = useState("the stock");
  const [amount, setAmount] = useState(false);
  const [enable, setEnable] = useState(false);
  // The user's own actions move the tour on: a side tapped, an order placed.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (step === "side" && target?.closest('[data-tour="side"]')) reachTourStep("amount");
      const submit = target?.closest('[data-tour="submit"]');
      if (step === "submit" && submit?.textContent?.includes("Place order")) finishFirstTradeTour();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step]);
  // The ticket as it renders and changes: its stock, the amount typed, whether the button still
  // asks to enable trading first. A phone shows the chart first, so the ticket is brought up
  // once it exists (a view switch, never an order).
  useEffect(() => {
    let frame = 0,
      raised = false;
    const read = () => {
      frame = 0;
      const ticket = document.getElementById("trade-ticket");
      if (!ticket) return;
      if (ticket.dataset.ticker) setTicker(ticket.dataset.ticker);
      const input = document.getElementById("ticket-quantity");
      setAmount(input instanceof HTMLInputElement && Number(input.value.replace(",", ".")) > 0);
      setEnable(
        Boolean(
          document.querySelector('[data-tour="submit"]')?.textContent?.includes("Enable trading"),
        ),
      );
      const column = document.querySelector(".market-workspace-ticket");
      if (!raised && column && !visible(column)) {
        raised = true;
        [...document.querySelectorAll<HTMLButtonElement>(".market-view-bar button")]
          .find((b) => b.textContent?.includes("Trade"))
          ?.click();
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("input", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("input", schedule, true);
    };
  }, []);

  if (step === "side")
    return (
      <Coachmark
        key="side"
        step="side"
        place="left"
        find={() => [document.querySelector('[data-tour="side"]')].filter(visible)}
        title={TITLES.side}
        body={`Each side shows the live price of ${ticker} if the event happens (YES) or doesn't (NO). If the other outcome happens, your money comes back.`}
        action={<Hint>Tap a side to continue</Hint>}
      />
    );
  if (step === "amount")
    return (
      <Coachmark
        key="amount"
        step="amount"
        place="left"
        find={() =>
          ['[data-tour="amount"]', '[data-tour="price"]']
            .map((s) => document.querySelector(s))
            .filter(visible)
        }
        title={TITLES.amount}
        body="Type how many shares to buy. The order value and your worst price follow the live quote, so you see the cost before you trade."
        action={
          <Button size="sm" disabled={!amount} onClick={() => reachTourStep("submit")}>
            Next
            <ArrowRight data-icon="inline-end" />
          </Button>
        }
      />
    );
  return (
    <Coachmark
      key="submit"
      step="submit"
      place="left"
      find={() => [document.querySelector('[data-tour="submit"]')].filter(visible)}
      title={TITLES.submit}
      body={
        enable
          ? "First, enable trading: your wallet asks once. Then place the order, and it fills at once at the quoted price."
          : "A market order fills at once at the quoted price. That's your first trade."
      }
      action={<Hint>{enable ? "Tap Enable trading" : "Tap Place order"}</Hint>}
    />
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-strong">
      <MousePointerClick aria-hidden="true" className="size-3.5" />
      {children}
    </span>
  );
}

/** One step: a ring around its target (never covering it) and a card beside it, or docked at
 * the bottom of a phone's screen. Both follow the target as the page scrolls and changes. */
function Coachmark({
  step,
  find,
  place = "below",
  title,
  body,
  action,
}: {
  step: TourStep;
  /** The step's target elements; the ring goes around all of them. */
  find: () => HTMLElement[];
  place?: Place;
  title: string;
  body: string;
  action: ReactNode;
}) {
  const number = TOUR_STEPS.indexOf(step) + 1;
  const id = useId();
  const card = useRef<HTMLDivElement>(null);
  const finder = useRef(find);
  finder.current = find;
  const [layout, setLayout] = useState<{
    box: Box | null;
    phone: boolean;
    pins: { top: number; bottom: number };
    view: { width: number; height: number };
  } | null>(null);
  const [size, setSize] = useState({ width: CARD_WIDTH, height: 180 });

  // Measured on every change that can move the target: scrolling, resizing, the page's updates.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const els = finder.current();
      const box = els.length ? union(els) : null;
      const next = {
        box,
        phone: matchMedia(PHONE).matches,
        pins: pinned(),
        view: { width: window.innerWidth, height: window.innerHeight },
      };
      setLayout((prev) =>
        prev &&
        sameBox(prev.box, next.box) &&
        prev.phone === next.phone &&
        prev.pins.top === next.pins.top &&
        prev.pins.bottom === next.pins.bottom &&
        prev.view.width === next.view.width &&
        prev.view.height === next.view.height
          ? prev
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const timer = setInterval(schedule, 1000);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      clearInterval(timer);
    };
  }, []);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize((prev) =>
        prev.width === el.offsetWidth && prev.height === el.offsetHeight
          ? prev
          : { width: el.offsetWidth, height: el.offsetHeight },
      ),
    );
    observer.observe(el);
    return () => observer.disconnect();
  });

  // Once per step, scroll the target into the part of the screen nothing covers.
  const scrolled = useRef(false);
  const box = layout?.box ?? null;
  useEffect(() => {
    if (!layout || !box || scrolled.current) return;
    scrolled.current = true;
    // A docked card (phones) or one placed below the target needs its room under the target.
    const below = layout.phone ? size.height + MARGIN : place === "below" ? size.height + GAP : 0;
    const top = layout.pins.top + MARGIN + PAD,
      bottom = layout.view.height - layout.pins.bottom - MARGIN - PAD - below;
    const delta =
      box.top < top
        ? box.top - top
        : box.top + box.height > bottom
          ? Math.min(box.top + box.height - bottom, box.top - top)
          : 0;
    if (Math.abs(delta) > 1)
      window.scrollBy({ top: delta, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [layout, box, size.height, place]);

  if (!layout || !box) return null;
  const { phone, pins, view } = layout;
  const ring = {
    top: box.top - PAD,
    left: box.left - PAD,
    width: box.width + PAD * 2,
    height: box.height + PAD * 2,
  };
  // The ring hides under what the page pins (a sticky header) rather than drawing over it.
  const clipTop = Math.max(0, pins.top - ring.top),
    clipBottom = Math.max(0, ring.top + ring.height - (view.height - pins.bottom));
  const ringShown = clipTop + clipBottom < ring.height;

  let cardStyle: CSSProperties;
  let arrow: { place: Place; offset: number } | null = null;
  if (phone) {
    cardStyle = { left: MARGIN, right: MARGIN, bottom: MARGIN + pins.bottom };
  } else {
    const { width, height } = size;
    const top0 = pins.top + MARGIN,
      bottom0 = view.height - pins.bottom - MARGIN;
    const cx = box.left + box.width / 2,
      cy = box.top + box.height / 2;
    const at = (p: Place) =>
      p === "left"
        ? {
            x: box.left - PAD - GAP - width,
            y: clamp(cy - height / 2, top0, bottom0 - height),
          }
        : p === "below"
          ? {
              x: clamp(cx - width / 2, MARGIN, view.width - width - MARGIN),
              y: box.top + box.height + PAD + GAP,
            }
          : {
              x: clamp(cx - width / 2, MARGIN, view.width - width - MARGIN),
              y: box.top - PAD - GAP - height,
            };
    const fits = (p: Place) => {
      const { x, y } = at(p);
      return p === "left" ? x >= MARGIN : y >= top0 && y + height <= bottom0;
    };
    const order: Place[] = place === "left" ? ["left", "below", "above"] : ["below", "above"];
    const chosen = order.find(fits) ?? (box.top > view.height / 2 ? "above" : "below");
    const { x, y: rawY } = at(chosen);
    const y = clamp(rawY, top0, bottom0 - height);
    cardStyle = { left: x, top: y, width: CARD_WIDTH };
    // The arrow points at the target while the target is on screen.
    const targetShown = cy > top0 && cy < bottom0;
    if (targetShown)
      arrow =
        chosen === "left"
          ? { place: chosen, offset: clamp(cy - y, 18, height - 18) }
          : { place: chosen, offset: clamp(cx - x, 18, width - 18) };
  }

  return (
    <>
      {ringShown && (
        <div
          aria-hidden="true"
          className="tour-ring pointer-events-none fixed z-[45] rounded-[14px]"
          style={{
            ...ring,
            clipPath: `inset(${clipTop || -16}px -16px ${clipBottom || -16}px -16px)`,
          }}
        />
      )}
      <div
        ref={card}
        data-tour-card
        role="dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className={cn(
          "fixed z-[45] flex flex-col gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-border",
          "animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none",
        )}
        style={cardStyle}
      >
        {arrow && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute size-3 border-t border-l border-border bg-popover [clip-path:polygon(0_0,100%_0,0_100%)]",
              arrow.place === "left" && "-right-1.5 rotate-[135deg]",
              arrow.place === "below" && "-top-1.5 rotate-45",
              arrow.place === "above" && "-bottom-1.5 rotate-[225deg]",
            )}
            style={arrow.place === "left" ? { top: arrow.offset - 6 } : { left: arrow.offset - 6 }}
          />
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden="true">
              {TOUR_STEPS.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "h-1 w-4 rounded-full",
                    i < number ? "bg-brand-strong" : "bg-muted-foreground/25",
                  )}
                />
              ))}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              Step {number} of {TOUR_STEPS.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close the trading guide"
            onClick={skipFirstTradeTour}
          >
            <X />
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-title`} className="text-base leading-tight font-medium">
            {title}
          </h2>
          <p id={`${id}-body`} className="text-sm leading-snug text-muted-foreground">
            {body}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="link"
            size="xs"
            onClick={skipFirstTradeTour}
            className="h-auto px-0 text-muted-foreground hover:text-foreground"
          >
            Skip guide
          </Button>
          {action}
        </div>
      </div>
    </>
  );
}
