"use client";
import Link from "next/link";
import { TokenIdentity } from "@/components/market/TokenIdentity";
import { Button, buttonVariants } from "@/components/ui/button";
import { useMarketCatalogue } from "@/hooks/useMarketCatalogue";
import { marketPath } from "@/lib/markets/identity";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";
import { relatedMarkets } from "../utils/relatedMarkets";

export function MarketAssetSwitcher({ market }: { market: MarketView }) {
  const catalogue = useMarketCatalogue();
  const assets = relatedMarkets(market, catalogue.markets);
  return (
    <nav
      aria-label="Event assets"
      className={cn(
        "ml-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl p-1 sm:mt-0.5",
        // On a phone a lone asset only repeats the stock token shown with the prices.
        assets.length < 2 && !catalogue.error && "max-[899px]:hidden",
      )}
    >
      {assets.map((asset) => (
        <Link
          key={asset.id}
          href={marketPath(asset)}
          aria-current={asset.id === market.id ? "page" : undefined}
          className={buttonVariants({ variant: asset.id === market.id ? "secondary" : "ghost" })}
        >
          <TokenIdentity
            symbol={asset.ticker}
            metadata={asset.assetMetadata}
            showName={false}
            iconSize="sm"
          />
          {assets.some((other) => other.id !== asset.id && other.assetKey === asset.assetKey) && (
            <span className="text-xs text-muted-foreground">
              / {asset.quoteTokenMetadata?.symbol ?? asset.quoteToken.slice(0, 6)}
            </span>
          )}
        </Link>
      ))}
      {catalogue.error && (
        <Button variant="ghost" size="sm" onClick={catalogue.retry}>
          Retry assets
        </Button>
      )}
    </nav>
  );
}
