import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import type { BranchBook } from "@/lib/api/types";
import { formatNumber, formatUsd } from "@/lib/format/display";

export function OrderBook({ book, branch }: { book: BranchBook; branch: "YES" | "NO" }) {
  const variant = branch === "YES" ? "yes" : "no";
  const max = Math.max(
    1,
    ...book.asks.map((level) => level.quantity),
    ...book.bids.map((level) => level.quantity),
  );
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{branch} stock order book</CardTitle>
        <Badge variant={variant}>
          {book.spread === null ? "One-sided" : `${formatUsd(book.spread)} spread`}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <div className="mb-2 flex justify-between text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              <span>Bid</span>
              <span>Qty</span>
            </div>
            {book.bids.length === 0 ? (
              <p className="py-6 text-xs text-muted-foreground">No bids</p>
            ) : (
              book.bids.map((level) => (
                <div
                  key={level.priceExact}
                  className="relative flex justify-between py-1.5 font-mono text-xs"
                >
                  <span
                    className="absolute inset-y-0 right-0 bg-trade-buy/8"
                    style={{ width: `${(level.quantity / max) * 100}%` }}
                  />
                  <span className="relative text-trade-buy">{formatUsd(level.price)}</span>
                  <span className="relative">{formatNumber(level.quantity)}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="mb-2 flex justify-between text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              <span>Ask</span>
              <span>Qty</span>
            </div>
            {book.asks.length === 0 ? (
              <p className="py-6 text-xs text-muted-foreground">No asks</p>
            ) : (
              book.asks.map((level) => (
                <div
                  key={level.priceExact}
                  className="relative flex justify-between py-1.5 font-mono text-xs"
                >
                  <span
                    className="absolute inset-y-0 left-0 bg-trade-sell/8"
                    style={{ width: `${(level.quantity / max) * 100}%` }}
                  />
                  <span className="relative text-trade-sell">{formatUsd(level.price)}</span>
                  <span className="relative">{formatNumber(level.quantity)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <p className="mt-4 border-t pt-3 text-[11px] leading-5 text-muted-foreground">
          Depth is visible resting liquidity. Your order may fill across several levels; final
          execution is canonical only after onchain indexing.
        </p>
      </CardContent>
    </Card>
  );
}
