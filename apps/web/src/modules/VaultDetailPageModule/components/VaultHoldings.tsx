"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { perShare, tokenText } from "@/lib/delta-vault/amounts";
import { marketPath } from "@/lib/markets/identity";
import type { DeltaVaultView } from "@/services/delta-vaults-api-service";
import type { MarketView } from "@/types/api";
import { unpaired } from "../utils/holdings";

/** What one share owns: plain tokens (paired YES/NO claims count as plain) and each market's
 * unpaired conditional positions, which pay only in the named outcome. */
export function VaultHoldings({
  vault,
  markets,
}: {
  vault: DeltaVaultView;
  markets: MarketView[];
}) {
  const supply = BigInt(vault.totalSupply),
    q = vault.quote.decimals ?? 6,
    b = vault.base.decimals ?? 18,
    quoteSymbol = vault.quote.symbol ?? "quote",
    baseSymbol = vault.base.symbol ?? "stock";
  let quote = BigInt(vault.holdings.quote),
    base = BigInt(vault.holdings.base);
  const conditional = vault.holdings.markets.map((h) => {
    const split = unpaired(h.claims);
    quote += split.paired.quote;
    base += split.paired.base;
    const vm = vault.markets.find((m) => m.venueId === h.venueId);
    return {
      venueId: h.venueId,
      market: markets.find((m) => m.id === vm?.market?.id),
      rows: (
        [
          [split.yesQuote, q, quoteSymbol, "YES"],
          [split.yesBase, b, baseSymbol, "YES"],
          [split.noQuote, q, quoteSymbol, "NO"],
          [split.noBase, b, baseSymbol, "NO"],
        ] as const
      ).filter(([amount]) => amount > 0n),
    };
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>What one {vault.symbol} holds</CardTitle>
        <CardDescription>
          A withdrawal pays these amounts per share: tokens, plus any conditional positions as
          exchange claims you can hold to resolution, sell or merge.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 tabular-nums">
          <div>
            <p className="text-xs text-muted-foreground">{quoteSymbol}</p>
            <p className="text-lg">{tokenText(perShare(quote, supply), q, 6)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{baseSymbol}</p>
            <p className="text-lg">{tokenText(perShare(base, supply), b, 8)}</p>
          </div>
        </div>
        {conditional
          .filter((c) => c.rows.length > 0)
          .map((c) => (
            <div key={c.venueId} className="flex flex-col gap-1 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Conditional ·{" "}
                {c.market ? (
                  <Link href={marketPath(c.market)} className="underline-offset-4 hover:underline">
                    {c.market.question}
                  </Link>
                ) : (
                  `market ${c.venueId}`
                )}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 tabular-nums">
                {c.rows.map(([amount, decimals, symbol, outcome]) => (
                  <span key={`${symbol}-${outcome}`}>
                    {tokenText(perShare(amount, supply), decimals, 8)} {symbol}{" "}
                    <span className="text-muted-foreground">if {outcome}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
