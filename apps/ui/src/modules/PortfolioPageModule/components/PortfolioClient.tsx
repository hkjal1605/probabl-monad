"use client";

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
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, WalletCards } from "lucide-react";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import type { IndexedOrder, MarketView, PositionView, WholeBalanceView } from "@/lib/api/types";
import { shortAddress, tokenAmount } from "@/lib/format/display";
import { PositionActions } from "./PositionActions";

const fetchJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Canonical portfolio data is unavailable");
  return response.json() as Promise<T>;
};
export function PortfolioClient({ markets }: { markets: MarketView[] }) {
  const wallet = useWallet();
  const demo = useDemo();
  const assets = [
    ...new Map(
      markets.flatMap((market) => [
        [market.baseToken.toLowerCase(), { symbol: market.ticker, token: market.baseToken }],
        [market.quoteToken.toLowerCase(), { symbol: "USDG", token: market.quoteToken }],
      ]),
    ).values(),
  ];
  const positions = useQuery({
    queryKey: ["positions", wallet.account],
    queryFn: () =>
      fetchJson<{ positions: PositionView[] }>(`/api/indexer/positions/${wallet.account}`),
    enabled: Boolean(wallet.account) && !demo,
    refetchInterval: 8_000,
  });
  const orders = useQuery({
    queryKey: ["wallet-orders", wallet.account],
    queryFn: () =>
      fetchJson<{ orders: IndexedOrder[] }>(`/api/indexer/orders?maker=${wallet.account}`),
    enabled: Boolean(wallet.account) && !demo,
    refetchInterval: 8_000,
  });
  const balances = useQuery({
    queryKey: ["whole-balances", wallet.account, assets.map((asset) => asset.token).join(",")],
    queryFn: async () =>
      (
        await Promise.all(
          assets.map(async (asset) => {
            try {
              const balance = await fetchJson<WholeBalanceView>(
                `/api/indexer/balances/${wallet.account}?token=${asset.token}`,
              );
              return { ...asset, balance };
            } catch {
              return null;
            }
          }),
        )
      ).filter((item) => item !== null),
    enabled: Boolean(wallet.account && assets.length > 0) && !demo,
    refetchInterval: 8_000,
  });
  if (!wallet.account)
    return (
      <div className="mt-10 flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-card text-center">
        <WalletCards className="size-7 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Connect your wallet to see positions</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Balances are read from the canonical indexer. Connecting does not grant spending
          permission.
        </p>
        <Button
          className="mt-5"
          variant="brand"
          onClick={() => wallet.connect().catch(() => undefined)}
        >
          Connect wallet
        </Button>
      </div>
    );
  const activeOrders = (demo?.state.orders ?? orders.data?.orders ?? []).filter(
    (order) => order.status === "open",
  );
  const wholeBalances = demo
    ? assets.map((asset) => ({
        ...asset,
        balance: {
          canonicalBalance: demo.state.balances[asset.token.toLowerCase()] ?? "0",
          decimals: asset.symbol === "USDG" ? 6 : 18,
          blockNumber: String(demo.state.tick),
        },
      }))
    : balances.data;
  const rows =
    (demo?.state.positions ?? positions.data?.positions ?? []).filter((position) =>
      [position.stockYes, position.stockNo, position.quoteYes, position.quoteNo].some(
        (value) => BigInt(value) > 0n,
      ),
    ) ?? [];
  const reserved = (marketId: string, side: number) =>
    activeOrders
      .filter((order) => order.marketId === marketId && order.side === side)
      .reduce((total, order) => total + BigInt(order.reserved), 0n);
  const wholeReserved = (token: string) =>
    activeOrders.reduce((total, order) => {
      if (order.fundingKind !== 0) return total;
      const market = markets.find((candidate) => candidate.id === order.marketId);
      if (!market) return total;
      const fundingToken = order.side === 0 ? market.quoteToken : market.baseToken;
      return fundingToken.toLowerCase() === token.toLowerCase()
        ? total + BigInt(order.reserved)
        : total;
    }, 0n);
  return (
    <div className="mt-10 space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Markets with exposure" value={String(rows.length)} />
        <Summary label="Open orders" value={String(activeOrders.length)} />
        <Summary label="Canonical account" value={shortAddress(wallet.account)} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Whole wallet assets</CardTitle>
        </CardHeader>
        <CardContent>
          {!demo && balances.isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Reading canonical balances…
            </p>
          ) : wholeBalances?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {wholeBalances.map(({ balance, symbol, token }) => (
                <div className="rounded-xl border bg-muted/25 p-4" key={token}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{symbol}</p>
                    <code className="text-[10px] text-muted-foreground">{shortAddress(token)}</code>
                  </div>
                  <p className="mt-4 text-2xl font-semibold">
                    {tokenAmount(balance.canonicalBalance, balance.decimals).toFixed(
                      symbol === "USDG" ? 2 : 4,
                    )}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Available in wallet</span>
                    <span>
                      {tokenAmount(wholeReserved(token).toString(), balance.decimals).toFixed(4)}{" "}
                      reserved
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {demo ? "Simulated at tick" : "Canonical at block"} {balance.blockNumber}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Whole-token balances are unavailable from the canonical indexer.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BriefcaseBusiness />
            Conditional claims
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No indexed conditional positions yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Market</TableHead>
                  <TableHead>Stock YES</TableHead>
                  <TableHead>Stock NO</TableHead>
                  <TableHead>Cash YES</TableHead>
                  <TableHead>Cash NO</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((position) => {
                  const market = markets.find((candidate) => candidate.id === position.marketId);
                  return (
                    <TableRow key={position.marketId}>
                      <TableCell>
                        <p className="max-w-56 truncate font-medium">
                          {market?.question ?? shortAddress(position.marketId)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {market?.ticker ?? "Stock"}
                        </p>
                      </TableCell>
                      <TableCell>
                        {tokenAmount(position.stockYes, position.baseTokenDecimals).toFixed(4)}
                      </TableCell>
                      <TableCell>
                        {tokenAmount(position.stockNo, position.baseTokenDecimals).toFixed(4)}
                      </TableCell>
                      <TableCell>
                        {tokenAmount(position.quoteYes, position.quoteTokenDecimals).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {tokenAmount(position.quoteNo, position.quoteTokenDecimals).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            reserved(position.marketId, 0) > 0n ||
                            reserved(position.marketId, 1) > 0n
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {tokenAmount(
                            reserved(position.marketId, 1).toString(),
                            position.baseTokenDecimals,
                          ).toFixed(3)}{" "}
                          stock /{" "}
                          {tokenAmount(
                            reserved(position.marketId, 0).toString(),
                            position.quoteTokenDecimals,
                          ).toFixed(2)}{" "}
                          USDG
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <PositionActions position={position} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-2 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
