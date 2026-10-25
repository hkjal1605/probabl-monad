"use client";

import Link from "next/link";
import { RedeemDialog } from "@/components/portfolio/RedeemDialog";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePositions } from "@/hooks/useProtocolData";
import { formatUsd } from "@/lib/format/display";
import {
  canRedeem,
  claimAmount,
  redemptionLines,
  redemptionUsd,
  resolvedOutcome,
} from "@/lib/portfolio/redemption";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";

/** In place of the order ticket once a market resolves: its result and, for a member whose claims
 * pay something, what they get and a one-click redemption. */
export function ResolvedMarketCard({ market }: { market: MarketView }) {
  const wallet = useWallet();
  const positions = usePositions();
  const position = positions.positions.find((item) => item.marketId === market.id);
  const outcome = resolvedOutcome(market);
  const redeemable = canRedeem(market);
  const lines = position && redeemable ? redemptionLines(market, position) : null;
  const usd = lines ? redemptionUsd(market, lines) : null;
  return (
    <Card
      variant="sidebar"
      id="trade-ticket"
      aria-label="Market result"
      data-market-id={market.id}
      data-ticker={market.ticker}
    >
      <CardHeader>
        <p className="eyebrow text-muted-foreground">Market resolved</p>
        <CardTitle
          className={cn(
            "text-2xl font-medium",
            outcome === "YES" && "text-positive",
            outcome === "NO" && "text-danger",
            outcome === "INVALID" && "text-warning",
          )}
        >
          {outcome ?? "Result pending"}
        </CardTitle>
        <CardDescription>
          {outcome === "INVALID"
            ? "Every claim pays half."
            : outcome
              ? `${outcome} claims pay out; ${outcome === "YES" ? "NO" : "YES"} claims pay nothing.`
              : "Redemption opens once the result is final."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!wallet.account || !redeemable ? null : positions.isPending ? (
          <Skeleton className="h-24 w-full" aria-label="Loading your claims" />
        ) : lines?.length && position ? (
          <>
            <section aria-label="You receive" className="rounded-lg bg-muted/60 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">You receive</p>
              <p className="mt-1 text-xl font-medium tabular-nums">
                {lines
                  .map((line) => claimAmount(market, line.collateral, line.plan.credit))
                  .join(" + ")}
              </p>
              {usd !== null && (
                <p className="text-sm text-muted-foreground tabular-nums">≈ {formatUsd(usd)}</p>
              )}
            </section>
            <RedeemDialog
              market={market}
              position={position}
              lines={lines}
              disabled={!positions.isDataFresh}
              size="lg"
              className="w-full"
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">You have nothing to redeem here.</p>
        )}
        <Button
          variant="outline"
          render={<Link href={`/resolution?market=${market.id}`} />}
          nativeButton={false}
        >
          View evidence
        </Button>
      </CardContent>
    </Card>
  );
}
