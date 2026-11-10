"use client";
import { Hourglass, Landmark, RefreshCw, Rocket, ShieldCheck, Store, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { type RfqOrder, useSecond } from "@/hooks/useRfqOrder";
import { cn } from "@/lib/utils";
import { dollars, money, multiple } from "@/lib/worlds/format";
import type { ProductName } from "@/lib/worlds/offer";
import type { RfqQuote } from "@/lib/worlds/types";

/** What the board is busy with: one thing at a time, and which quote it is about. */
export type BoardAction =
  | { kind: "accept" | "decline"; quote: string }
  | { kind: "again" | "cancel" };

/** "14:32", "4:05", "0:09". */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** A countdown's colour: calm, then amber in its last half minute, red in its last ten seconds. */
export const urgency = (ms: number) =>
  ms <= 10_000 ? "text-danger" : ms <= 30_000 ? "text-warning" : "text-muted-foreground";
/** How long a row's Accept rests after its quote changed by itself, so a tap meant for the old
 * price never lands on the new one. */
const SETTLE_MS = 1_200;
/** A quote with less than this left cannot be taken any more: its fill would land too late. */
const LAST_CALL_MS = 3_000;
/** How long a quote that ran out or was taken back stays in its row, greyed, for its maker to
 * follow it with another; and how long the board waits for a first quote before it says none
 * has come. */
const GHOST_MS = 4_000;
const FIRST_QUOTE_MS = 8_000;

/** A maker's row: its quote, standing or just gone (and why), kept where it was. */
interface Row {
  quote: RfqQuote;
  gone: "expired" | "withdrawn" | null;
}

/** An order out for quotes, for the person who placed it: how long it stays open, the order
 * itself, and a table of the makers' quotes as they arrive (what each pays, and how long its
 * maker holds the price), each with its own Accept and Decline. The order can be cancelled.
 * Nothing is charged until a quote is accepted, and accepting takes two taps: Accept, then
 * Confirm on the same row, for exactly the price shown.
 *
 * Nothing moves under a finger. A maker's row keeps the place its first quote took (the best is
 * marked, not moved); a quote its maker replaces updates in its row, whose Accept rests a
 * moment; and one that ran out stays there greyed for a few seconds, where the maker's next
 * quote takes its place. */
export function QuoteBoard({
  order,
  product,
  paid,
  failsFrom,
  action,
  onAccept,
  onDecline,
  onAgain,
  onCancel,
  onRestart,
  onBack,
  className,
}: {
  order: RfqOrder;
  product: ProductName;
  /** What the order costs, fee included (dollars). */
  paid: number;
  /** From when the stake can come back if an event fails ("Fri, Dec 19"), for Money-back. */
  failsFrom: string | null;
  action: BoardAction | null;
  onAccept: (quote: RfqQuote) => void;
  onDecline: (quote: RfqQuote) => void;
  /** Asks the makers for new quotes on the open order. */
  onAgain: () => void;
  onCancel: () => void;
  /** After the order ran out: place it again, or go back and change it. */
  onRestart: () => void;
  onBack: () => void;
  className?: string | undefined;
}) {
  const { rfq, skew } = order;
  const open = rfq.status === "open";
  const now = useSecond(open) + skew;
  const left = rfq.expiresAt - now;

  // Each maker keeps the place its first quote took, and its last quote is remembered: when it
  // leaves the order unreplaced, it stays in its row a few seconds, greyed.
  const memory = useRef<{
    id: string;
    makers: string[];
    last: Map<string, { quote: RfqQuote; goneAt: number | null }>;
    declined: Set<string>;
    declinedAt: number;
  }>({ id: rfq.id, makers: [], last: new Map(), declined: new Set(), declinedAt: 0 });
  if (memory.current.id !== rfq.id)
    memory.current = {
      id: rfq.id,
      makers: [],
      last: new Map(),
      declined: new Set(),
      declinedAt: 0,
    };
  const m = memory.current;
  for (const q of rfq.quotes) if (!m.makers.includes(q.makerId)) m.makers.push(q.makerId);
  const rows: Row[] = m.makers.flatMap((maker): Row[] => {
    const standing = rfq.quotes.find((q) => q.makerId === maker);
    if (standing && Number(standing.expiry) * 1000 > now) {
      m.last.set(maker, { quote: standing, goneAt: null });
      return [{ quote: standing, gone: null }];
    }
    const last = m.last.get(maker);
    if (!last || m.declined.has(last.quote.id)) return [];
    last.goneAt ??= Date.now();
    if (Date.now() - last.goneAt >= GHOST_MS) return [];
    // Past its own time it ran out; before it, its maker took it back.
    const ranOut = Number(last.quote.expiry) * 1000 <= now + 1_500;
    return [{ quote: last.quote, gone: ranOut ? "expired" : "withdrawn" }];
  });
  const live = rows.filter((r) => !r.gone).map((r) => r.quote);
  // The API lists quotes that fill first, the best of them first.
  const best = rfq.quotes.find((q) => !q.problem && live.includes(q)) ?? null;

  // Accepting takes a second tap on the same row, for the quote as it stood at the first.
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmed = live.some((q) => q.id === confirming) ? confirming : null;

  if (!open)
    return (
      <section
        className={cn(
          "flex flex-col gap-5 rounded-xl bg-card p-4 ring-1 ring-border sm:p-5",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <Hourglass className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium">Your order ran out</h2>
            <p className="text-sm text-muted-foreground">
              {rfq.received === 0
                ? "No maker sent a quote in time. Nothing was charged."
                : "No quote was accepted in time, so nothing was charged."}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" onClick={onRestart}>
            <RefreshCw data-icon="inline-start" />
            Ask for quotes again
          </Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={onBack}>
            Change the order
          </Button>
        </div>
      </section>
    );

  const busy = action !== null;
  const stake = dollars(rfq.order.stake);
  const fee = Math.max(0, paid - stake);
  const moneyBack = product === "Money-back";
  const Product = moneyBack ? ShieldCheck : Rocket;
  // What a board with no row is waiting for.
  const waiting =
    rfq.makers === 0
      ? "nobody"
      : rfq.received === 0
        ? now - rfq.createdAt < FIRST_QUOTE_MS
          ? "first"
          : "unquoted"
        : Date.now() - m.declinedAt < 60_000
          ? "declined"
          : "none";
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-border sm:p-5",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">
          {live.length ? "Choose a quote" : "Getting your quotes"}
        </h2>
        <InfoTooltip content="Your order closes when this runs out.">
          <span
            className={cn(
              "flex h-8 shrink-0 cursor-help items-center gap-1.5 rounded-full bg-secondary px-3 text-sm font-medium tabular-nums",
              left <= 60_000 ? urgency(left) : "text-foreground",
            )}
          >
            <Timer className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="sr-only">Order open for</span>
            {clock(left)}
          </span>
        </InfoTooltip>
      </header>

      {/* The order, said once: every quote below is for exactly this. */}
      <div className="flex flex-col gap-1.5 rounded-2xl bg-secondary/50 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full",
                moneyBack ? "bg-info-soft text-info" : "bg-positive-soft text-positive",
              )}
            >
              <Product className="size-3.5" />
            </span>
            {product}
          </span>
          <span className="tabular-nums">
            <span className="text-muted-foreground">You pay </span>
            <span className="font-medium">{money(paid, { cents: true })}</span>
          </span>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {money(fee, { cents: true })} fee included
          {moneyBack && (
            <>
              {" · "}
              <span className="text-info">
                {money(stake, { cents: true })} back if an event fails
                {failsFrom ? `, from ${failsFrom}` : ""}
              </span>
            </>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <Waiting
          state={waiting}
          makers={rfq.makers}
          asking={action?.kind === "again"}
          disabled={busy}
          onAgain={onAgain}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <span>Maker · pays if you're right</span>
            <span>Price held for</span>
          </div>
          <ul aria-label="Quotes" className="flex flex-col divide-y rounded-2xl ring-1 ring-border">
            {rows.map(({ quote: q, gone }) => (
              <QuoteRow
                key={q.makerId}
                quote={q}
                gone={gone}
                now={now}
                paid={paid}
                best={live.length > 1 && q.id === best?.id}
                lead={live.length === 1 || q.id === best?.id}
                disabled={busy}
                confirming={confirmed === q.id}
                accepting={action?.kind === "accept" && action.quote === q.id}
                declining={action?.kind === "decline" && action.quote === q.id}
                onAsk={() => setConfirming(q.id)}
                onBack={() => setConfirming(null)}
                onConfirm={() => onAccept(q)}
                onDecline={() => {
                  m.declined.add(q.id);
                  m.declinedAt = Date.now();
                  onDecline(q);
                }}
              />
            ))}
          </ul>
          <p
            className="flex items-center gap-2 px-1 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Live />
            {live.length
              ? `Open to ${rfq.makers === 1 ? "1 maker" : `${rfq.makers} makers`}`
              : "Waiting for a new quote"}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t pt-3.5 text-xs text-muted-foreground">
        <span>Nothing is charged until you accept a quote.</span>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-1.5 shrink-0 text-muted-foreground hover:text-danger"
          disabled={busy}
          onClick={onCancel}
        >
          {action?.kind === "cancel" ? "Cancelling…" : "Cancel order"}
        </Button>
      </div>
    </section>
  );
}

/** One maker's quote: who, what it pays, how long the maker holds the price (a time, and a line
 * that drains with it), and its buttons: Accept then Confirm, or Decline. A quote that just ran
 * out, or that its maker took back, stays greyed where it was. */
function QuoteRow({
  quote,
  gone,
  now,
  paid,
  best,
  lead,
  disabled,
  confirming,
  accepting,
  declining,
  onAsk,
  onBack,
  onConfirm,
  onDecline,
}: {
  quote: RfqQuote;
  gone: Row["gone"];
  now: number;
  paid: number;
  /** The best of several quotes. */
  best: boolean;
  /** The row whose Accept leads (the best, or the only one). */
  lead: boolean;
  disabled: boolean;
  /** Accept was tapped: the row asks once more before it fills. */
  confirming: boolean;
  accepting: boolean;
  declining: boolean;
  onAsk: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const expiresAt = Number(quote.expiry) * 1000;
  const left = gone ? 0 : expiresAt - now;
  const payout = dollars(quote.units);
  const Mark = quote.vault ? Landmark : Store;

  // The quote changed in this row (its maker replaced it): Accept rests a moment.
  const shown = useRef(quote.id);
  const [settledAt, setSettledAt] = useState(0);
  useEffect(() => {
    if (shown.current === quote.id) return;
    shown.current = quote.id;
    setSettledAt(Date.now() + SETTLE_MS);
    const timer = setTimeout(() => setSettledAt(0), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [quote.id]);
  const settling = shown.current !== quote.id || Date.now() < settledAt;
  const lastCall = !gone && left < LAST_CALL_MS;
  const blocked = disabled || settling || lastCall || Boolean(quote.problem);
  const tone = urgency(left);

  return (
    <li
      data-quote={quote.id}
      className={cn(
        "relative flex animate-in flex-col gap-2.5 px-3.5 py-3 duration-300 fade-in slide-in-from-top-1",
        (gone || (disabled && !accepting)) && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            quote.vault ? "bg-brand-soft text-brand-strong" : "bg-secondary text-muted-foreground",
          )}
        >
          <Mark className="size-3.5" />
        </span>
        <span className="truncate text-sm font-medium">{quote.maker}</span>
        {best && (
          <span className="shrink-0 rounded-full bg-positive-soft px-2 py-0.5 text-[11px] leading-4 font-semibold text-positive">
            Best
          </span>
        )}
        {gone ? (
          <span className="ml-auto shrink-0 text-xs font-medium text-muted-foreground">
            {gone === "expired" ? "Expired" : "Taken back"}
          </span>
        ) : (
          <InfoTooltip content="How long this maker holds the price. It may change it, or take it back, before then.">
            <span
              className={cn("ml-auto shrink-0 cursor-help text-xs font-medium tabular-nums", tone)}
            >
              <span className="sr-only">Price held for</span>
              {clock(left)}
            </span>
          </InfoTooltip>
        )}
      </div>
      {/* Keyed by the quote, so a replaced one fades in where the old one was. */}
      <div
        key={quote.id}
        className="flex animate-in items-center justify-between gap-3 duration-500 fade-in"
      >
        <span className="flex min-w-0 items-center gap-2 tabular-nums">
          <span
            className={cn(
              "text-xl leading-7 font-medium",
              gone ? "text-muted-foreground line-through" : "text-positive",
            )}
          >
            {money(payout)}
          </span>
          {!gone && (
            <span className="rounded-full bg-positive-soft px-2 py-1 text-sm leading-none font-semibold text-positive">
              {multiple(payout, paid)}
            </span>
          )}
        </span>
        {!gone &&
          (confirming && !blocked ? (
            <span className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                className="h-9 px-2.5 text-muted-foreground"
                disabled={disabled}
                onClick={onBack}
              >
                Back
              </Button>
              <Button
                className="h-9 min-w-24 px-3.5"
                aria-label={`Confirm: pay ${money(paid, { cents: true })}, ${money(payout)} if you're right`}
                disabled={disabled}
                onClick={onConfirm}
              >
                {accepting ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Placing…
                  </>
                ) : (
                  "Confirm"
                )}
              </Button>
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                className="h-9 px-2.5 text-muted-foreground"
                aria-label={`Decline ${quote.maker}'s quote`}
                disabled={disabled}
                onClick={onDecline}
              >
                {declining ? <Spinner /> : "Decline"}
              </Button>
              <Button
                variant={lead ? "default" : "secondary"}
                className="h-9 min-w-20 px-3.5"
                aria-label={`Accept ${quote.maker}'s quote`}
                disabled={blocked}
                onClick={onAsk}
              >
                {accepting ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Placing…
                  </>
                ) : settling ? (
                  "Updated"
                ) : lastCall ? (
                  "Expiring"
                ) : (
                  "Accept"
                )}
              </Button>
            </span>
          ))}
      </div>
      {!gone && confirming && !blocked && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          You pay{" "}
          <span className="font-medium text-foreground">{money(paid, { cents: true })}</span> now
          and get <span className="font-medium text-positive">{money(payout)}</span> if you're
          right.
        </p>
      )}
      {!gone && quote.problem && (
        <p className="text-xs text-warning">Can't be filled right now: {quote.problem}</p>
      )}
      {/* The time the price is held, as a line that drains. */}
      {!gone && (
        <span
          className="absolute inset-x-3.5 bottom-0 h-0.5 overflow-hidden rounded-full"
          aria-hidden
        >
          <span
            className={cn(
              "block h-full rounded-full bg-current opacity-50 transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
              tone,
            )}
            style={{
              width: `${Math.min(100, Math.max(0, (left / Math.max(1, expiresAt - quote.receivedAt)) * 100))}%`,
            }}
          />
        </span>
      )}
    </li>
  );
}

/** No row on the board: the first quote is on its way, none has come, the last was turned down
 * or ran out, or nobody is there to send one. */
function Waiting({
  state,
  makers,
  asking,
  disabled,
  onAgain,
}: {
  state: "first" | "unquoted" | "declined" | "none" | "nobody";
  makers: number;
  asking: boolean;
  disabled: boolean;
  onAgain: () => void;
}) {
  if (state === "first")
    return (
      <div
        className="flex flex-col gap-3 rounded-2xl p-3.5 ring-1 ring-border"
        aria-live="polite"
        aria-busy
      >
        <div className="flex items-center gap-2 text-sm">
          <Live />
          Asking {makers === 1 ? "the maker" : `${makers} makers`} for a price
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="h-7 w-32 animate-pulse rounded-lg bg-secondary" />
          <span className="h-9 w-20 animate-pulse rounded-lg bg-secondary" />
        </div>
      </div>
    );
  const copy = {
    nobody: ["No maker is online right now", "Your order stays open in case one comes online."],
    unquoted: ["No maker has quoted yet", "They may not be pricing this world right now."],
    declined: ["You turned that quote down", "Your order is still open."],
    none: ["No quote at the moment", "The last one ran out."],
  }[state];
  return (
    <div
      className="flex flex-col items-start gap-3 rounded-2xl bg-secondary/50 p-4"
      aria-live="polite"
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{copy[0]}</span>
        <span className="text-sm text-muted-foreground">{copy[1]}</span>
      </div>
      {state !== "nobody" && (
        <Button variant="secondary" className="rounded-full" disabled={disabled} onClick={onAgain}>
          {asking ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          Ask again
        </Button>
      )}
    </div>
  );
}

/** A small pulse: the order is live. */
function Live() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-brand" />
    </span>
  );
}
