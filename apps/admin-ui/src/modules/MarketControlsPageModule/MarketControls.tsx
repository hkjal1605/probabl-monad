"use client";

import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@conditional-stocks/ui-kit/dialog";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, Snowflake } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { encodeFunctionData, keccak256, toBytes } from "viem";
import { adminConfig } from "@/config/protocol";
import { short } from "@/lib/format";

interface Market {
  id: `0x${string}`;
  maxMarketOpenNotional: string | null;
  maxOrderNotional: string | null;
  maxWalletOpenNotional: string | null;
  state: number;
  tradingCutoff: string | null;
}
const abi = [
  {
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "reasonHash", type: "bytes32" },
    ],
    name: "freezeMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
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
    queryKey: ["markets"],
    queryFn: async () => {
      const response = await fetch("/api/indexer/markets", { cache: "no-store" });
      if (!response.ok) throw new Error("Indexer unavailable");
      return response.json() as Promise<{ markets: Market[] }>;
    },
    refetchInterval: 10_000,
  });
  const markets = query.data?.markets ?? [];
  return (
    <div className="mt-8 grid gap-4">
      {markets.map((market) => (
        <MarketControl key={market.id} market={market} />
      ))}
      {markets.length === 0 && (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
          No canonical markets are indexed.
        </div>
      )}
    </div>
  );
}
function MarketControl({ market }: { market: Market }) {
  const [reason, setReason] = useState("");
  const [payload, setPayload] = useState<string | null>(null);
  const build = () => {
    if (!adminConfig.marketRegistry) {
      toast.error("Market registry address is not configured");
      return;
    }
    const reasonHash = keccak256(toBytes(reason));
    const data = encodeFunctionData({
      abi,
      functionName: "freezeMarket",
      args: [market.id, reasonHash],
    });
    setPayload(
      JSON.stringify(
        {
          chainId: adminConfig.chainId,
          data,
          metadata: { marketId: market.id, reason, reasonHash },
          to: adminConfig.marketRegistry,
          value: "0",
        },
        null,
        2,
      ),
    );
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="font-mono text-sm">{short(market.id, 8)}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Cutoff block time {market.tradingCutoff ?? "not indexed"}
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
        {market.state === 2 && (
          <Dialog>
            <DialogTrigger asChild>
              <Button className="mt-4" variant="destructive">
                <Snowflake />
                Prepare guardian freeze
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Prepare emergency freeze</DialogTitle>
                <DialogDescription>
                  This creates a Safe-compatible payload. It does not bypass the onchain guardian
                  role.
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
                    Copy for Safe
                  </Button>
                </div>
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
