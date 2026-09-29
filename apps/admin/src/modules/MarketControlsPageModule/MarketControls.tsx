"use client";

import { lifecycleTransaction } from "@conditional-stocks/evm-client/admin";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, Snowflake } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { QueryStatus } from "@/components/data/QueryStatus";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminConfig } from "@/config/protocol";
import { readVenues } from "@/lib/admin-api";
import { readRoles } from "@/lib/chain";
import { MarketLifecycleAction } from "./MarketLifecycleAction";

interface Market {
  id: string;
  polymarketConditionId: string;
  base: {
    token: string;
    symbol: string | null;
    decimals: number;
    live: { multiplierValue: number; paused: boolean };
  };
  maxMarketOpenNotional: string | null;
  maxOrderNotional: string | null;
  maxWalletOpenNotional: string | null;
  state: number;
  tradingOpen: string | null;
  tradingCutoff: string | null;
}
const states = [
  "none",
  "scheduled",
  "open",
  "frozen",
  "awaiting resolution",
  "resolved",
  "redeemable",
  "archived",
];
export function MarketControls() {
  const query = useQuery({
    queryKey: ["markets", adminConfig.chainId],
    queryFn: ({ signal }) => readVenues<Market>(signal),
    refetchInterval: 10_000,
  });
  const roles = useQuery({
    queryKey: ["roles", adminConfig.exchange],
    queryFn: () => readRoles(),
    staleTime: 60_000,
  });
  const markets = query.data?.markets ?? [];
  return (
    <div className="grid gap-4">
      <QueryStatus query={query} />
      {roles.data &&
        markets.map((market) => (
          <MarketControl
            key={market.id}
            market={market}
            marketAdmin={roles.data.marketAdmin}
            guardian={roles.data.guardian}
          />
        ))}
      {query.isSuccess && markets.length === 0 && (
        <div className="flex min-h-64 items-center justify-center rounded-xl bg-card text-sm text-muted-foreground">
          No canonical markets are indexed.
        </div>
      )}
    </div>
  );
}
function MarketControl({
  market,
  marketAdmin,
  guardian,
}: {
  market: Market;
  marketAdmin: string;
  guardian: string;
}) {
  const admin = useAdmin();
  const [reason, setReason] = useState("");
  const [payload, setPayload] = useState<string | null>(null);
  // Freezing is allowed for the market admin and the guardian.
  const freezer = admin.account === guardian ? guardian : marketAdmin;
  const now = Math.floor(Date.now() / 1000);
  const build = () => {
    const transaction = lifecycleTransaction(
      adminConfig,
      freezer as `0x${string}`,
      Number(market.id),
      1,
      reason,
    );
    setPayload(
      JSON.stringify(
        {
          ...transaction,
          metadata: { marketId: market.id, reason },
        },
        null,
        2,
      ),
    );
  };
  return (
    <Card className="ring-0">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm">
            Market {market.id} · {market.base.symbol ?? market.base.token}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Opens{" "}
            {market.tradingOpen ? new Date(Number(market.tradingOpen) * 1000).toISOString() : "—"} ·
            cutoff{" "}
            {market.tradingCutoff
              ? new Date(Number(market.tradingCutoff) * 1000).toISOString()
              : "—"}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {market.base.token} · ×{market.base.live.multiplierValue}
            {market.base.live.paused ? " · issuer paused" : ""}
          </p>
        </div>
        <Badge
          variant={market.state === 2 ? "positive" : market.state === 3 ? "warning" : "secondary"}
        >
          {states[market.state] ?? "unknown"}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 rounded-xl bg-muted/45 p-4 text-xs sm:grid-cols-3">
          <Fact label="Order cap" value={market.maxOrderNotional ?? "—"} />
          <Fact label="Wallet open-order cap" value={market.maxWalletOpenNotional ?? "—"} />
          <Fact label="Market open-order cap" value={market.maxMarketOpenNotional ?? "—"} />
        </div>
        {market.state === 1 && (
          <>
            {Number(market.tradingOpen ?? 0) > now && (
              <p className="mt-4 text-xs text-muted-foreground">
                The market can open once its trading window starts.
              </p>
            )}
            <MarketLifecycleAction
              marketId={market.id}
              action="openMarket"
              authority={marketAdmin}
            />
          </>
        )}
        {market.state === 2 && Number(market.tradingCutoff ?? 0) <= now && (
          <MarketLifecycleAction
            marketId={market.id}
            action="freezeAtCutoff"
            authority={marketAdmin}
          />
        )}
        {(market.state === 1 || market.state === 2) && (
          <Dialog>
            <DialogTrigger render={<Button className="mt-4" variant="destructive" />}>
              <Snowflake />
              Prepare emergency freeze
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Prepare emergency freeze</DialogTitle>
                <DialogDescription>
                  Freeze this market with the market admin or guardian wallet, or export the payload
                  for a multisig. The exchange enforces these roles for every transaction.
                </DialogDescription>
              </DialogHeader>
              <div>
                <Label htmlFor={`reason-${market.id}`}>Incident reason</Label>
                <Input
                  id={`reason-${market.id}`}
                  className="mt-2"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setPayload(null);
                  }}
                  placeholder="Specific, non-empty incident reference"
                />
              </div>
              <Button variant="destructive" onClick={build} disabled={!reason}>
                Build freeze payload
              </Button>
              {payload && (
                <div className="rounded-xl bg-muted p-3">
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs">
                    {payload}
                  </pre>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(payload)
                        .then(() => toast.success("Payload copied"))
                    }
                  >
                    <ClipboardCopy />
                    Copy transaction
                  </Button>
                </div>
              )}
              {reason.trim() && (
                <MarketLifecycleAction
                  key={reason}
                  marketId={market.id}
                  action="freezeMarket"
                  reason={reason.trim()}
                  authority={freezer}
                />
              )}
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono">{value}</p>
    </div>
  );
}
