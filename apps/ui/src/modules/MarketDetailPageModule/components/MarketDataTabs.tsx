import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@conditional-stocks/ui-kit/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@conditional-stocks/ui-kit/tabs";
import { ArrowUpRight, FileCheck2 } from "lucide-react";
import { protocolConfig } from "@/config/protocol";
import type { MarketView, TradeView } from "@/lib/api/types";
import { displayPrice, formatTime, shortAddress, tokenAmount } from "@/lib/format/display";
import { OrderBook } from "./OrderBook";

export function MarketDataTabs({ market, trades }: { market: MarketView; trades: TradeView[] }) {
  return (
    <Tabs defaultValue="books">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="books">Order books</TabsTrigger>
        <TabsTrigger value="trades">Recent trades</TabsTrigger>
        <TabsTrigger value="terms">Exact terms</TabsTrigger>
        <TabsTrigger value="resolution">Resolution</TabsTrigger>
      </TabsList>
      <TabsContent value="books">
        <div className="grid gap-4 lg:grid-cols-2">
          <OrderBook branch="YES" book={market.yes} />
          <OrderBook branch="NO" book={market.no} />
        </div>
      </TabsContent>
      <TabsContent value="trades">
        <Card>
          <CardHeader>
            <CardTitle>
              {market.sourceMode === "demo" ? "Simulated fills" : "Canonical fills"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trades.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No indexed fills for this market yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Branch</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Transaction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((trade) => (
                    <TableRow key={trade.id}>
                      <TableCell>
                        <Badge variant={trade.branch === 0 ? "yes" : "no"}>
                          {trade.branch === 0 ? "YES" : "NO"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        ${displayPrice(trade.executionPriceRawX18, market).toFixed(2)}
                      </TableCell>
                      <TableCell className="font-mono">
                        {tokenAmount(trade.fillQuantity, market.baseTokenDecimals).toFixed(4)}
                      </TableCell>
                      <TableCell>
                        {formatTime(new Date(Number(trade.blockTimestamp) * 1_000).toISOString())}
                      </TableCell>
                      <TableCell>
                        {market.sourceMode !== "demo" && protocolConfig.explorerUrl ? (
                          <a
                            className="inline-flex items-center gap-1 font-mono text-xs hover:text-brand-strong"
                            href={`${protocolConfig.explorerUrl.replace(/\/$/, "")}/tx/${trade.transactionHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortAddress(trade.transactionHash)}{" "}
                            <ArrowUpRight className="size-3" />
                          </a>
                        ) : (
                          <code>{shortAddress(trade.transactionHash)}</code>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="terms">
        <Card>
          <CardHeader>
            <CardTitle>Immutable market mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="leading-7 text-muted-foreground">{market.description}</p>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Term label="Local market ID" value={market.id} />
              <Term label="Polymarket condition" value={market.mapping.conditionId} />
              <Term label="YES index set" value={market.mapping.yesIndex} />
              <Term label="NO index set" value={market.mapping.noIndex} />
              <Term label="Stock token" value={market.baseToken} />
              <Term label="Quote token" value={market.quoteToken} />
            </dl>
            <Button asChild variant="outline">
              <a
                href={market.mapping.polymarketUrl}
                target={market.sourceMode === "demo" ? undefined : "_blank"}
                rel="noreferrer"
              >
                {market.sourceMode === "demo" ? "View simulated evidence" : "View source market"}{" "}
                <ArrowUpRight />
              </a>
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="resolution">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck2 />
              Manual, evidence-backed resolution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="max-w-3xl leading-7 text-muted-foreground">
              Polymarket data is an informational reference. In v1, an admin prepares a resolution
              packet, a different admin reviews it, and the approved multisig transaction is
              reconciled against the canonical chain. There is no bridge, watcher attestation, or
              automatic settlement message.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <a href={`/resolution?market=${market.id}`}>Open resolution center</a>
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
function Term({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs leading-5">{value}</dd>
    </div>
  );
}
