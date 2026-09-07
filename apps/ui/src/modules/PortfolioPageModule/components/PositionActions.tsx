"use client";

import { Button } from "@conditional-stocks/ui-kit/button";
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
import { Tabs, TabsList, TabsTrigger } from "@conditional-stocks/ui-kit/tabs";
import { Combine, Gift, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import type { PositionView } from "@/lib/api/types";

export function PositionActions({ position }: { position: PositionView }) {
  const wallet = useWallet();
  const demo = useDemo();
  const [kind, setKind] = useState<"merge" | "redeem">(position.redeemable ? "redeem" : "merge");
  const [collateral, setCollateral] = useState<"base" | "quote">("base");
  const [branch, setBranch] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!wallet.account) return;
    setBusy(true);
    try {
      if (demo) {
        if (!demo.state.approvals["claims-router"]) {
          demo.dispatch({ type: "approve", key: "claims-router" });
          toast.success("Demo claim router approved. Prepare the action again to execute it.");
          return;
        }
        demo.dispatch(
          kind === "merge"
            ? { type: "merge", marketId: position.marketId, amount, collateral }
            : { type: "redeem", marketId: position.marketId, amount, collateral, branch },
        );
        toast.success(`Demo ${kind} complete. Wallet and claims updated.`);
        setAmount("");
        return;
      }
      const token = wallet.sessionToken ?? (await wallet.authenticate());
      const body =
        kind === "merge"
          ? { amount, collateral, marketId: position.marketId, recipient: wallet.account }
          : {
              amounts: [amount],
              collateral,
              indexSets: [branch === "yes" ? "1" : "2"],
              marketId: position.marketId,
              recipient: wallet.account,
            };
      const response = await fetch(`/api/gateway/positions/${kind}/prepare`, {
        body: JSON.stringify(body),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const error = (await response.json()) as { error?: { message?: string } };
        throw new Error(error.error?.message ?? "Could not prepare action");
      }
      const prepared = (await response.json()) as {
        approval: { data: string; to: string; value: string } | null;
        transaction: { data: string; to: string; value: string };
      };
      if (prepared.approval) {
        await wallet.sendTransaction(prepared.approval);
        toast.success("Claim approval submitted. Re-open this action after confirmation.");
        return;
      }
      const hash = await wallet.sendTransaction(prepared.transaction);
      toast.success(
        `${kind === "merge" ? "Merge" : "Redemption"} submitted: ${hash.slice(0, 10)}…`,
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {position.redeemable ? <Gift /> : <Combine />}
          {position.redeemable ? "Redeem" : "Manage"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage conditional claims</DialogTitle>
          <DialogDescription>
            Merge complementary claims before resolution, or redeem winning claims after the market
            becomes redeemable.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={kind} onValueChange={(value) => setKind(value as "merge" | "redeem")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="merge">Merge pair</TabsTrigger>
            <TabsTrigger value="redeem" disabled={!position.redeemable}>
              Redeem
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs
          value={collateral}
          onValueChange={(value) => setCollateral(value as "base" | "quote")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="base">Stock claims</TabsTrigger>
            <TabsTrigger value="quote">Cash claims</TabsTrigger>
          </TabsList>
        </Tabs>
        {kind === "redeem" && (
          <Tabs value={branch} onValueChange={(value) => setBranch(value as "yes" | "no")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="yes">YES claim</TabsTrigger>
              <TabsTrigger value="no">NO claim</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <div>
          <Label htmlFor="claim-amount">Raw claim amount</Label>
          <Input
            className="mt-2 font-mono"
            id="claim-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="numeric"
            placeholder="1000000000000000000"
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {demo
            ? "Simulation only. A winning claim returns its collateral; an invalid outcome returns 50% (rounded down); a losing claim burns for zero."
            : "Direct Conditional Tokens merge and redeem calls remain available if this app or API is offline. The app never has custody of your claims."}
        </p>
        <Button variant="brand" onClick={run} disabled={busy || !/^[1-9][0-9]*$/.test(amount)}>
          {busy ? (
            <LoaderCircle className="animate-spin" />
          ) : kind === "merge" ? (
            <Combine />
          ) : (
            <Gift />
          )}
          Prepare {kind}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
