import { formatBps } from "@conditional-stocks/evm-client";
import { EVENT_SOURCE_NAMES } from "@conditional-stocks/market-data";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { makerRebateText } from "@/lib/trading/order";
import type { MarketView } from "@/types/api";
export function MarketRules({ market }: { market: MarketView }) {
  const venue = EVENT_SOURCE_NAMES[market.mapping.source];
  return (
    <div className="flex flex-col gap-4 p-5">
      <h3 className="font-semibold">Exact market terms</h3>
      <p className="text-sm leading-6 text-muted-foreground">{market.description}</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        {[
          [`${venue} event condition`, market.mapping.conditionId],
          ["Market", market.id],
          ["YES / NO index", `${market.mapping.yesIndex} / ${market.mapping.noIndex}`],
          ["Cutoff", market.cutoff],
          [`Stock token · ${market.base.symbol}`, market.base.token],
          ["Quote token", market.quoteToken],
          ["Token decimals", String(market.shareDecimals)],
          [
            "Maker / taker fee",
            `${formatBps(market.fees.makerBps)} / ${formatBps(market.fees.takerBps)}`,
          ],
          ["Maker rebate", makerRebateText(market)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all font-mono text-xs">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">
        {venue} is informational. Evidence is independently reviewed before the protocol admin
        executes a resolution transaction. Claims settle against the canonical onchain payout.
      </p>
      <Button
        variant="outline"
        render={<Link href={`/resolution?market=${market.id}`} />}
        nativeButton={false}
      >
        Open resolution center →
      </Button>
    </div>
  );
}
