"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { tokenText } from "@/lib/delta-vault/amounts";
import { formatProbability, formatUsd, tokenAmount } from "@/lib/format/display";
import { marketPath } from "@/lib/markets/identity";
import type { DeltaVaultView } from "@/services/delta-vaults-api-service";
import type { MarketView } from "@/types/api";

/** Each event the vault quotes: its probability, the vault's YES-minus-NO stock position (the
 * only event risk it keeps) against the cap, and the size of its live quotes. */
export function VaultMarkets({ vault, markets }: { vault: DeltaVaultView; markets: MarketView[] }) {
  const q = vault.quote.decimals ?? 6,
    b = vault.base.decimals ?? 18,
    stock = vault.base.symbol ?? "stock";
  const signed = (raw: string) => {
    const value = BigInt(raw);
    return `${value > 0n ? "+" : value < 0n ? "−" : ""}${tokenText(value < 0n ? -value : value, b, 2)}`;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Events</CardTitle>
        <CardDescription>
          Position is the stock the vault holds if the event happens minus if it does not. Quoting
          stops before the position could pass its cap even if every quote filled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {vault.markets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events are quoted right now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">YES</TableHead>
                <TableHead className="text-right">Position ({stock})</TableHead>
                <TableHead className="text-right">Cap</TableHead>
                <TableHead className="text-right">Quotes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vault.markets.map((vm) => {
                const market = markets.find((m) => m.id === vm.market?.id);
                return (
                  <TableRow key={vm.venueId}>
                    <TableCell className="max-w-72 truncate">
                      {market ? (
                        <Link href={marketPath(market)} className="hover:underline">
                          {market.question}
                        </Link>
                      ) : (
                        `Market ${vm.venueId}`
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatProbability(
                        vm.probability === null ? null : Number(vm.probability) / 1e6,
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {signed(vm.exposure.imbalance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ±{tokenText(BigInt(vm.risk.maxImbalance), b, 2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(tokenAmount(vm.exposure.resting, q))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
