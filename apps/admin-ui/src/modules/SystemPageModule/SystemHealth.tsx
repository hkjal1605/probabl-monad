"use client";

import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import { useQuery } from "@tanstack/react-query";
import { Activity, ClipboardCopy, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { encodeFunctionData, keccak256, toBytes } from "viem";
import { adminConfig } from "@/config/protocol";
import { time } from "@/lib/format";

interface Health {
  checkedAt: string;
  services: Array<{
    detail: unknown;
    latencyMs?: number;
    name: string;
    status: "healthy" | "degraded" | "offline" | "unknown";
  }>;
}
const abi = [
  {
    inputs: [
      { name: "paused", type: "bool" },
      { name: "reasonHash", type: "bytes32" },
    ],
    name: "setTradingPaused",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
export function SystemHealth() {
  const query = useQuery({
    queryKey: ["health"],
    queryFn: async () =>
      (await fetch("/api/health", { cache: "no-store" })).json() as Promise<Health>,
    refetchInterval: 10_000,
  });
  const [reason, setReason] = useState("");
  const [paused, setPaused] = useState(true);
  const [payload, setPayload] = useState("");
  const build = () => {
    if (!adminConfig.exchange) {
      toast.error("Exchange address is not configured");
      return;
    }
    const reasonHash = keccak256(toBytes(reason));
    const data = encodeFunctionData({
      abi,
      functionName: "setTradingPaused",
      args: [paused, reasonHash],
    });
    setPayload(
      JSON.stringify(
        {
          chainId: adminConfig.chainId,
          data,
          metadata: { paused, reason, reasonHash },
          to: adminConfig.exchange,
          value: "0",
        },
        null,
        2,
      ),
    );
  };
  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(query.data?.services ?? []).map((service) => (
          <Card key={service.name}>
            <CardContent>
              <div className="flex items-center justify-between">
                <Activity className="size-4 text-muted-foreground" />
                <Badge
                  variant={
                    service.status === "healthy"
                      ? "positive"
                      : service.status === "unknown"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {service.status}
                </Badge>
              </div>
              <p className="mt-6 font-semibold">{service.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {service.latencyMs === undefined
                  ? "Endpoint not configured"
                  : `${service.latencyMs} ms response`}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Checked {query.data ? time(query.data.checkedAt) : "—"}</span>
        <Button size="sm" variant="ghost" onClick={() => query.refetch()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Incident action · global trading state</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Prepare a Safe payload to pause or resume new order opening. Existing direct recovery
            paths stay available according to contract rules.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-[180px_1fr_auto]">
            <div>
              <Label htmlFor="pause-state">Action</Label>
              <select
                id="pause-state"
                className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                value={paused ? "pause" : "resume"}
                onChange={(event) => {
                  setPaused(event.target.value === "pause");
                  setPayload("");
                }}
              >
                <option value="pause">Pause trading</option>
                <option value="resume">Resume trading</option>
              </select>
            </div>
            <div>
              <Label htmlFor="incident-reason">Incident reason</Label>
              <Input
                id="incident-reason"
                className="mt-2"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setPayload("");
                }}
                placeholder="Incident ID and concise rationale"
              />
            </div>
            <Button
              className="self-end"
              variant={paused ? "destructive" : "brand"}
              onClick={build}
              disabled={!reason}
            >
              {paused ? <PauseCircle /> : <PlayCircle />}Build payload
            </Button>
          </div>
          {payload && (
            <div className="mt-5 rounded-xl bg-muted p-4">
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
                    .then(() => toast.success("Incident payload copied"))
                }
              >
                <ClipboardCopy />
                Copy for Safe
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
