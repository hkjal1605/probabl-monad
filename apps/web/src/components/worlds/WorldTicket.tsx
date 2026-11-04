"use client";
import { Check, ExternalLink, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { explorerFor, protocolConfig, worldsEnabled } from "@/config/protocol";
import { useWorldAccount } from "@/hooks/useWorldAccount";
import { cn } from "@/lib/utils";
import {
  calendarDay,
  dollars,
  inThousand,
  money,
  multiple,
  perThousand,
  shortWallet,
  whenDay,
} from "@/lib/worlds/format";
import {
  atStake,
  bookOffers,
  type Offer,
  type ProductName,
  previewOffers,
} from "@/lib/worlds/offer";
import type { BookView, Preview, Spec } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import { Fact } from "./primitives";
import { type SentenceWorld, WorldSentence } from "./Sentence";

export type TicketWorld =
  | { kind: "draft"; spec: Spec; preview: Preview | null; pricing: boolean }
  | { kind: "book"; book: BookView };

const STAKES: Record<ProductName, number[]> = {
  "All-in": [10, 20, 50, 100],
  "Money-back": [50, 100, 250, 500],
};
/** How far the price may move between the offer shown and the fill. */
const TOLERANCE = 0.03;
const LOW_CHANCE = 10_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a world offers, and the one gesture that trades it: the product chosen as a belief, a
 * stake, the four numbers that matter at equal weight, the cost in dollars, then the account
 * steps and the trade. Fills are RFQ only: a maker's firm quote at the moment of the trade. */
export function WorldTicket({
  world,
  sentence,
  direction,
  onStakes,
  onProduct,
  className,
}: {
  world: TicketWorld;
  sentence: SentenceWorld;
  direction: "above" | "below" | null;
  /** The stakes the offer is priced at (a draft re-prices at them). */
  onStakes?: (stakes: { allIn: number; moneyBack: number }) => void;
  onProduct?: (product: ProductName) => void;
  className?: string | undefined;
}) {
  const account = useWorldAccount();
  const onboarding = useOnboarding();
  // The product the user chose; until then the first one offered.
  const [product, setProduct] = useState<ProductName | null>(null);
  const [stakes, setStakes] = useState({ "All-in": 20, "Money-back": 100 } as Record<
    ProductName,
    number
  >);
  const [custom, setCustom] = useState("");
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<"idle" | "opening" | "pricing" | "placing">("idle");
  const [receipt, setReceipt] = useState<{
    book: number;
    product: ProductName;
    paid: number;
    payout: number;
    refund: number;
    tx: string;
  } | null>(null);
  const clientId = useRef<string | null>(null);

  const priced = sentence.stock !== null;
  const offers = useMemo(() => {
    if (world.kind === "book")
      return bookOffers(
        world.book,
        { allIn: stakes["All-in"], moneyBack: stakes["Money-back"] },
        direction,
      );
    const p = world.preview;
    if (!p?.offer) return [];
    return previewOffers(p.offer, p.marks ?? null, p.world.feeBps, priced).map((o) =>
      atStake(o, stakes[o.name]),
    );
  }, [world, stakes, direction, priced]);
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

  const stake = stakes[selected];
  const fee =
    offer?.fee ??
    (stake * (world.kind === "book" ? world.book.feeBps : (world.preview?.world.feeBps ?? 100))) /
      10_000;
  const total = stake + fee;
  const lowChance = offer !== null && offer.win < LOW_CHANCE;
  const setStake = (value: number) => {
    const next = { ...stakes, [selected]: value };
    setStakes(next);
    onStakes?.({ allIn: next["All-in"], moneyBack: next["Money-back"] });
  };

  // When money comes back.
  const legEnds =
    world.kind === "book"
      ? world.book.legs.map((l) => l.venue?.endTime).filter((x): x is string => Boolean(x))
      : (world.preview?.world.legs.map((l) => l.endTime) ?? []);
  const firstEnd = legEnds.length
    ? legEnds.reduce((a, b) => (Date.parse(a) < Date.parse(b) ? a : b))
    : null;
  const lastEnd = legEnds.length
    ? legEnds.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b))
    : null;
  const paidOn = sentence.stock
    ? "after the 4 pm New York close that day"
    : lastEnd
      ? `when the last event is decided (by ${whenDay(lastEnd)})`
      : "—";

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
        clientId.current ??= crypto.randomUUID();
        // 1. The world's book: a new world is opened first (once per opinion, by anyone).
        let bookId: number | null =
          world.kind === "book" ? world.book.id : (world.preview?.existing?.book ?? null);
        if (bookId === null && world.kind === "draft") {
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
        // 2. A live price for it from the makers (a new world's first takes a few seconds).
        setPhase("pricing");
        let live: BookView | null = null;
        for (let i = 0; i < 45; i++) {
          live = await worldsApi.book(bookId!).catch(() => null);
          if (live?.products.find((p) => p.key === offer.key)?.ask) break;
          await wait(1_000);
          assertCurrent();
        }
        const p = live?.products.find((x) => x.key === offer.key);
        if (!live || !p?.ask)
          throw new Error("No maker is quoting this world right now. Try again shortly.");
        if (!live.tradable) throw new Error("This world is not trading right now.");
        const units = stake / (p.ask / 1_000_000);
        const minUnits = BigInt(Math.floor(units * (1 - TOLERANCE) * 1_000_000));
        // 3. The trade: an RFQ, filled by the trading delegate within the grant.
        setPhase("placing");
        const stakeRaw = BigInt(Math.round(stake * 100)) * 10_000n;
        const result = await worldsApi.submit(
          {
            book: bookId,
            mask: p.mask,
            side: "buy",
            stake: stakeRaw.toString(),
            conditional: selected === "Money-back",
            limit: minUnits.toString(),
          },
          clientId.current,
        );
        clientId.current = null;
        const award = result.rfq?.award;
        setReceipt({
          book: bookId!,
          product: selected,
          paid: stake + fee,
          payout: award ? dollars(award.units) : units,
          refund: award ? dollars(award.refund) : selected === "Money-back" ? stake : 0,
          tx: result.transactionHash,
        });
        account.refresh();
      })
      .finally(() => setPhase("idle"));

  if (receipt)
    return (
      <Receipt
        receipt={receipt}
        sentence={sentence}
        onAgain={() => setReceipt(null)}
        className={className}
      />
    );

  return (
    <section
      className={cn(
        "flex flex-col gap-5 rounded-2xl bg-card p-4 ring-1 ring-border sm:p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium">What we can offer</h2>
        {world.kind === "draft" && world.pricing && (
          <Spinner className="size-4 text-muted-foreground" />
        )}
      </div>

      {offers.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          {decline ??
            (world.kind === "draft" && world.pricing ? "Pricing your world…" : "No price yet.")}
        </div>
      ) : (
        <div className={cn("grid gap-2", offers.length > 1 && "grid-cols-2")}>
          {offers.map((o) => (
            <ProductTile
              key={o.key}
              offer={o}
              selected={o.name === selected}
              onSelect={() => setProduct(o.name)}
            />
          ))}
        </div>
      )}

      {offer && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Your stake</span>
            <div className="flex flex-wrap gap-1.5">
              {STAKES[selected].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={stake === s && !custom ? "default" : "secondary"}
                  onClick={() => {
                    setCustom("");
                    setStake(s);
                  }}
                >
                  ${s}
                </Button>
              ))}
              <Input
                value={custom}
                inputMode="decimal"
                placeholder="Other"
                aria-label="Other stake in dollars"
                className="h-7 w-20 text-sm"
                onChange={(e) => {
                  const text = e.target.value.replace(/[^\d.]/g, "");
                  setCustom(text);
                  const v = Number(text);
                  if (v >= 1 && v <= 1_000) setStake(Math.round(v * 100) / 100);
                }}
              />
            </div>
          </div>

          <dl className="flex flex-col gap-3 border-t pt-4">
            <Fact
              label="You pay"
              value={money(total, { cents: true })}
              note={`${money(stake, { cents: true })} stake + ${money(fee, { cents: true })} fee. The most you can lose.`}
            />
            <Fact
              label="If you're right"
              value={
                <span className="text-positive">
                  {offer.payout === null
                    ? "—"
                    : `${money(offer.payout)} · ${multiple(offer.payout, stake)}`}
                </span>
              }
            />
            <Fact
              label="Chance it pays"
              value={inThousand(offer.win)}
              note={
                selected === "Money-back"
                  ? `${inThousand(offer.endings.find((e) => e.key === "world-fails")?.chance)} your ${money(stake)} comes back instead`
                  : undefined
              }
            />
            <Fact
              label={selected === "Money-back" ? "Paid, or back" : "Paid"}
              value={
                sentence.stock ? calendarDay(sentence.stock.date) : lastEnd ? whenDay(lastEnd) : "—"
              }
              note={
                selected === "Money-back" && firstEnd
                  ? `Paid ${paidOn}. Your stake comes back the day an event fails, from ${whenDay(firstEnd)}.`
                  : `Paid ${paidOn}.`
              }
            />
            <Fact
              label="What it costs"
              value={
                offer.fair === null
                  ? money(fee, { cents: true })
                  : money(Math.max(0, stake - offer.fair) + fee, { cents: true })
              }
              note={
                offer.fair === null
                  ? "The fee. The price includes the vault's spread."
                  : `${money(Math.max(0, stake - offer.fair), { cents: true })} spread over the fair price, plus the ${money(fee, { cents: true })} fee.`
              }
            />
          </dl>

          {lowChance && (
            <label
              htmlFor="world-ticket-ack"
              className="flex items-start gap-2.5 rounded-xl bg-warning-soft/60 p-3 text-sm leading-5"
            >
              <Checkbox
                id="world-ticket-ack"
                checked={ack}
                onCheckedChange={(v) => setAck(v === true)}
                className="mt-0.5"
              />
              <span>
                I understand this pays only if every event happens
                {sentence.stock
                  ? ` and ${sentence.stock.symbol} ends ${sentence.stock.direction} $${Number(sentence.stock.strike).toLocaleString("en-US")}`
                  : ""}
                : about {perThousand(offer.win)} in 1,000.
              </span>
            </label>
          )}
        </>
      )}

      <TradeButton
        decline={decline}
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
        onPlace={place}
        onFaucet={onboarding.enabled ? onboarding.show : null}
      />
      <p className="text-xs leading-4 text-muted-foreground">
        Your position will be public on this world's page
        {account.owner ? ` as ${shortWallet(account.owner)}` : ""}. Priced by the vault over RFQ: if
        the price moves more than {Math.round(TOLERANCE * 100)}% before it fills, nothing is bought.
      </p>
    </section>
  );
}

function ProductTile({
  offer,
  selected,
  onSelect,
}: {
  offer: Offer;
  selected: boolean;
  onSelect: () => void;
}) {
  const moneyBack = offer.name === "Money-back";
  return (
    <Button
      variant="outline"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "h-auto flex-col items-start gap-2 rounded-xl px-3 py-3 text-left whitespace-normal",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/60",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-medium">{offer.name}</span>
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full border",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
          )}
        >
          {selected && <Check className="size-3" />}
        </span>
      </span>
      <span className="text-xs leading-4 font-normal text-muted-foreground">
        {moneyBack ? "If it doesn't happen, your stake comes back" : "Bet it all happens"}
      </span>
      <span className="text-base font-medium tabular-nums">
        {money(offer.stake)} →{" "}
        <span className="text-positive">{offer.payout === null ? "—" : money(offer.payout)}</span>
      </span>
      <span className="text-xs font-normal tabular-nums text-muted-foreground">
        {offer.payout === null ? "—" : multiple(offer.payout, offer.stake)} ·{" "}
        {inThousand(offer.win)}
      </span>
      {offer.decline && <span className="text-xs font-normal text-warning">{offer.decline}</span>}
    </Button>
  );
}

function TradeButton(props: {
  decline: string | null;
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
  onPlace: () => void;
  onFaucet: (() => void) | null;
}) {
  const { account, offer } = props;
  const label =
    props.phase === "opening"
      ? "Opening your world…"
      : props.phase === "pricing"
        ? "Getting your price…"
        : props.phase === "placing"
          ? "Placing…"
          : null;
  if (label)
    return (
      <Button size="lg" disabled className="w-full">
        <Spinner data-icon="inline-start" />
        {label}
      </Button>
    );
  if (props.decline || !offer)
    return (
      <Button size="lg" disabled className="w-full">
        {props.decline ?? "Pricing…"}
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
        <p className="text-xs leading-4 text-muted-foreground">
          One wallet approval lets your trades fill in one tap for 90 days, up to $1,000 a trade.
          You can turn it off any time.
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
          Add {money(dollars(props.neededRaw))} to your world balance
        </Button>
        <p className="text-xs leading-4 text-muted-foreground">
          Your world balance is {money(dollars(account.credit ?? 0n), { cents: true })}
          {props.walletDollars !== null &&
            `; your wallet has ${money(props.walletDollars, { cents: true })}`}
          .
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
    <Button
      size="lg"
      className="w-full"
      disabled={props.busy || props.blocked}
      onClick={props.onPlace}
    >
      {props.blocked
        ? "Confirm the chance above"
        : `Place ${money(props.total, { cents: true })} on ${props.product}`}
    </Button>
  );
}

function Receipt({
  receipt,
  sentence,
  onAgain,
  className,
}: {
  receipt: {
    book: number;
    product: ProductName;
    paid: number;
    payout: number;
    refund: number;
    tx: string;
  };
  sentence: SentenceWorld;
  onAgain: () => void;
  className?: string | undefined;
}) {
  const explorer = explorerFor(protocolConfig);
  const share = () => {
    const url = `${window.location.origin}/worlds/${receipt.book}`;
    void navigator.clipboard?.writeText(url).then(
      () => toast.add({ type: "success", title: "Link copied" }),
      () => toast.add({ type: "error", title: url }),
    );
  };
  return (
    <section
      className={cn(
        "flex flex-col gap-5 rounded-2xl bg-card p-4 ring-1 ring-border sm:p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-positive-soft text-positive">
          <Check className="size-4" />
        </span>
        <div className="flex flex-col">
          <h2 className="text-base font-medium">You're in</h2>
          <span className="text-xs text-muted-foreground">{receipt.product} · filled over RFQ</span>
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
