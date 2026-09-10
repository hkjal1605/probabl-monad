"use client";

import { parseTokenAmount } from "@conditional-stocks/domain";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/components/providers/DemoProvider";
import type { DemoAction } from "@/lib/demo/engine";
import { formatTime } from "@/lib/format/display";

const selectClass = "mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm";
export function DemoControls() {
  const demo = useDemo();
  const [marketId, setMarketId] = useState(demo?.markets[0]?.id ?? "");
  const [collateral, setCollateral] = useState<"base" | "quote">("base");
  const [amount, setAmount] = useState("1");
  if (!demo) return null;
  const run = (action: DemoAction) => {
    try {
      demo.dispatch(action);
      toast.success(
        action.type === "faucet" ? "Demo wallet topped up" : "Complementary demo claims created",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Demo action failed");
    }
  };
  return (
    <div className="mt-8 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Simulation controls</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            Prices and trades move every 3 seconds while this tab is visible. The simulation clock
            stops when paused, hidden or closed. State survives reloads in this tab; nothing is
            saved to the protocol database. The short SPY scenario reaches cutoff after 90 simulated
            seconds.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Simulation time: {formatTime(new Date(demo.state.now).toISOString())} · Tick{" "}
            {demo.state.tick} · {demo.state.paused ? "Paused" : "Running"}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              variant="brand"
              disabled={!demo.state.connected}
              onClick={() => run({ type: "faucet" })}
            >
              Add demo funds
            </Button>
            <Button
              variant="outline"
              onClick={() => demo.dispatch({ type: "pause", paused: !demo.state.paused })}
            >
              {demo.state.paused ? "Resume simulation" : "Pause simulation"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (
                  window.confirm(
                    "Reset this tab’s demo balances, orders, claims and resolutions? Real data will not be touched.",
                  )
                )
                  demo.reset();
              }}
            >
              Reset demo
            </Button>
            <Button asChild variant="outline">
              <Link href="/portfolio">View balances and claims</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Create a complementary claim pair</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Convert one whole demo token into one YES and one NO claim. This debits your wallet; it
            is not a second faucet.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="split-market">Market</Label>
              <select
                id="split-market"
                className={selectClass}
                value={marketId}
                onChange={(event) => setMarketId(event.target.value)}
              >
                {demo.markets
                  .filter((market) => market.lifecycle === "open")
                  .map((market) => (
                    <option key={market.id} value={market.id}>
                      {market.ticker} · {market.question}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label htmlFor="split-collateral">Collateral</Label>
              <select
                id="split-collateral"
                className={selectClass}
                value={collateral}
                onChange={(event) => setCollateral(event.target.value as "base" | "quote")}
              >
                <option value="base">Stock token</option>
                <option value="quote">USDG</option>
              </select>
            </div>
            <div>
              <Label htmlFor="split-amount">Whole-token amount</Label>
              <Input
                id="split-amount"
                className="mt-2"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={!demo.state.connected || !marketId || !amount}
            onClick={() => {
              try {
                const market = demo.markets.find((item) => item.id === marketId);
                if (!market) throw new Error("Choose a market.");
                run({
                  type: "split",
                  marketId,
                  collateral,
                  amount: parseTokenAmount(
                    amount,
                    collateral === "base" ? market.baseTokenDecimals : market.quoteTokenDecimals,
                  ).toString(),
                });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Invalid amount");
              }
            }}
          >
            Split into YES + NO
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Demo activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="max-h-64 space-y-3 overflow-y-auto text-xs">
            {demo.state.activity.map((event) => (
              <li key={event.id} className="break-words border-b pb-3">
                <time className="text-muted-foreground">
                  {formatTime(new Date(event.at).toISOString())}
                </time>
                <p className="mt-1">{event.message}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
