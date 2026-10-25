"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { marketPath } from "@/lib/markets/identity";
import type { MarketView } from "@/types/api";

/** One event on the portfolio page: its question, a way to trade it, and `children`, the tab's
 * table of its markets (positions, orders, claims or trades). */
export function PortfolioEventCard({
  markets,
  children,
}: {
  markets: MarketView[];
  children: ReactNode;
}) {
  const market = markets[0];
  if (!market) return null;
  const tradeMarket = markets.find((item) => item.lifecycle === "open");

  return (
    <Card className="gap-0 rounded-xl bg-card pt-0 pb-2 ring-0 [&_tr]:border-0">
      <CardHeader className="flex flex-row items-start justify-between gap-5 border-0 px-5 py-6">
        <div className="min-w-0">
          <CardTitle className="text-lg leading-6 font-medium">{market.question}</CardTitle>
        </div>
        {tradeMarket ? (
          <Button
            variant="secondary"
            size="sm"
            render={<Link href={marketPath(tradeMarket)} />}
            nativeButton={false}
          >
            Trade →
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            Trade →
          </Button>
        )}
      </CardHeader>
      <CardContent className="min-w-0 overflow-x-auto px-2.5 pb-0">{children}</CardContent>
    </Card>
  );
}
