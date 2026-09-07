"use client";

import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import { ArrowUpRight, LoaderCircle, ShieldOff, WalletCards } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { encodeFunctionData, erc20Abi } from "viem";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { protocolConfig } from "@/config/protocol";
import type { MarketView } from "@/lib/api/types";

const approvalAbi = [
  {
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
export function FundsClient({ markets }: { markets: MarketView[] }) {
  const wallet = useWallet();
  const demo = useDemo();
  const [token, setToken] = useState(markets[0]?.quoteToken ?? "");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  if (!wallet.account)
    return (
      <div className="mt-10 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed bg-card text-center">
        <WalletCards className="text-muted-foreground" />
        <p className="mt-4 font-semibold">Connect to manage wallet assets</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The app is self-custodied. It never holds deposits on your behalf.
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
  const transfer = async () => {
    setBusy(true);
    try {
      if (demo) {
        demo.dispatch({ type: "transfer", token, recipient, amount });
        toast.success("Demo transfer complete. No real assets were sent.");
        setAmount("");
        return;
      }
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient as `0x${string}`, BigInt(amount)],
      });
      const hash = await wallet.sendTransaction({ data, to: token });
      toast.success(`Transfer submitted: ${hash.slice(0, 10)}…`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!demo && (!protocolConfig.conditionalTokens || !protocolConfig.exchange)) return;
    setBusy(true);
    try {
      if (demo) {
        demo.dispatch({ type: "revoke" });
        toast.success("Demo exchange claim approval revoked.");
        return;
      }
      const data = encodeFunctionData({
        abi: approvalAbi,
        functionName: "setApprovalForAll",
        args: [protocolConfig.exchange as `0x${string}`, false],
      });
      const hash = await wallet.sendTransaction({ data, to: protocolConfig.conditionalTokens });
      toast.success(`Revocation submitted: ${hash.slice(0, 10)}…`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Revocation failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-10 grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Self-custodied balances</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            {demo
              ? "Fictitious demo address. Never send real tokens here. Use Add demo funds above to top up your local wallet."
              : "Send supported Stock Tokens or USDG directly to this address. There is no protocol deposit account."}
          </p>
          <div className="mt-5 rounded-xl bg-muted/55 p-4">
            <p className="text-xs text-muted-foreground">Connected address</p>
            <code className="mt-2 block break-all text-xs">{wallet.account}</code>
          </div>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(wallet.account ?? "")
                .then(() => toast.success("Address copied"))
            }
          >
            {demo ? "Copy demo address" : "Copy deposit address"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Move assets out</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="asset-token">Token contract</Label>
              <Input
                id="asset-token"
                className="mt-2 font-mono"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="asset-recipient">Recipient</Label>
              <Input
                id="asset-recipient"
                className="mt-2 font-mono"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="0x…"
              />
            </div>
            <div>
              <Label htmlFor="asset-amount">Raw token amount</Label>
              <Input
                id="asset-amount"
                className="mt-2 font-mono"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="1000000000000000000"
              />
            </div>
            <Button
              className="w-full"
              variant="brand"
              onClick={transfer}
              disabled={
                busy ||
                !/^0x[0-9a-fA-F]{40}$/.test(token) ||
                !/^0x[0-9a-fA-F]{40}$/.test(recipient) ||
                !/^[1-9][0-9]*$/.test(amount)
              }
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <ArrowUpRight />}
              {demo ? "Simulate transfer" : "Submit wallet transfer"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Conditional claim operator approval</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Revoke the exchange’s ERC-1155 permission when you are not actively trading
              claim-funded orders.
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={revoke}
            disabled={
              busy || (!demo && (!protocolConfig.conditionalTokens || !protocolConfig.exchange))
            }
          >
            <ShieldOff />
            Revoke approval
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
