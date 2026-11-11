"use client";
import { ArrowUpRight, CircleCheck, Info, Landmark, PenLine, Timer } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { SideTag, VenueMark, WalletDot } from "@/components/worlds/primitives";
import { clock, urgency } from "@/components/worlds/QuoteBoard";
import { WorldSentence } from "@/components/worlds/Sentence";
import { protocolConfig, worldBooks } from "@/config/protocol";
import { usePhone } from "@/hooks/usePhone";
import { useSecond } from "@/hooks/useRfqOrder";
import { useWorldAccount } from "@/hooks/useWorldAccount";
import { cn } from "@/lib/utils";
import { bestQuote, orderCost, orderWorld, productOf, quoteOf } from "@/lib/worlds/board";
import {
  chancePercent,
  dollars,
  money,
  multiple,
  shortWallet,
  stockPrice,
  strikeText,
  whenDay,
} from "@/lib/worlds/format";
import {
  breakEvenUnits,
  dollarsText,
  freshNonce,
  type MakerSide,
  makerSide,
  parseDollars,
  quotable,
  quoteTypedData,
} from "@/lib/worlds/maker";
import type { BoardQuote, BoardRfq, BookView } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";

/** How long a quote's price is held: its maker's choice. */
const LIVES = ["1 min", "5 min", "Until it closes"] as const;
type Life = (typeof LIVES)[number];
const LIFE_SECONDS: Record<Life, number | null> = {
  "1 min": 60,
  "5 min": 300,
  "Until it closes": null,
};
/** An order with less than this left is too late to quote: the signature alone takes a while. */
const TOO_LATE_MS = 30_000;
const CENT = 10_000n;
const cents = (raw: bigint) => (raw / CENT) * CENT;
const usd = (raw: bigint) => money(dollars(raw), { cents: true });
/** "+$19.80", "−$44.30", "$0.00". */
const signed = (raw: bigint) => (raw > 0n ? `+${usd(raw)}` : usd(raw));

/** One open order, for someone who may take its other side: the bet in full (every event, the
 * stock and its date), what its taker pays, the quotes standing on it, and this wallet's own
 * quote: one number, the payout, with what it means for the wallet in every ending before
 * anything is signed. A side panel on a wide screen, a bottom sheet on a phone. */
export function OrderSheet({
  rfq,
  book,
  me,
  skew,
  minQuoteSeconds,
  onClose,
  onShown,
}: {
  /** The order on show, or null when closed. */
  rfq: BoardRfq | null;
  book: BookView | undefined;
  me: string | null;
  skew: number;
  minQuoteSeconds: number;
  onClose: () => void;
  /** An answer of the API about the order: the board takes it up. */
  onShown: (rfq: BoardRfq) => void;
}) {
  const phone = usePhone();
  // The last order stays drawn while the panel slides away.
  const last = useRef<{ rfq: BoardRfq; book: BookView | undefined } | null>(null);
  if (rfq) last.current = { rfq, book };
  const shown = rfq ? { rfq, book } : last.current;
  const body = shown && (
    <OrderBody
      key={shown.rfq.id}
      rfq={shown.rfq}
      book={shown.book}
      me={me}
      skew={skew}
      active={rfq !== null}
      minQuoteSeconds={minQuoteSeconds}
      onClose={onClose}
      onShown={onShown}
    />
  );
  const title = "Take the other side";
  const change = (open: boolean) => {
    if (!open) onClose();
  };
  if (phone)
    return (
      <Drawer open={rfq !== null} onOpenChange={change}>
        <DrawerContent size="tall" keyboard>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="gap-5 pb-6">{body}</DrawerBody>
        </DrawerContent>
      </Drawer>
    );
  return (
    <Sheet open={rfq !== null} onOpenChange={change}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[30rem]"
      >
        <SheetHeader className="border-b p-5 pr-12">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-5">
          {body}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OrderBody({
  rfq,
  book,
  me,
  skew,
  active,
  minQuoteSeconds,
  onClose,
  onShown,
}: {
  rfq: BoardRfq;
  book: BookView | undefined;
  me: string | null;
  skew: number;
  active: boolean;
  minQuoteSeconds: number;
  onClose: () => void;
  onShown: (rfq: BoardRfq) => void;
}) {
  const now = useSecond(active && rfq.status === "open") + skew;
  const world = book ? orderWorld(book, rfq.order.mask) : null;
  const product = productOf(rfq.order);
  const stake = BigInt(rfq.order.stake ?? "0");
  const paid = orderCost(rfq.order, book?.feeBps ?? 0);
  const left = Math.max(0, rfq.expiresAt - now);
  const own = me !== null && rfq.taker.toLowerCase() === me.toLowerCase();
  const mine = quoteOf(rfq, me);
  const spot =
    book?.analytics?.spot && book.feedDecimals !== null
      ? book.analytics.spot / 10 ** book.feedDecimals
      : null;

  return (
    <>
      {/* Who asks, and for how long. */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <WalletDot address={rfq.taker} />
          <span className="truncate">
            <span className="font-medium">{own ? "You" : shortWallet(rfq.taker)}</span>
            <span className="text-muted-foreground"> {own ? "bet" : "bets"} that</span>
          </span>
        </span>
        {rfq.status === "open" ? (
          <InfoTooltip content="Time left on this order. Its owner can accept a quote or cancel before then.">
            <span
              className={cn(
                "flex h-8 shrink-0 cursor-help items-center gap-1.5 rounded-full bg-secondary px-3 text-sm font-medium tabular-nums",
                left <= 60_000 ? urgency(left) : "text-foreground",
              )}
            >
              <Timer className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="sr-only">Open for</span>
              {clock(left)}
            </span>
          </InfoTooltip>
        ) : (
          <span className="flex h-8 shrink-0 items-center rounded-full bg-secondary px-3 text-sm font-medium text-muted-foreground">
            Closed
          </span>
        )}
      </div>

      {/* The bet, in full. */}
      <section className="flex flex-col gap-4 rounded-2xl bg-secondary/50 p-4">
        {world ? (
          <WorldSentence
            world={{
              legs: world.legs.map((l) => ({ label: l.label, wantYes: l.wantYes })),
              stock: world.stock,
            }}
            size="card"
          />
        ) : (
          <div className="h-12 animate-pulse rounded bg-secondary" />
        )}
        {world && (
          <ul className="flex flex-col gap-2.5 border-t pt-3.5">
            {world.legs.map((l) => (
              <li key={l.eventKey} className="flex items-start gap-2.5 text-sm">
                <SideTag wantYes={l.wantYes} className="mt-px" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="[overflow-wrap:anywhere]">{l.label}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <VenueMark source={l.source} />
                    {l.endTime && <span>decided by {whenDay(l.endTime)}</span>}
                    {l.url && (
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 hover:text-foreground"
                      >
                        Source
                        <ArrowUpRight className="size-3" aria-hidden />
                      </a>
                    )}
                  </span>
                </div>
                <span className="shrink-0 text-right tabular-nums">
                  {l.outcome ? (
                    <span className={l.outcome === "passed" ? "text-positive" : "text-danger"}>
                      {l.outcome === "passed" ? "Happened" : "Failed"}
                    </span>
                  ) : (
                    <InfoTooltip content="The chance this event goes the way the bet needs, as the vault prices it now.">
                      <span className="cursor-help font-medium">{chancePercent(l.chance)}</span>
                    </InfoTooltip>
                  )}
                </span>
              </li>
            ))}
            {world.stock && (
              <li className="flex items-start gap-2.5 text-sm">
                <span className="mt-px inline-flex h-5 shrink-0 items-center rounded-md bg-info-soft px-1.5 text-[11px] font-semibold tracking-wide text-info">
                  {world.stock.symbol}
                </span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {spot !== null && (
                    <>
                      now <span className="text-foreground">{stockPrice(spot)}</span>,{" "}
                    </>
                  )}
                  must close {world.stock.direction}{" "}
                  <span className="text-foreground">{strikeText(world.stock.strike)}</span>
                </span>
              </li>
            )}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 border-t pt-3.5 text-sm">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                product === "Money-back"
                  ? "bg-info-soft text-info"
                  : "bg-brand-soft text-brand-strong",
              )}
            >
              {product}
            </span>
            <span className="text-muted-foreground">
              {own ? "you pay" : "they pay"}{" "}
              <span className="font-medium text-foreground tabular-nums">{usd(paid)}</span>
            </span>
          </span>
          <Link
            href={`/worlds/${rfq.book}`}
            className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            World page
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </div>
      </section>

      <Standing rfq={rfq} me={me} paid={paid} now={now} />

      {rfq.status !== "open" ? (
        <Ended rfq={rfq} me={me} stake={stake} onClose={onClose} />
      ) : own ? (
        <Note>This is your order. You choose a quote on the page you placed it from.</Note>
      ) : !quotable(rfq.order) ? (
        <Note>This kind of order is quoted through the maker API.</Note>
      ) : (
        <YourQuote
          rfq={rfq}
          book={book}
          mine={mine}
          paid={paid}
          left={left}
          now={now}
          skew={skew}
          minQuoteSeconds={minQuoteSeconds}
          onShown={onShown}
        />
      )}
    </>
  );
}

/** A small "i" that says `content` on hover, or on a tap. */
function Help({ content }: { content: string }) {
  return (
    <InfoTooltip content={content}>
      <span className="inline-flex cursor-help text-muted-foreground">
        <Info className="size-3.5" aria-hidden />
        <span className="sr-only">More</span>
      </span>
    </InfoTooltip>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  );
}

/** The quotes standing on the order, best first, as its owner sees them. */
function Standing({
  rfq,
  me,
  paid,
  now,
}: {
  rfq: BoardRfq;
  me: string | null;
  paid: bigint;
  now: number;
}) {
  if (rfq.status !== "open") return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>Quotes so far · pays if right</span>
        <span>Held for</span>
      </div>
      {rfq.quotes.length === 0 ? (
        <p className="rounded-2xl px-4 py-3 text-sm text-muted-foreground ring-1 ring-border">
          No quotes yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl ring-1 ring-border">
          {rfq.quotes.map((q, i) => {
            const yours = me !== null && q.wallet?.toLowerCase() === me.toLowerCase();
            const held = Math.max(0, Number(q.expiry) * 1000 - now);
            return (
              <li
                key={q.makerId}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-3",
                  !q.fills && "opacity-50",
                  yours && "bg-brand-soft/30",
                )}
              >
                {q.vault ? (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <Landmark className="size-3" aria-hidden />
                  </span>
                ) : q.wallet ? (
                  <WalletDot address={q.wallet} />
                ) : (
                  <span className="size-5 shrink-0 rounded-full bg-secondary" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className="truncate">{yours ? "You" : q.maker}</span>
                    {i === 0 && q.fills && rfq.quotes.length > 1 && (
                      <span className="rounded-full bg-positive-soft px-1.5 py-px text-[10px] font-semibold text-positive">
                        Best
                      </span>
                    )}
                  </span>
                  {!q.fills && (
                    <span className="text-xs text-muted-foreground">can't be filled right now</span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
                  {usd(BigInt(q.units))}
                  <span className="text-xs font-normal text-muted-foreground">
                    {multiple(dollars(q.units), dollars(paid))}
                  </span>
                </span>
                <span
                  className={cn("w-10 shrink-0 text-right text-xs tabular-nums", urgency(held))}
                >
                  {clock(held)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** How a closed order ended, said to whoever is looking: its maker, or a bystander. */
function Ended({
  rfq,
  me,
  stake,
  onClose,
}: {
  rfq: BoardRfq;
  me: string | null;
  stake: bigint;
  onClose: () => void;
}) {
  const won = me !== null && rfq.fill?.wallet?.toLowerCase() === me.toLowerCase();
  if (won && rfq.fill)
    return (
      <section className="flex flex-col gap-4 rounded-2xl bg-positive-soft/60 p-4">
        <div className="flex items-start gap-3">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-positive" aria-hidden />
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium">Your quote was accepted</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              You received {usd(stake)}. {usd(BigInt(rfq.fill.units))} is held in this world until
              it settles.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" render={<Link href="/worlds/me" />} nativeButton={false}>
            See my worlds
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Done
          </Button>
        </div>
      </section>
    );
  return (
    <section className="flex flex-col gap-3">
      <Note>
        {rfq.status === "filled"
          ? rfq.fill
            ? `Filled by ${rfq.fill.maker} at ${usd(BigInt(rfq.fill.units))}.`
            : "Filled."
          : rfq.status === "cancelled"
            ? "Its owner cancelled this order."
            : rfq.reason === "The world stopped trading"
              ? "This world stopped trading, so the order closed."
              : "This order ran out before its owner accepted a quote."}
      </Note>
      <Button variant="secondary" onClick={onClose}>
        Back to open orders
      </Button>
    </section>
  );
}

/** This wallet's quote on the order: the payout it offers, what that means for it, and the
 * signature that sends it; or, once it stands, the quote with a way to change it or take it
 * back. */
function YourQuote({
  rfq,
  book,
  mine,
  paid,
  left,
  now,
  skew,
  minQuoteSeconds,
  onShown,
}: {
  rfq: BoardRfq;
  book: BookView | undefined;
  mine: BoardQuote | null;
  paid: bigint;
  left: number;
  now: number;
  /** ms to add to this clock for the API's, which a quote's expiry is counted on. */
  skew: number;
  minQuoteSeconds: number;
  onShown: (rfq: BoardRfq) => void;
}) {
  const wallet = useWallet();
  const account = useWorldAccount();
  const stake = BigInt(rfq.order.stake ?? "0");
  const best = bestQuote(rfq);
  const others = best && best.makerId !== mine?.makerId ? BigInt(best.units) : null;
  const even = breakEvenUnits(rfq.order, book);
  // A starting figure worth reading: a little over the best quote, or a little under what
  // breaks even at the market's chances.
  const [text, setText] = useState(() => {
    if (mine) return dollarsText(BigInt(mine.units));
    if (others !== null) return dollarsText(cents((others * 101n) / 100n) + CENT);
    return even ? dollarsText(cents((even * 97n) / 100n)) : "";
  });
  const [life, setLife] = useState<Life>("5 min");
  const [editing, setEditing] = useState(mine === null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<"send" | "back" | null>(null);

  // A quote of this wallet that left the order without it asking: say so, once.
  const had = useRef<BoardQuote | null>(mine);
  const tookBack = useRef(false);
  const mineKey = mine ? `${mine.units}:${mine.expiry}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mineKey` is the quote's identity.
  useEffect(() => {
    if (mine) {
      had.current = mine;
      setNotice(null);
      return;
    }
    const gone = had.current;
    had.current = null;
    if (!gone) return;
    setEditing(true);
    if (tookBack.current) {
      tookBack.current = false;
      return;
    }
    setNotice(
      Number(gone.expiry) * 1000 <= Date.now() + skew + 1_500
        ? "Your quote ran out."
        : "Its owner turned your quote down.",
    );
  }, [mineKey]);

  const units = parseDollars(text);
  const side = units !== null && units > 0n ? makerSide(rfq.order, units, book) : null;
  const tooLate = left < Math.max(TOO_LATE_MS, (minQuoteSeconds + 10) * 1000);
  const hold =
    units === null || units === 0n
      ? "Enter what you would pay"
      : units <= stake
        ? `Offer more than their stake of ${usd(stake)}`
        : null;
  const credit = account.credit;
  const short = side && credit !== null && credit < side.needs ? side.needs - credit : 0n;
  // A deposit rounds up to the next dollar, as the ticket's does.
  const add = short > 0n ? (short / 1_000_000n + 1n) * 1_000_000n : 0n;
  const walletShort = add > 0n && account.walletBalance !== null && account.walletBalance < add;
  const busy = account.busy || working !== null;

  const send = () => {
    if (!side) return;
    setWorking("send");
    void account
      .run(async (assertCurrent) => {
        const apiNow = Math.floor((Date.now() + skew) / 1000);
        const end = Math.floor(rfq.expiresAt / 1000);
        const seconds = LIFE_SECONDS[life];
        const expiry = seconds === null ? end : Math.min(apiNow + seconds, end);
        const { typed, quote } = quoteTypedData({
          chainId: protocolConfig.chainId,
          books: worldBooks,
          rfq,
          side,
          expiry,
          nonce: freshNonce(),
        });
        const signature = await wallet.signTypedData(typed);
        assertCurrent();
        onShown(await worldsApi.board.quote(rfq.id, { ...quote, signature }));
        setEditing(false);
        setNotice(null);
        toast.add({ type: "success", title: "Quote sent" });
      })
      .finally(() => setWorking(null));
  };
  const takeBack = () => {
    setWorking("back");
    tookBack.current = true;
    void account
      .run(async () => {
        onShown(await worldsApi.board.withdraw(rfq.id));
        toast.add({ title: "Quote taken back" });
      })
      .finally(() => setWorking(null));
  };

  // ---------------------------------------------------------------- it stands
  if (mine && !editing) {
    const held = Math.max(0, Number(mine.expiry) * 1000 - now);
    const standing = makerSide(rfq.order, BigInt(mine.units), book);
    return (
      <section className="flex flex-col gap-4 rounded-2xl p-4 ring-1 ring-brand/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 text-base font-medium">
              <span className="relative flex size-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              Your quote is live
            </h3>
            {!mine.fills && (
              <p className="text-sm text-warning">
                It can't be filled right now: your world balance may be short.
              </p>
            )}
          </div>
          <span className={cn("shrink-0 text-sm font-medium tabular-nums", urgency(held))}>
            {clock(held)}
          </span>
        </div>
        <Endings side={standing} moneyBack={rfq.order.conditional} />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() => {
              setText(dollarsText(BigInt(mine.units)));
              setEditing(true);
            }}
          >
            <PenLine data-icon="inline-start" />
            Change
          </Button>
          <Button
            variant="ghost"
            className="flex-1 text-muted-foreground hover:text-danger"
            disabled={busy}
            onClick={takeBack}
          >
            {working === "back" && <Spinner data-icon="inline-start" />}
            Take it back
          </Button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- the form
  const step = account.step;
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-medium">{mine ? "Change your quote" : "Your quote"}</h3>
      {notice && (
        <p
          className="rounded-xl bg-warning-soft px-3.5 py-2.5 text-sm text-warning"
          aria-live="polite"
        >
          {notice}
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-2xl bg-secondary/50 p-4">
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="maker-quote-payout" className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">You pay them if they're right</span>
            <span
              className={cn(
                "flex h-10 w-36 items-center rounded-xl bg-background px-3 text-xl font-medium tabular-nums ring-1 ring-border transition-shadow focus-within:ring-2 focus-within:ring-ring/60",
                hold && text !== "" && "ring-danger/60 focus-within:ring-danger/60",
              )}
            >
              <span className="text-muted-foreground">$</span>
              <input
                id="maker-quote-payout"
                value={text}
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                placeholder="0"
                aria-invalid={Boolean(hold && text !== "")}
                className="w-full min-w-0 bg-transparent pl-0.5 outline-none"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^\d.]/g, "");
                  if (/^\d{0,7}(\.\d{0,2})?$/.test(next)) setText(next);
                }}
              />
            </span>
          </label>
          <div className="flex flex-col items-end gap-1.5 text-right">
            <span className="text-xs text-muted-foreground">for their {usd(paid)}</span>
            <span className="flex h-10 items-center">
              <span className="rounded-full bg-positive-soft px-2 py-1 text-base leading-none font-semibold text-positive tabular-nums">
                {side ? multiple(dollars(side.units), dollars(paid)) : "—"}
              </span>
            </span>
          </div>
        </div>
        {/* What to measure the figure against. */}
        <dl className="flex flex-col gap-1.5 border-t pt-3 text-xs">
          <Reference
            label="Best quote so far"
            value={others === null ? "none yet" : usd(others)}
            action={others === null ? null : "Beat it"}
            onAction={() =>
              others !== null && setText(dollarsText(cents((others * 101n) / 100n) + CENT))
            }
          />
          {even !== null && (
            <Reference
              label="Break-even at market odds"
              hint="At the chances the vault prices this world with, a payout above this loses money on average, and one below it keeps an edge."
              value={usd(even)}
              action="Use 3% under"
              onAction={() => setText(dollarsText(cents((even * 97n) / 100n)))}
            />
          )}
        </dl>
      </div>

      {side && !hold && <Endings side={side} moneyBack={rfq.order.conditional} />}

      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Hold my price for
          <Help content="Its owner can accept your quote until then. You can take it back sooner." />
        </span>
        <Segmented
          label="How long the quote stands"
          value={life}
          options={LIVES}
          onChange={setLife}
          variant="compact"
          disabled={busy}
        />
      </div>

      {tooLate ? (
        <Button size="lg" disabled className="w-full">
          Closing too soon to quote
        </Button>
      ) : step ? (
        <Button size="lg" className="w-full" disabled={step.disabled} onClick={step.action}>
          {step.busy && <Spinner data-icon="inline-start" />}
          {step.kind === "sign-in" ? "Sign in to quote" : step.label}
        </Button>
      ) : hold ? (
        <Button size="lg" disabled className="w-full">
          {hold}
        </Button>
      ) : !account.permissionLoaded ? (
        <Button size="lg" disabled className="w-full">
          <Spinner data-icon="inline-start" />
          Checking your balance…
        </Button>
      ) : add > 0n ? (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full"
            disabled={busy || walletShort}
            onClick={() => account.deposit(add)}
          >
            {account.busy && <Spinner data-icon="inline-start" />}
            Add {usd(add)} to quote
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {walletShort
              ? `Your wallet holds ${usd(account.walletBalance ?? 0n)}: not enough to back this quote.`
              : `This quote needs ${usd(side?.needs ?? 0n)} in your world balance; it holds ${usd(credit ?? 0n)}.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {mine && (
              <Button
                size="lg"
                variant="secondary"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Keep it
              </Button>
            )}
            <Button size="lg" className="flex-1" disabled={busy} onClick={send}>
              {working === "send" && <Spinner data-icon="inline-start" />}
              {working === "send"
                ? "Sign in your wallet…"
                : mine
                  ? "Sign and replace quote"
                  : "Sign and send quote"}
            </Button>
          </div>
          <p className="text-center text-xs leading-5 text-muted-foreground">
            A signature, no gas. Nothing leaves your balance unless it's accepted.
          </p>
        </div>
      )}
    </section>
  );
}

function Reference({
  label,
  hint,
  value,
  action,
  onAction,
}: {
  label: string;
  hint?: string;
  value: string;
  action: string | null;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1 text-muted-foreground">
        {label}
        {hint && <Help content={hint} />}
      </dt>
      <dd className="flex items-center gap-2 tabular-nums">
        <span className="font-medium">{value}</span>
        {action && (
          <Button variant="secondary" size="xs" className="rounded-full" onClick={onAction}>
            {action}
          </Button>
        )}
      </dd>
    </div>
  );
}

/** What a quote means for its maker, ending by ending: what it is paid at once, and what it
 * gains or loses when the world settles. */
function Endings({ side, moneyBack }: { side: MakerSide; moneyBack: boolean }) {
  const said: Record<MakerSide["endings"][number]["key"], { label: string; note: string }> = {
    right: {
      label: "If they're right",
      note: `you pay them ${usd(side.units)}`,
    },
    wrong: {
      label: moneyBack ? "If the stock goes the other way" : "If they're wrong",
      note: "you keep their stake",
    },
    fails: { label: "If an event fails", note: "their stake goes back to them" },
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-border">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">If accepted, you receive now</span>
        <span className="font-medium tabular-nums">{usd(side.price)}</span>
      </div>
      <ul className="flex flex-col gap-2.5 border-t pt-3">
        {side.endings.map((e) => (
          <li key={e.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 flex-col">
              <span>
                {said[e.key].label}
                {e.chance !== null && (
                  <span className="text-muted-foreground"> · {chancePercent(e.chance)}</span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{said[e.key].note}</span>
            </span>
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums",
                e.net > 0n ? "text-positive" : e.net < 0n ? "text-danger" : "text-muted-foreground",
              )}
            >
              {signed(e.net)}
            </span>
          </li>
        ))}
      </ul>
      {side.expected !== null && (
        <div className="flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
          <span className="text-muted-foreground">On average, at market odds</span>
          <span
            className={cn(
              "font-medium tabular-nums",
              side.expected >= 0n ? "text-positive" : "text-danger",
            )}
          >
            {signed(side.expected)}
          </span>
        </div>
      )}
    </div>
  );
}
