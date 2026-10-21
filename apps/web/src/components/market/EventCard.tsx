import Link from "next/link";
import { memo } from "react";
import { Avatar, AvatarFallback, AvatarLazyImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { marketPath } from "@/lib/markets/identity";
import { currentSpotUsd, eventMonogram } from "@/lib/markets/presentation";
import type { MarketView } from "@/types/api";
import { OutcomePrice } from "./OutcomePrice";
import { ProbabilityGauge } from "./ProbabilityGauge";
import { formatSpotUsd } from "./SpotReference";
import { TokenIdentity } from "./TokenIdentity";

function EventCardView({ markets }: { markets: MarketView[] }) {
  const market = markets[0];
  if (!market) return null;
  return (
    <Card variant="market" className="min-w-0">
      <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Avatar className="size-12 self-start rounded-xl after:rounded-xl">
          {market.imageUrl && (
            <AvatarLazyImage
              src={market.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="absolute inset-0 rounded-lg"
            />
          )}
          <AvatarFallback className="absolute inset-0 rounded-xl">
            {eventMonogram(market)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <CardTitle role="heading" aria-level={2}>
            <Link href={marketPath(market)}>{market.question}</Link>
          </CardTitle>
        </div>
        <ProbabilityGauge
          probability={market.probability}
          conditionId={market.mapping.conditionId}
        />
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead className="px-2">Asset</TableHead>
              <TableHead className="px-2">If YES</TableHead>
              <TableHead className="px-2 text-center">Spot</TableHead>
              <TableHead className="text-right">If NO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {markets.map((asset) => {
              const spot = currentSpotUsd(asset);
              return (
                <TableRow key={asset.id} className="relative border-0">
                  <TableCell className="w-px px-2">
                    <Link
                      href={marketPath(asset)}
                      className="after:absolute after:inset-0"
                      aria-label={`Open ${asset.ticker} market: ${asset.question}`}
                    >
                      <TokenIdentity
                        symbol={asset.ticker}
                        metadata={asset.assetMetadata}
                        showName={false}
                      />
                    </Link>
                  </TableCell>
                  <TableCell className="w-1/3 px-0">
                    <OutcomePrice market={asset} branch="YES" />
                  </TableCell>
                  <TableCell className="w-px px-2 text-center text-xs font-medium tabular-nums">
                    {spot === null ? "—" : formatSpotUsd(spot)}
                  </TableCell>
                  <TableCell className="w-1/3 pl-0 pr-2">
                    <OutcomePrice market={asset} branch="NO" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Re-renders only when its event's markets changes, not with every list update. */
export const EventCard = memo(EventCardView);
