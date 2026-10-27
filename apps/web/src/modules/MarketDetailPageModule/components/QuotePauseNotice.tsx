"use client";
import { CirclePause } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useQuotePrices } from "@/hooks/useQuotePrices";
import { eventVenue, quotePause } from "@/lib/markets/quote-pause";
import type { MarketView } from "@/types/api";

/** Why a trading market gets no new prices: no vault quotes it, so its chart stops and a market
 * order fills only against orders on the book. It reads the makers' prices the page already
 * streams, so it adds no request. */
export function QuotePauseNotice({ market }: { market: MarketView }) {
  const makers = useQuotePrices();
  const pause = quotePause(market, {
    live: makers.fresh,
    quoted: makers.data?.prices.length ?? 0,
  });
  if (!pause) return null;
  const venue = eventVenue(market.mapping.source);
  return (
    <div className="p-3">
      <Alert role="status" className="border-warning/30 bg-warning-soft">
        <CirclePause className="text-warning" aria-hidden="true" />
        <AlertTitle>New prices are paused</AlertTitle>
        <AlertDescription className="text-foreground/80 [&_p:not(:last-child)]:mb-1.5">
          <p>
            {pause === "probability"
              ? `This market is priced from the live odds on ${venue}, and ${venue}'s order book for this outcome has no usable price right now: one side has no orders, or too few. That usually means the outcome is close to decided, so the vaults have stopped quoting it.`
              : `The odds on ${venue} are live, but no vault is quoting this market right now. A vault pauses a market when one of its safety checks fails, for example when the stock's reference price and the vault's price feed disagree, or just after a sharp move.`}
          </p>
          <p>
            Until quotes return, the chart doesn't update and a market order fills only against
            orders already on the book. Limit orders still work, and quotes resume on their own.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
