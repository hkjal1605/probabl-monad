"use client";

import { conditionalStocksAbi, redeem } from "@conditional-stocks/evm-client";
import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { readContract } from "viem/actions";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { venueDeployment } from "@/config/protocol";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { formatUsd } from "@/lib/format/display";
import {
  claimAmount,
  losingClaims,
  type RedemptionLine,
  redemptionUsd,
  resolvedOutcome,
} from "@/lib/portfolio/redemption";
import { rpc } from "@/lib/trading/rpc";
import { refreshStores } from "@/stores/createResourceStore";
import type { MarketView, PositionView } from "@/types/api";

/** The finalized payout, read from the exchange itself rather than the index. */
async function canonicalPayout(exchange: `0x${string}`, marketId: number) {
  const client = rpc();
  const [terms, book] = await Promise.all([
    readContract(client, {
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "terms",
      args: [marketId],
    }),
    readContract(client, {
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "book",
      args: [marketId],
    }),
  ]);
  if (terms.state !== 6 && terms.state !== 7)
    throw new Error("Redemption is not yet enabled for this market.");
  return [book.payoutYes, book.payoutNo] as const;
}

const OUTCOME_TONE = { YES: "text-positive", NO: "text-danger", INVALID: "text-warning" };

/** Redeems a resolved market's claims in one click: every kind of claim that pays (usually just
 * one), each in its own transaction, at the payout read from the exchange as it runs. What it
 * shows is the review; losing claims are left alone, since redeeming them pays nothing. */
export function RedeemDialog({
  market,
  position,
  lines,
  disabled = false,
  size = "xs",
  className,
}: {
  market: MarketView;
  position: PositionView;
  /** What redeeming pays, from `redemptionLines`. */
  lines: RedemptionLine[];
  disabled?: boolean;
  size?: "xs" | "lg";
  className?: string;
}) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  // The kinds redeemed here: until the index catches up, they still show as held.
  const [redeemed, setRedeemed] = useState<ReadonlySet<0 | 1>>(() => new Set());
  const { busy, run } = useAsyncAction(`${wallet.account ?? ""}:${market.id}`);
  const pending = lines.filter((line) => !redeemed.has(line.collateral));
  const outcome = resolvedOutcome(market);
  const lost = losingClaims(market, position);
  const receive = (items: RedemptionLine[]) =>
    items.map((line) => claimAmount(market, line.collateral, line.plan.credit)).join(" + ");
  const execute = () =>
    run(async (assertCurrent) => {
      if (!wallet.account || !pending.length) throw new Error("Nothing left to redeem.");
      const { exchange } = venueDeployment(market.venue);
      const id = Number(market.venue.marketId);
      const payouts = await canonicalPayout(exchange, id);
      assertCurrent();
      if (payouts[0] !== market.payouts?.[0] || payouts[1] !== market.payouts?.[1])
        throw new Error("The result on chain differs from the one shown. Reload and try again.");
      try {
        for (const line of pending) {
          const { redeemYes, redeemNo } = line.plan;
          await wallet.sendTransaction(redeem(exchange, id, line.collateral, redeemYes, redeemNo));
          assertCurrent();
          setRedeemed((done) => new Set(done).add(line.collateral));
        }
      } finally {
        // What was redeemed leaves the lists once indexed; anything left stays to retry.
        void refreshStores(["positions", "payout-credits"]);
      }
      setOpen(false);
      toast.add({
        type: "success",
        title: `Redeemed ${receive(pending)}. It's in your trading account.`,
      });
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(value, details) => {
        if (busy) details.cancel();
        else setOpen(value);
      }}
    >
      <DialogTrigger
        render={<Button size={size} className={className} disabled={disabled || !pending.length} />}
      >
        {pending.length ? "Redeem" : "Redeemed"}
      </DialogTrigger>
      <DialogContent showCloseButton={!busy} className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Redeem</DialogTitle>
          <DialogDescription>
            {market.ticker} · {market.question}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">
          Resolved{" "}
          <span className={outcome ? OUTCOME_TONE[outcome] : undefined}>{outcome ?? "—"}</span>
          {outcome === "INVALID" && (
            <span className="text-muted-foreground"> · every claim pays half</span>
          )}
          <span className="text-muted-foreground"> · </span>
          <Link
            href={`/resolution?market=${market.id}`}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Evidence
          </Link>
        </p>
        <section aria-label="You receive" className="rounded-lg bg-muted/60 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">You receive</p>
          <ul className="mt-2 flex flex-col gap-3">
            {lines.map((line) => {
              const usd = redemptionUsd(market, [line]);
              const from = (
                [
                  [line.plan.redeemYes, "YES"],
                  [line.plan.redeemNo, "NO"],
                ] as const
              )
                .filter(([raw]) => raw > 0n)
                .map(([raw, branch]) => `${claimAmount(market, line.collateral, raw)}-${branch}`);
              const done = redeemed.has(line.collateral);
              return (
                <li key={line.collateral} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-lg font-medium tabular-nums">
                      {claimAmount(market, line.collateral, line.plan.credit)}
                      {done && <Check aria-label="Redeemed" className="size-4 text-positive" />}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      from {from.join(" and ")}
                    </p>
                  </div>
                  {usd !== null && (
                    <span className="pt-1 text-sm tabular-nums text-muted-foreground">
                      ≈ {formatUsd(usd)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        {lost.length > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {lost.join(" and ")} {lost.length === 1 ? "pays" : "pay"} nothing.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Paid into your trading account.
          {pending.length > 1 && " Each kind of claim takes its own wallet confirmation."}
        </p>
        <Button size="lg" className="w-full" disabled={busy || !pending.length} onClick={execute}>
          {busy && <Spinner data-icon="inline-start" />}
          {busy
            ? lines.length > 1
              ? `Redeeming ${Math.min(redeemed.size + 1, lines.length)} of ${lines.length}…`
              : "Redeeming…"
            : pending.length > 1
              ? `Redeem both · ${pending.length} confirmations`
              : `Redeem ${receive(pending)}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
