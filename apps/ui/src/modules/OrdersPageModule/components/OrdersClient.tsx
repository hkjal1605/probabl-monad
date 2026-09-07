"use client";

import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent } from "@conditional-stocks/ui-kit/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@conditional-stocks/ui-kit/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Clock3, LoaderCircle, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import type { IndexedOrder, MarketView } from "@/lib/api/types";
import { displayPrice, shortAddress, tokenAmount } from "@/lib/format/display";

const variant = (status: string) =>
  status === "open"
    ? ("positive" as const)
    : status === "filled"
      ? ("brand" as const)
      : ("secondary" as const);
export function OrdersClient({ markets }: { markets: MarketView[] }) {
  const wallet = useWallet();
  const demo = useDemo();
  const queryClient = useQueryClient();
  const [canceling, setCanceling] = useState<string | null>(null);
  const [pendingCancellations, setPendingCancellations] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: ["wallet-orders", wallet.account],
    queryFn: async () => {
      const response = await fetch(`/api/indexer/orders?maker=${wallet.account}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Order history is unavailable");
      return response.json() as Promise<{ orders: IndexedOrder[] }>;
    },
    enabled: Boolean(wallet.account) && !demo,
    refetchInterval: 6_000,
  });
  useEffect(() => {
    const openIds = new Set(
      (query.data?.orders ?? [])
        .filter((order) => order.status === "open")
        .map((order) => order.id),
    );
    setPendingCancellations((current) => {
      const next = new Set([...current].filter((orderHash) => openIds.has(orderHash)));
      return next.size === current.size ? current : next;
    });
  }, [query.data?.orders]);
  const cancel = async (orderHash: string) => {
    setCanceling(orderHash);
    try {
      if (demo) {
        demo.dispatch({ type: "cancel", id: orderHash });
        toast.success("Demo order cancelled. Remaining reservation returned.");
        return;
      }
      const token = wallet.sessionToken ?? (await wallet.authenticate());
      const response = await fetch("/api/gateway/orders/cancel/prepare", {
        body: JSON.stringify({ orderHash }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Cancellation could not be prepared");
      }
      const prepared = (await response.json()) as {
        transaction: { data: string; to: string; value: string };
      };
      const hash = await wallet.sendTransaction(prepared.transaction);
      setPendingCancellations((current) => new Set(current).add(orderHash));
      toast.success(`Cancellation pending onchain: ${hash.slice(0, 10)}…`);
      await queryClient.invalidateQueries({ queryKey: ["wallet-orders", wallet.account] });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Cancellation failed");
    } finally {
      setCanceling(null);
    }
  };
  if (!wallet.account)
    return (
      <div className="mt-10 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed bg-card text-center">
        <WalletCards className="text-muted-foreground" />
        <p className="mt-4 font-semibold">Connect to see canonical orders</p>
        <Button
          className="mt-5"
          variant="brand"
          onClick={() => wallet.connect().catch(() => undefined)}
        >
          Connect wallet
        </Button>
      </div>
    );
  const orders = demo ? [...demo.state.orders].reverse() : (query.data?.orders ?? []);
  return (
    <Card className="mt-10">
      <CardContent>
        {orders.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No indexed orders for this wallet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead>Filled / quantity</TableHead>
                <TableHead>Fees paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hash</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const market = markets.find((candidate) => candidate.id === order.marketId);
                const filled = BigInt(order.quantity) - BigInt(order.remaining);
                const status =
                  order.status === "open" && filled > 0n ? "partially filled" : order.status;
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <p className="max-w-48 truncate font-medium">
                        {market?.question ?? shortAddress(order.marketId)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.branch === 0 ? "yes" : "no"}>
                        {order.side === 0 ? "Buy" : "Sell"} {order.branch === 0 ? "YES" : "NO"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {market
                        ? `$${displayPrice(order.limitPriceRawX18, market).toFixed(2)}`
                        : "Units unavailable"}
                    </TableCell>
                    <TableCell>
                      {market
                        ? `${tokenAmount(filled.toString(), market.baseTokenDecimals).toFixed(3)} / ${tokenAmount(order.quantity, market.baseTokenDecimals).toFixed(3)}`
                        : "Units unavailable"}
                    </TableCell>
                    <TableCell>
                      {market && order.feesPaid !== undefined
                        ? `${tokenAmount(order.feesPaid, order.side === 0 ? market.baseTokenDecimals : market.quoteTokenDecimals)} ${order.side === 0 ? market.ticker : "USDG"} ${order.branch === 0 ? "YES" : "NO"} claims`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={variant(order.status)}>{status}</Badge>
                        {order.confirmation && (
                          <span className="text-[10px] text-muted-foreground">
                            {order.confirmation} chain state
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{shortAddress(order.id)}</code>
                    </TableCell>
                    <TableCell>
                      {order.status === "open" && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => cancel(order.id)}
                          disabled={canceling === order.id || pendingCancellations.has(order.id)}
                        >
                          {canceling === order.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : pendingCancellations.has(order.id) ? (
                            <Clock3 />
                          ) : (
                            <Ban />
                          )}
                          {pendingCancellations.has(order.id) ? "Pending chain" : "Cancel"}
                        </Button>
                      )}
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
