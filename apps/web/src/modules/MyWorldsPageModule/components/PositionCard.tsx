"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { WorldSentence } from "@/components/worlds/Sentence";
import type { WorldAccount } from "@/hooks/useWorldAccount";
import { cn } from "@/lib/utils";
import {
  calendarDay,
  chancePercent,
  dollars,
  legLabel,
  money,
  moneyRaw,
  nyDay,
  percent,
  stockPrice,
  venueResult,
  whenDay,
} from "@/lib/worlds/format";
import { outcomeAtoms } from "@/lib/worlds/offer";
import type { BookView, PositionView } from "@/lib/worlds/types";
import { sentenceOf } from "@/modules/WorldDetailPageModule/components/WorldDetail";
import { worldsApi } from "@/services/worlds-api";

/** A position as a story in progress: each event ticked, open or failed with its odds today,
 * the stock against its price, what it is worth and pays, and what happens next. */
export function PositionCard({
  position,
  book,
  paid,
  account,
  onChanged,
}: {
  position: PositionView;
  book: BookView | undefined;
  paid: number;
  account: WorldAccount;
  onChanged: () => void;
}) {
  const [cashing, setCashing] = useState(false);
  const refund = BigInt(position.refund) > 0n;
  const layer = position.layers.find((l) => l.outcome) ?? null;
  const direction = (
    layer?.outcome?.kind === "above" || layer?.outcome?.kind === "below" ? layer.outcome.kind : null
  ) as "above" | "below" | null;
  const sentence = book ? sentenceOf(book, direction ?? book.opinion?.direction ?? null) : null;
  const decided = book ? ["failed", "passed", "fixed"].includes(book.state) : false;
  const winAtoms = book && layer?.outcome ? outcomeAtoms(layer.outcome, book.atoms) : [];
  const winChance = book?.marks ? winAtoms.reduce((s, a) => s + (book.marks![a] ?? 0), 0) : null;
  const spot =
    book?.analytics?.spot && book.feedDecimals !== null
      ? book.analytics.spot / 10 ** book.feedDecimals
      : null;
  const strike = book?.opinion?.strike ? Number(book.opinion.strike) : null;
  const nextLeg = book?.legs
    .filter((l) => l.outcome === null && l.venue)
    .sort((a, b) => Date.parse(a.venue!.endTime) - Date.parse(b.venue!.endTime))[0];

  return (
    <article className="flex flex-col gap-4 rounded-2xl bg-card p-4 ring-1 ring-border sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
              refund ? "bg-info-soft text-info" : "bg-brand-soft text-brand-strong",
            )}
          >
            {refund ? "Money-back" : "All-in"}
          </span>
          {paid > 0 && <span>you paid {money(paid, { cents: true })}</span>}
        </span>
        <Link href={`/worlds/${position.book}`} className="hover:text-foreground">
          World #{position.book} →
        </Link>
      </div>
      {sentence ? (
        <WorldSentence world={sentence} size="card" />
      ) : (
        <div className="h-6 w-2/3 rounded bg-secondary" />
      )}

      {book && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {book.legs.map((l) => {
            const q = book.analytics?.legs.find((x) => x.eventKey === l.eventKey)?.chance ?? null;
            const yes = q === null ? null : (l.wantYes ? q : 1_000_000 - q) / 1e6;
            return (
              <li key={l.eventKey} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-0.5 w-4 shrink-0 text-center text-xs",
                    l.outcome === "passed"
                      ? "text-positive"
                      : l.outcome === "failed"
                        ? "text-danger"
                        : "text-muted-foreground",
                  )}
                >
                  {l.outcome === "passed" ? "✓" : l.outcome === "failed" ? "✗" : "●"}
                </span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {!l.wantYes && <span className="font-medium text-danger">NO · </span>}
                  {l.venue?.question ?? "An event"}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {l.outcome !== null
                    ? venueResult(l.state)
                    : yes !== null
                      ? `YES ${percent(yes)}`
                      : ""}
                </span>
              </li>
            );
          })}
          {book.opinion?.symbol && strike !== null && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 w-4 shrink-0 text-center text-xs text-muted-foreground">
                ◷
              </span>
              <span className="min-w-0 flex-1 text-muted-foreground">
                {book.opinion.symbol} {spot !== null ? `${stockPrice(spot)} now` : ""} → needs{" "}
                {direction === "below" ? "<" : "≥"} {stockPrice(strike)} on{" "}
                {book.opinion.fixingDate ? calendarDay(book.opinion.fixingDate) : "the date"}
              </span>
              {spot !== null && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.abs((strike / spot - 1) * 100).toFixed(1)}% away
                </span>
              )}
            </li>
          )}
        </ul>
      )}

      <div className="grid grid-cols-3 gap-3 border-t pt-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">Worth now</span>
          <span className="text-base font-medium tabular-nums">
            {position.value === null ? "—" : moneyRaw(position.value, { cents: true })}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {decided ? "Pays" : "If right"}
          </span>
          <span className="text-base font-medium tabular-nums text-positive">
            {decided ? moneyRaw(position.payout ?? "0") : moneyRaw(position.maxPayout)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">Chance now</span>
          <span className="text-base font-medium tabular-nums">
            {decided ? "—" : chancePercent(winChance)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-4 text-muted-foreground">
          {decided
            ? position.redeemable
              ? `Settled. Collect ${moneyRaw(position.payout ?? "0")} into your world balance.`
              : "Settled."
            : nextLeg
              ? refund
                ? `Next: ${whenDay(nextLeg.venue!.endTime)}. If that event doesn't happen, your stake comes back that day.`
                : `Next: ${whenDay(nextLeg.venue!.endTime)}, when “${legLabel(nextLeg.venue!.question)}” is decided.`
              : book?.fixingTime
                ? `Every event happened. Paid after the close on ${nyDay(Number(book.fixingTime))}.`
                : ""}
        </p>
        {position.redeemable ? (
          <RedeemButton book={position.book} account={account} onDone={onChanged} />
        ) : !decided && book?.tradable ? (
          <Button variant="secondary" size="sm" onClick={() => setCashing(true)}>
            Cash out
          </Button>
        ) : null}
      </div>
      <CashOutDialog
        open={cashing}
        onOpenChange={setCashing}
        position={position}
        account={account}
        onDone={() => {
          setCashing(false);
          onChanged();
        }}
      />
    </article>
  );
}

function RedeemButton({
  book,
  account,
  onDone,
}: {
  book: number;
  account: WorldAccount;
  onDone: () => void;
}) {
  return (
    <Button
      size="sm"
      disabled={account.busy}
      onClick={() =>
        account.run(async (assertCurrent) => {
          const { redeemTransactions } = await import("@/lib/worlds/account");
          const txs = await redeemTransactions([book]);
          await account.sendAll(txs, assertCurrent);
          toast.add({ type: "success", title: "Collected into your world balance" });
          onDone();
        })
      }
    >
      {account.busy && <Spinner data-icon="inline-start" />}
      Collect
    </Button>
  );
}

/** A cash-out at the vault's firm bid: the quote first, then one tap fills it (or nothing does
 * when the bid has moved down more than 2%). */
function CashOutDialog({
  open,
  onOpenChange,
  position,
  account,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: PositionView;
  account: WorldAccount;
  onDone: () => void;
}) {
  const [quote, setQuote] = useState<{ price: number; fee: number; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const order = (() => {
    const layer = position.layers.find((l) => l.outcome);
    return {
      book: position.book,
      mask: layer?.mask ?? 0,
      side: "sell",
      units: layer?.units ?? "0",
      refund: position.refund,
    };
  })();
  // biome-ignore lint/correctness/useExhaustiveDependencies: one quote per opening.
  useEffect(() => {
    if (!open) return;
    setQuote(null);
    setError(null);
    worldsApi
      .quote({ ...order, limit: "1" })
      .then((q) => {
        const price = dollars(q.quote.price);
        const fee = q.cost ? dollars(q.cost.fee) : 0;
        setQuote({ price, fee, at: Date.now() });
      })
      .catch((e: Error) => setError(e.message));
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cash out now</DialogTitle>
          <DialogDescription>The vault buys your position back at its bid.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !quote ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Asking the vault…
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-3xl font-medium tabular-nums">
              {money(quote.price - quote.fee, { cents: true })}
            </span>
            <span className="text-xs text-muted-foreground">
              {money(quote.price, { cents: true })} bid − {money(quote.fee, { cents: true })} fee.
              Worth {position.value ? moneyRaw(position.value, { cents: true }) : "—"} at the
              vault's middle price.
            </span>
          </div>
        )}
        <Button
          size="lg"
          disabled={!quote || account.busy}
          onClick={() =>
            account.run(async () => {
              const limit = BigInt(Math.floor(quote!.price * 0.98 * 1_000_000));
              await worldsApi.prepare("worlds/cashout", {
                order: { ...order, limit: limit.toString() },
                clientId: crypto.randomUUID(),
              });
              toast.add({ type: "success", title: "Cashed out into your world balance" });
              onDone();
            })
          }
        >
          {account.busy && <Spinner data-icon="inline-start" />}
          Cash out
        </Button>
      </DialogContent>
    </Dialog>
  );
}
