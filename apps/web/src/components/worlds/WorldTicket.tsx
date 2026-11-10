"use client";
import { Check, ExternalLink, Info, Rocket, RotateCcw, Share2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { explorerFor, protocolConfig, worldsEnabled } from "@/config/protocol";
import { type RfqOrder, useRfqOrder } from "@/hooks/useRfqOrder";
import { useWorldAccount } from "@/hooks/useWorldAccount";
import { cn } from "@/lib/utils";
import { orderCost, orderWorld } from "@/lib/worlds/board";
import { chancePercent, dollars, money, multiple, whenDay } from "@/lib/worlds/format";
import {
  atStake,
  bookOffers,
  type Offer,
  type ProductName,
  previewOffers,
  stakeRawWithin,
  stakeWithin,
} from "@/lib/worlds/offer";
import type { BookView, Preview, RfqQuote, Spec } from "@/lib/worlds/types";
import { ApiError } from "@/services/api";
import { worldsApi } from "@/services/worlds-api";
import { Fact } from "./primitives";
import { type BoardAction, QuoteBoard } from "./QuoteBoard";
import { type SentenceWorld, WorldSentence } from "./Sentence";
import { shareLink } from "./share";

export type TicketWorld =
  // A draft's spec is null while it has no event: nothing is priced, and nothing can be placed.
  | { kind: "draft"; spec: Spec | null; preview: Preview | null; pricing: boolean }
  | { kind: "book"; book: BookView };

const STAKES: Record<ProductName, number[]> = {
  "All-in": [10, 20, 50, 100],
  "Money-back": [50, 100, 250, 500],
};
/** An order's least and most (one-tap trading's limit a trade), fee included. */
const MIN_ORDER = 1;
const MAX_ORDER = 1_000;
/** The books' fee until a preview says (1%). */
const DEFAULT_FEE_BPS = 100;
/** An amount as "You pay" shows it: whole dollars, or with its cents. */
const amountText = (amount: number) =>
  Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
const LOW_CHANCE = 10_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a world offers, and how it is traded: the product chosen as a belief, what to pay (the
 * fee comes out of it, so an order costs what it says) and what it should pay, then the account
 * steps. Placing the order opens the world if it is new and sends the order to the makers: the
 * ticket then shows their quotes as they arrive (`QuoteBoard`), each firm until its own expiry,
 * and the person accepts one, declines one, or cancels. Nothing fills until a quote is accepted,
 * and until Place nothing is opened or asked: the prices before it are estimates. An order stays
 * open when the page is left (until it is cancelled, accepted or runs out), and the ticket of its
 * world shows it again. */
export function WorldTicket({
  world,
  sentence,
  direction,
  onAmounts,
  onProduct,
  className,
}: {
  world: TicketWorld;
  sentence: SentenceWorld;
  direction: "above" | "below" | null;
  /** What the person pays for each product, fee included (a draft re-prices at the stakes it
   * buys). */
  onAmounts?: (amounts: { allIn: number; moneyBack: number }) => void;
  onProduct?: (product: ProductName) => void;
  className?: string | undefined;
}) {
  const account = useWorldAccount();
  const onboarding = useOnboarding();
  // The product the user chose; until then the first one offered.
  const [product, setProduct] = useState<ProductName | null>(null);
  // What each product's order costs, fee included; and "You pay" as typed, while it is edited.
  const [amounts, setAmounts] = useState({ "All-in": 20, "Money-back": 100 } as Record<
    ProductName,
    number
  >);
  const [payText, setPayText] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<"idle" | "opening" | "asking">("idle");
  const [receipt, setReceipt] = useState<ReceiptOf | null>(null);
  // The order out for quotes, and what it was placed as (the ticket may change underneath).
  const { order, show } = useRfqOrder(account.owner);
  const [placed, setPlaced] = useState<{ product: ProductName; amount: number } | null>(null);
  const [action, setAction] = useState<BoardAction | null>(null);
  /** The order as it stood when a quote was accepted: the board holds still while it fills. */
  const held = useRef<RfqOrder | null>(null);
  /** One request id a quote: accepting the same quote again never fills twice. */
  const clientIds = useRef(new Map<string, string>());

  // An order this wallet left open on this world is its board again: once the world has a book,
  // one read of the wallet's open orders (the API holds them in memory) finds it, and a draft's
  // book is read too, to know the order bets the way the sentence says.
  const bookId = world.kind === "book" ? world.book.id : (world.preview?.existing?.book ?? null);
  const owner = account.owner;
  const resumedFor = useRef<string | null>(null);
  const latest = useRef({ order, phase, amounts, world, direction, onAmounts });
  latest.current = { order, phase, amounts, world, direction, onAmounts };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once a wallet and world; the rest is read when the answer comes.
  useEffect(() => {
    const key = owner && bookId !== null ? `${owner}:${bookId}` : null;
    if (!owner || bookId === null || resumedFor.current === key) return;
    resumedFor.current = key;
    const controller = new AbortController();
    const { signal } = controller;
    let done = false;
    (async () => {
      const open = (await worldsApi.rfq.list(owner, signal)).filter(
        (r) => r.status === "open" && r.book === bookId,
      );
      if (!open.length) return;
      const now = latest.current;
      const live =
        now.world.kind === "book" ? now.world.book : await worldsApi.book(bookId, signal);
      const rfq = open.find((r) => {
        const side = orderWorld(live, r.order.mask).stock?.direction ?? null;
        return !now.direction || !side || side === now.direction;
      });
      const at = latest.current;
      // Placed here meanwhile, or another order already on the board: that one stands.
      if (!rfq || signal.aborted || at.order || at.phase !== "idle") return;
      const resumed: ProductName = rfq.order.conditional ? "Money-back" : "All-in";
      const paid = Math.round(dollars(orderCost(rfq.order, live.feeBps)) * 100) / 100;
      const next = { ...at.amounts, [resumed]: paid };
      setProduct(resumed);
      setAmounts(next);
      at.onAmounts?.({ allIn: next["All-in"], moneyBack: next["Money-back"] });
      setPlaced({ product: resumed, amount: paid });
      show(rfq);
    })()
      .catch(() => {})
      .finally(() => {
        done = true;
      });
    return () => {
      controller.abort();
      // Stopped before its answer (React's development remount, or the world changed): asked
      // again next time.
      if (!done) resumedFor.current = null;
    };
  }, [owner, bookId]);

  const priced = sentence.stock !== null;
  const feeBps =
    world.kind === "book" ? world.book.feeBps : (world.preview?.world.feeBps ?? DEFAULT_FEE_BPS);
  // Each product priced at the stake its order buys.
  const offers = useMemo(() => {
    const stakeOf = (name: ProductName) => stakeWithin(amounts[name], feeBps);
    if (world.kind === "book")
      return bookOffers(
        world.book,
        { allIn: stakeOf("All-in"), moneyBack: stakeOf("Money-back") },
        direction,
      );
    const p = world.preview;
    if (!p?.offer) return [];
    return previewOffers(p.offer, p.marks ?? null, p.world.feeBps, priced).map((o) =>
      atStake(o, stakeOf(o.name)),
    );
  }, [world, amounts, direction, priced, feeBps]);
  const names = offers.map((o) => o.name);
  const offered = offers.find((o) => !o.decline)?.name ?? names[0] ?? "All-in";
  const selected: ProductName = product && names.includes(product) ? product : offered;
  const offer = offers.find((o) => o.name === selected) ?? null;
  useEffect(() => onProduct?.(selected), [selected, onProduct]);
  // A confirmation covers one product of one world only.
  const ackKey = `${selected}:${world.kind === "draft" ? JSON.stringify(world.spec) : world.book.id}`;
  const [ackFor, setAckFor] = useState(ackKey);
  if (ackFor !== ackKey) {
    setAckFor(ackKey);
    setAck(false);
  }

  // The order: what it costs (all of it), the stake it buys and the fee taken from it.
  const amount = amounts[selected];
  const stake = stakeWithin(amount, feeBps);
  const fee = amount - stake;
  const total = amount;
  const lowChance = offer !== null && offer.win < LOW_CHANCE;
  const setAmount = (value: number) => {
    const next = { ...amounts, [selected]: value };
    setAmounts(next);
    onAmounts?.({ allIn: next["All-in"], moneyBack: next["Money-back"] });
  };
  // "You pay" as typed: a whole amount from $1 to $1,000 (one-tap trading's limit a trade).
  const typed = payText === null || payText === "" ? null : Number(payText);
  const payInvalid = typed !== null && !(typed >= MIN_ORDER && typed <= MAX_ORDER);

  // When money comes back.
  const legEnds =
    world.kind === "book"
      ? world.book.legs.map((l) => l.venue?.endTime).filter((x): x is string => Boolean(x))
      : (world.preview?.world.legs.map((l) => l.endTime) ?? []);
  const firstEnd = legEnds.length
    ? legEnds.reduce((a, b) => (Date.parse(a) < Date.parse(b) ? a : b))
    : null;

  const credit = account.credit;
  const needed = credit === null ? null : Math.max(0, total - dollars(credit));
  const neededRaw = needed === null ? 0n : BigInt(Math.ceil(needed + 0.01)) * 1_000_000n;
  const walletDollars = account.walletBalance === null ? null : dollars(account.walletBalance);
  const busy = account.busy || phase !== "idle";
  const decline = !worldsEnabled
    ? "Worlds are not switched on for this network yet"
    : world.kind === "draft" && world.preview?.problems.length
      ? world.preview.problems[0]!
      : (offer?.decline ?? null);

  const place = () =>
    account
      .run(async (assertCurrent) => {
        if (!offer) throw new Error("Nothing to trade yet.");
        // 1. The world's book: a new world is opened first (once per opinion, by anyone).
        let bookId: number | null =
          world.kind === "book" ? world.book.id : (world.preview?.existing?.book ?? null);
        if (bookId === null && world.kind === "draft") {
          if (!world.spec) throw new Error("Nothing to trade yet.");
          setPhase("opening");
          const opened = await worldsApi.open(world.spec);
          bookId = opened.book;
          for (let i = 0; bookId === null && i < 90; i++) {
            await wait(1_000);
            assertCurrent();
            bookId = (await worldsApi.opened(opened.defHash).catch(() => ({ book: null }))).book;
          }
          if (bookId === null)
            throw new Error("Your world is still being opened. Try again in a minute.");
        }
        // 2. The order, sent to the makers: it stays open while their quotes come in.
        setPhase("asking");
        let live: BookView | null = world.kind === "book" ? world.book : null;
        for (let i = 0; !live && i < 30; i++) {
          live = await worldsApi.book(bookId!).catch(() => null);
          if (live) break;
          await wait(1_000);
          assertCurrent();
        }
        const p = live?.products.find((x) => x.key === offer.key);
        if (!live || !p) throw new Error("Your world is not ready yet. Try again shortly.");
        if (!live.tradable) throw new Error("This world is not trading right now.");
        // The stake the order buys: with the books' fee on top, it costs the order's amount.
        const stakeRaw = stakeRawWithin(amount, live.feeBps);
        const rfq = await worldsApi.rfq.open({
          book: bookId,
          mask: p.mask,
          side: "buy",
          stake: stakeRaw.toString(),
          conditional: selected === "Money-back",
          // The person reads each quote and chooses: none is turned away for its price.
          limit: "0",
        });
        assertCurrent();
        setPlaced({ product: selected, amount });
        show(rfq);
      })
      .finally(() => setPhase("idle"));

  // ---------------------------------------------------------------- the order out for quotes

  const rfq = order?.rfq ?? null;
  const act = (next: BoardAction, work: () => Promise<void>) => {
    setAction(next);
    return account.run(work).finally(() => {
      held.current = null;
      setAction(null);
    });
  };
  const filled = (quote: Pick<RfqQuote, "units" | "refund" | "maker">, tx: string) => {
    if (!rfq || !placed) return;
    setReceipt({
      book: rfq.book,
      product: placed.product,
      paid: placed.amount,
      payout: dollars(quote.units),
      refund: dollars(quote.refund),
      maker: quote.maker,
      tx,
    });
    show(null);
    setPlaced(null);
    account.refresh();
  };
  const acceptQuote = (quote: RfqQuote) => {
    if (!order) return;
    held.current = order;
    const id = clientIds.current.get(quote.id) ?? crypto.randomUUID();
    clientIds.current.set(quote.id, id);
    void act({ kind: "accept", quote: quote.id }, async () => {
      const result = await worldsApi.rfq.accept(order.rfq.id, quote.id, id).catch((error) => {
        // A refusal (the quote went, or its fill did not execute) spent nothing: say so.
        if (error instanceof ApiError && [400, 409, 429].includes(error.status))
          throw new Error(`${error.message.replace(/[.\s]+$/, "")}. Nothing was charged.`);
        throw error;
      });
      filled(quote, result.transactionHash);
    });
  };
  const declineQuote = (quote: RfqQuote) =>
    void act({ kind: "decline", quote: quote.id }, async () => {
      if (rfq) show(await worldsApi.rfq.decline(rfq.id, quote.id));
    });
  const askAgain = () =>
    void act({ kind: "again" }, async () => {
      if (rfq) show(await worldsApi.rfq.again(rfq.id));
    });
  const back = () => {
    show(null);
    setPlaced(null);
  };
  const cancelOrder = () =>
    void act({ kind: "cancel" }, async () => {
      if (rfq) await worldsApi.rfq.cancel(rfq.id);
      back();
      toast.add({ title: "Order cancelled. Nothing was charged." });
    });
  // An order that closed without this screen asking: filled (the answer was lost on the way) is
  // shown as the fill it was; cancelled elsewhere, the ticket comes back.
  const status = rfq?.status ?? null;
  const settled = action?.kind === "accept" ? null : status;
  // biome-ignore lint/correctness/useExhaustiveDependencies: acts once on the status it sees.
  useEffect(() => {
    if (settled === "filled" && rfq?.fill?.transactionHash)
      filled({ ...rfq.fill, maker: rfq.fill.maker }, rfq.fill.transactionHash);
    else if (settled === "cancelled") back();
  }, [settled]);

  if (receipt)
    return (
      <Receipt
        receipt={receipt}
        sentence={sentence}
        onAgain={() => setReceipt(null)}
        className={className}
      />
    );
  // While a quote is being filled the board holds the order as it stood.
  const shown = (action?.kind === "accept" ? held.current : null) ?? order;
  if (shown && placed)
    return (
      <QuoteBoard
        order={shown}
        product={placed.product}
        paid={placed.amount}
        failsFrom={firstEnd ? whenDay(firstEnd) : null}
        action={action}
        onAccept={acceptQuote}
        onDecline={declineQuote}
        onAgain={askAgain}
        onCancel={cancelOrder}
        onRestart={() => {
          back();
          void place();
        }}
        onBack={back}
        className={className}
      />
    );

  const refund = offer?.endings.find((e) => e.key === "world-fails")?.pays ?? 0;
  const cost = offer && offer.fair !== null ? Math.max(0, stake - offer.fair) + fee : fee;
  const pricing = world.kind === "draft" && world.pricing;
  return (
    <section
      className={cn(
        "flex flex-col gap-5 rounded-xl bg-card p-4 ring-1 ring-border sm:p-5",
        className,
      )}
    >
      {offers.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          {world.kind === "draft" && world.pricing && !decline ? (
            <Spinner className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" />
          )}
          {decline ??
            (world.kind === "draft" && world.spec === null
              ? "Select an event to see what your world pays"
              : world.kind === "draft" && world.pricing
                ? "Pricing your world…"
                : "No price yet")}
        </div>
      ) : (
        <div className={cn("grid gap-2", offers.length > 1 && "grid-cols-2")}>
          {offers.map((o) => (
            <ProductTile
              key={o.key}
              offer={o}
              paid={amounts[o.name]}
              selected={o.name === selected}
              onSelect={() => setProduct(o.name)}
            />
          ))}
        </div>
      )}

      {offer && !offer.decline && (
        <>
          {/* Amounts in one tap, sharing the ticket's width; any other is typed in "You pay". */}
          <div className="grid grid-cols-4 gap-1.5">
            {STAKES[selected].map((a) => (
              <Button
                key={a}
                size="sm"
                className="h-9 rounded-full px-2 sm:h-8"
                variant={amount === a && payText === null ? "default" : "secondary"}
                onClick={() => {
                  setPayText(null);
                  setAmount(a);
                }}
              >
                ${a}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl bg-secondary/50 p-4">
            <div className="flex items-end justify-between gap-3">
              <label htmlFor="world-ticket-amount" className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">You pay</span>
                <span
                  className={cn(
                    "flex h-10 w-28 items-center rounded-xl bg-background px-3 text-xl font-medium tabular-nums ring-1 ring-border transition-shadow focus-within:ring-2 focus-within:ring-ring/60",
                    payInvalid && "ring-danger/60 focus-within:ring-danger/60",
                  )}
                >
                  <span className="text-muted-foreground">$</span>
                  <input
                    id="world-ticket-amount"
                    value={payText ?? amountText(amount)}
                    inputMode="decimal"
                    enterKeyHint="done"
                    autoComplete="off"
                    aria-invalid={payInvalid}
                    className="w-full min-w-0 bg-transparent pl-0.5 outline-none"
                    onFocus={(e) => {
                      setPayText(amountText(amount));
                      e.currentTarget.select();
                    }}
                    onChange={(e) => {
                      const text = e.target.value.replace(/[^\d.]/g, "");
                      if (!/^\d{0,4}(\.\d{0,2})?$/.test(text)) return;
                      setPayText(text);
                      const v = Number(text);
                      if (text && v >= MIN_ORDER && v <= MAX_ORDER) setAmount(v);
                    }}
                    onBlur={() => {
                      // Back to the order's amount, unless what is typed can't be one.
                      if (!payInvalid) setPayText(null);
                    }}
                  />
                </span>
              </label>
              <div className="flex flex-col items-end gap-1.5">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {pricing && <Spinner className="size-3" />}
                  If you're right
                </span>
                {/* The payout, then how many times what you pay it is. */}
                <span className="flex h-10 items-center gap-2 tabular-nums">
                  <span className="text-xl font-medium text-positive">
                    {offer.payout === null ? "—" : money(offer.payout)}
                  </span>
                  {offer.payout !== null && (
                    <span className="rounded-full bg-positive-soft px-2 py-1 text-base leading-none font-semibold text-positive">
                      {multiple(offer.payout, amount)}
                    </span>
                  )}
                </span>
              </div>
            </div>
            {payInvalid && (
              <p className="text-xs text-danger">
                From {money(MIN_ORDER)} to {money(MAX_ORDER)} an order.
              </p>
            )}
            {refund > 0 && (
              <div className="flex items-center gap-2 text-sm text-info">
                <RotateCcw className="size-4 shrink-0" aria-hidden />
                <span>
                  {money(refund, { cents: true })} back if an event fails
                  {firstEnd && (
                    <span className="text-muted-foreground"> · from {whenDay(firstEnd)}</span>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="-mt-2 flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            <InfoTooltip
              content={
                offer.fair === null
                  ? `${money(fee, { cents: true })} fee, taken from what you pay; the price includes the vault's spread`
                  : `${money(Math.max(0, stake - offer.fair), { cents: true })} spread over the fair price + ${money(fee, { cents: true })} fee, taken from what you pay`
              }
            >
              <span className="inline-flex cursor-help items-center gap-1.5">
                Costs {money(cost, { cents: true })}
                <Info className="size-3.5" />
              </span>
            </InfoTooltip>
            <span>Paid {sentence.stock ? "after the 4 pm close" : "when decided"}</span>
          </div>

          {lowChance && (
            <label
              htmlFor="world-ticket-ack"
              className="flex items-center gap-2.5 rounded-2xl bg-warning-soft/60 px-3.5 py-3 text-sm"
            >
              <Checkbox
                id="world-ticket-ack"
                checked={ack}
                onCheckedChange={(v) => setAck(v === true)}
              />
              <span>Pays only {chancePercent(offer.win)} of the time. Got it.</span>
            </label>
          )}
        </>
      )}

      {offers.length > 0 && decline && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          {decline}
        </div>
      )}

      <TradeButton
        decline={decline}
        waiting={world.kind === "draft" && world.spec === null ? "Select an event" : "Pricing…"}
        offer={offer}
        busy={busy}
        phase={phase}
        account={account}
        needed={needed}
        neededRaw={neededRaw}
        walletDollars={walletDollars}
        total={total}
        product={selected}
        blocked={lowChance && !ack}
        hold={payInvalid ? "Enter an amount to pay" : null}
        onPlace={place}
        onFaucet={onboarding.enabled ? onboarding.show : null}
      />
    </section>
  );
}

function ProductTile({
  offer,
  paid,
  selected,
  onSelect,
}: {
  offer: Offer;
  /** What its order costs, fee included. */
  paid: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const moneyBack = offer.name === "Money-back";
  const Icon = moneyBack ? ShieldCheck : Rocket;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={offer.decline ?? undefined}
      className={cn(
        "relative flex flex-col items-start gap-2.5 rounded-xl p-3.5 text-left ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "bg-primary/8 ring-2 ring-primary" : "ring-border hover:bg-accent/60",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full",
            moneyBack ? "bg-info-soft text-info" : "bg-positive-soft text-positive",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="text-sm font-medium">{offer.name}</span>
        {selected && <Check className="ml-auto size-4 text-primary" aria-hidden />}
      </span>
      {offer.decline ? (
        <span className="text-xs text-muted-foreground">Not offered</span>
      ) : (
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-medium tabular-nums">
            <span className="text-muted-foreground">{money(paid)}</span>
            {" → "}
            <span className="text-positive">
              {offer.payout === null ? "—" : money(offer.payout)}
            </span>
          </span>
          <span className={cn("text-xs", moneyBack ? "text-info" : "text-muted-foreground")}>
            {moneyBack ? `or ${money(offer.stake, { cents: true })} back` : "all or nothing"}
          </span>
        </span>
      )}
    </button>
  );
}

function TradeButton(props: {
  decline: string | null;
  /** What the button says while there is no offer and no reason against one. */
  waiting: string;
  offer: Offer | null;
  busy: boolean;
  phase: string;
  account: ReturnType<typeof useWorldAccount>;
  needed: number | null;
  neededRaw: bigint;
  walletDollars: number | null;
  total: number;
  product: ProductName;
  blocked: boolean;
  /** Why the order can't be placed as it stands (what is typed isn't an amount). */
  hold: string | null;
  onPlace: () => void;
  onFaucet: (() => void) | null;
}) {
  const { account, offer } = props;
  const label =
    props.phase === "opening"
      ? "Opening your world…"
      : props.phase === "asking"
        ? "Asking for quotes…"
        : null;
  if (label)
    return (
      <Button size="lg" disabled className="w-full">
        <Spinner data-icon="inline-start" />
        {label}
      </Button>
    );
  // The reason is shown above the button; the button only says there is nothing to trade.
  if (props.decline || !offer)
    return (
      <Button size="lg" disabled className="w-full">
        {props.decline ? "No quote available" : props.waiting}
      </Button>
    );
  const step = account.step;
  if (step)
    return (
      <Button size="lg" className="w-full" disabled={step.disabled} onClick={step.action}>
        {step.busy && <Spinner data-icon="inline-start" />}
        {step.kind === "sign-in" ? "Sign in to trade" : step.label}
      </Button>
    );
  if (!account.permissionLoaded)
    return (
      <Button size="lg" disabled className="w-full">
        <Spinner data-icon="inline-start" />
        Checking your account…
      </Button>
    );
  if (!account.permission?.active)
    return (
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="w-full"
          disabled={props.busy || !account.permission?.available}
          onClick={account.enable}
        >
          {props.busy && <Spinner data-icon="inline-start" />}
          Turn on one-tap trading
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          One approval · 90 days · up to $1,000 a trade
        </p>
      </div>
    );
  if (props.needed !== null && props.needed > 0.000001) {
    const short = props.walletDollars !== null && props.walletDollars < dollars(props.neededRaw);
    return (
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="w-full"
          disabled={props.busy || short}
          onClick={() => account.deposit(props.neededRaw)}
        >
          {props.busy && <Spinner data-icon="inline-start" />}
          Add {money(dollars(props.neededRaw))}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Balance {money(dollars(account.credit ?? 0n), { cents: true })}
          {props.walletDollars !== null &&
            ` · wallet ${money(props.walletDollars, { cents: true })}`}
          {short && props.onFaucet && (
            <>
              {" "}
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0 align-baseline"
                onClick={props.onFaucet}
              >
                Get test dollars
              </Button>
            </>
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        className="w-full"
        disabled={props.busy || props.blocked || props.hold !== null}
        onClick={props.onPlace}
      >
        {props.hold ??
          (props.blocked ? "Tick the box above" : `Place ${money(props.total, { cents: true })}`)}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Makers send their quotes · you pick one · nothing is charged before
      </p>
    </div>
  );
}

/** A bet that filled: what was paid, what it pays, and who quoted it. */
interface ReceiptOf {
  book: number;
  product: ProductName;
  paid: number;
  payout: number;
  refund: number;
  maker: string;
  tx: string;
}

function Receipt({
  receipt,
  sentence,
  onAgain,
  className,
}: {
  receipt: ReceiptOf;
  sentence: SentenceWorld;
  onAgain: () => void;
  className?: string | undefined;
}) {
  const explorer = explorerFor(protocolConfig);
  const share = () => void shareLink(`${window.location.origin}/worlds/${receipt.book}`);
  return (
    <section
      className={cn(
        "flex flex-col gap-5 rounded-xl bg-card p-4 ring-1 ring-border sm:p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-positive-soft text-positive">
          <Check className="size-4" />
        </span>
        <div className="flex flex-col">
          <h2 className="text-base font-medium">You're in</h2>
          <span className="text-xs text-muted-foreground">
            {receipt.product} · quoted by {receipt.maker}
          </span>
        </div>
      </div>
      <WorldSentence world={sentence} size="card" />
      <dl className="flex flex-col gap-3 border-t pt-4">
        <Fact label="You paid" value={money(receipt.paid, { cents: true })} />
        <Fact
          label="If you're right"
          value={<span className="text-positive">{money(receipt.payout)}</span>}
        />
        {receipt.refund > 0 && (
          <Fact label="If an event fails" value={`${money(receipt.refund)} back`} />
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          className="flex-1"
          render={<Link href={`/worlds/${receipt.book}`} />}
          nativeButton={false}
        >
          See your world
        </Button>
        <Button variant="secondary" onClick={share}>
          <Share2 data-icon="inline-start" />
          Share
        </Button>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <Button variant="link" size="xs" className="h-auto p-0" onClick={onAgain}>
          Trade it again
        </Button>
        {explorer && (
          <a
            href={`${explorer.replace(/\/$/, "")}/tx/${receipt.tx}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            Transaction <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </section>
  );
}
