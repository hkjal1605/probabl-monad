"use client";

import { parseTokenAmount } from "@conditional-stocks/domain";
import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { LifecycleBadge } from "@/components/data/StatusBadge";
import { useDemo } from "@/components/providers/DemoProvider";
import type { DemoAction, DemoMarket } from "@/lib/demo/engine";
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

export function DemoResolution({ selected }: { selected?: string | undefined }) {
  const demo = useDemo();
  if (!demo) return null;
  return (
    <div className="mt-8 space-y-5">
      {demo.state.markets.map((market) => (
        <ResolutionCard
          key={market.view.id}
          market={market}
          selected={selected === market.view.id}
        />
      ))}
    </div>
  );
}
function ResolutionCard({ market, selected }: { market: DemoMarket; selected: boolean }) {
  const demo = useDemo();
  const [outcome, setOutcome] = useState<"YES" | "NO" | "INVALID">("YES");
  if (!demo) return null;
  const { view, resolution } = market;
  const label = {
    scheduled: "Open demo market",
    open: "Simulate cutoff",
    frozen: "Start evidence review",
    "awaiting-resolution": "Finalize demo resolution",
    resolved: "Enable demo redemption",
    redeemable: "Redeemable",
    archived: "Archived",
  }[view.lifecycle];
  return (
    <Card className={selected ? "border-brand" : ""} id={`evidence-${view.id}`}>
      <CardHeader>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{view.ticker}</Badge>
          <LifecycleBadge state={view.lifecycle} />
        </div>
        <CardTitle className="mt-4 text-xl">{view.question}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-muted-foreground">
          Open → frozen → evidence review → resolved → redeemable. Cutoff releases all remaining
          order reservations. Review waits for your chosen outcome; finalized payouts cannot be
          changed without resetting the demo.
        </p>
        <div className="mt-4 rounded-xl bg-muted/50 p-4 text-sm">
          <p className="font-semibold">
            {resolution
              ? `Simulated outcome: ${market.outcome === "INVALID" ? "Invalid · 50/50" : market.outcome}`
              : "Awaiting simulated evidence review"}
          </p>
          {resolution && (
            <>
              <p className="mt-2">
                YES payout {resolution.yesPayout}/{resolution.payoutDenominator} · NO payout{" "}
                {resolution.noPayout}/{resolution.payoutDenominator}
              </p>
              <p className="mt-2 break-all font-mono text-xs">
                Local transaction: {resolution.transactionHash}
              </p>
            </>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer font-medium">
              View demo evidence and exact terms
            </summary>
            <p className="mt-3 leading-6">{view.description}</p>
            <p className="mt-2 break-all font-mono text-xs">
              Condition: {view.mapping.conditionId}
            </p>
            <p className="mt-2">
              This sample packet stands in for collection, independent review, multisig execution
              and reconciliation. No actual Polymarket report or chain proof is claimed.
            </p>
          </details>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          {view.lifecycle === "awaiting-resolution" && (
            <div>
              <Label htmlFor={`outcome-${view.id}`}>Resolution outcome</Label>
              <select
                id={`outcome-${view.id}`}
                className={selectClass}
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as typeof outcome)}
              >
                <option value="YES">YES</option>
                <option value="NO">NO</option>
                <option value="INVALID">Invalid · 50/50</option>
              </select>
            </div>
          )}
          {!["redeemable", "archived"].includes(view.lifecycle) && (
            <Button
              variant="brand"
              onClick={() => {
                try {
                  demo.dispatch({ type: "advance", marketId: view.id, outcome });
                  toast.success("Demo lifecycle advanced");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Resolution failed");
                }
              }}
            >
              {label}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={`/markets/${view.id}`}>View market</Link>
          </Button>
          {view.lifecycle === "redeemable" && (
            <Button asChild variant="brand">
              <Link href="/portfolio">Redeem in portfolio</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
