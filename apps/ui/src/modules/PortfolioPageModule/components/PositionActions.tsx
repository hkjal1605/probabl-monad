"use client";
import { formatTokenAmount, parseTokenAmount } from "@conditional-stocks/domain";
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
import { useQueryClient } from "@tanstack/react-query";
import { Combine, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { Segmented } from "@/components/ui/segmented";
import { protocolConfig } from "@/config/protocol";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { api } from "@/lib/api/client";
import type { MarketView, PositionView } from "@/lib/api/types";
import { positionAction, splitAction, verifyPositionResponse } from "@/lib/trading/positions";
import { readClaimMarket, splitFunding, transactionReceipt } from "@/lib/trading/rpc";

export function PositionActions({
  position,
  market,
}: {
  position: PositionView;
  market: MarketView;
}) {
  const wallet = useWallet(),
    demo = useDemo(),
    cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<"Split" | "Merge" | "Redeem">(
      position.redeemable ? "Redeem" : "Merge",
    );
  const [collateral, setCollateral] = useState<"Stock" | "Cash">("Stock"),
    [branch, setBranch] = useState<"YES" | "NO">("YES"),
    [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const { busy, run } = useAsyncAction(
    [wallet.account, market.id, kind, collateral, branch, amount, open].join(":"),
  );
  const decimals = collateral === "Stock" ? market.baseTokenDecimals : market.quoteTokenDecimals,
    symbol = collateral === "Stock" ? market.ticker : "USDG";
  const yes = BigInt(collateral === "Stock" ? position.stockYes : position.quoteYes),
    no = BigInt(collateral === "Stock" ? position.stockNo : position.quoteNo);
  const available = kind === "Merge" ? (yes < no ? yes : no) : branch === "YES" ? yes : no;
  const redeemable = position.redeemable;
  let raw = 0n;
  try {
    raw = parseTokenAmount(amount.trim(), decimals);
  } catch {
    /* Invalid input is not actionable. */
  }
  const valid =
    raw > 0n &&
    raw < 1n << 256n &&
    (kind === "Split" ? market.lifecycle === "open" : raw <= available) &&
    (kind !== "Redeem" || redeemable);
  const edit = (action: () => void) => {
    setReviewed(false);
    action();
  };
  const execute = () =>
    run(async (assertCurrent) => {
      if (!wallet.account || !valid || !reviewed)
        throw new Error("Review a valid claim action first.");
      const collateralKind = collateral === "Stock" ? "base" : "quote",
        collateralToken = collateral === "Stock" ? market.baseToken : market.quoteToken;
      if (demo) {
        if (kind !== "Split" && !demo.state.approvals["claims-router"]) {
          demo.dispatch({ type: "approve", key: "claims-router" });
          toast.success("Demo claim router approved. Confirm again to execute.");
          return;
        }
        demo.dispatch(
          kind === "Split"
            ? {
                type: "split",
                marketId: market.id,
                collateral: collateralKind,
                amount: String(raw),
              }
            : kind === "Merge"
              ? {
                  type: "merge",
                  marketId: market.id,
                  collateral: collateralKind,
                  amount: String(raw),
                }
              : {
                  type: "redeem",
                  marketId: market.id,
                  collateral: collateralKind,
                  amount: String(raw),
                  branch: branch === "YES" ? "yes" : "no",
                },
        );
        toast.success(`Demo ${kind.toLowerCase()} complete.`);
        setOpen(false);
        return;
      }
      if (wallet.chainId !== protocolConfig.chainId) await wallet.ensureNetwork();
      const canonical = await readClaimMarket(market);
      assertCurrent();
      if (canonical.conditionId.toLowerCase() !== position.conditionId.toLowerCase())
        throw new Error("Claim condition differs from the deployed market.");
      let transaction: { to: string; data: string; value?: string },
        approval = false;
      if (kind === "Split") {
        if (
          canonical.state !== 2 ||
          canonical.tradingCutoff <= BigInt(Math.floor(Date.now() / 1000))
        )
          throw new Error("This market is no longer open.");
        const expected = splitAction({
          collateralToken,
          conditionId: canonical.conditionId,
          amount: raw,
          account: wallet.account,
          config: protocolConfig,
        });
        const funding = await splitFunding(wallet.account, collateralToken, raw);
        assertCurrent();
        // Tokens requiring zero-first approvals must be reset explicitly in Permissions.
        if (!funding.approved && funding.allowance !== 0n)
          throw new Error(
            "Reset this token’s Conditional Tokens allowance in Funds → Permissions, then retry.",
          );
        approval = !funding.approved;
        transaction = approval ? expected.approval : expected.transaction;
      } else {
        const token = wallet.sessionToken ?? (await wallet.authenticate());
        assertCurrent();
        const expected = positionAction({
          kind: kind === "Merge" ? "merge" : "redeem",
          collateralToken,
          conditionId: canonical.conditionId,
          amount: raw,
          branch: branch === "YES" ? "yes" : "no",
          account: wallet.account,
          config: protocolConfig,
        });
        const body =
          kind === "Merge"
            ? {
                marketId: market.id,
                collateral: collateralKind,
                amount: String(raw),
                recipient: wallet.account,
              }
            : {
                marketId: market.id,
                collateral: collateralKind,
                amounts: [String(raw)],
                indexSets: [branch === "YES" ? "1" : "2"],
                recipient: wallet.account,
              };
        const prepared = verifyPositionResponse(
          expected,
          await api.prepare<unknown>(
            `positions/${kind === "Merge" ? "merge" : "redeem"}/prepare`,
            body,
            token,
          ),
        );
        approval = Boolean(prepared.approval);
        transaction = prepared.approval ?? prepared.transaction;
      }
      assertCurrent();
      const hash = await wallet.sendTransaction(transaction);
      toast.success(
        `${approval ? "Approval" : kind} submitted: ${hash.slice(0, 10)}… Waiting for confirmation.`,
      );
      const receipt = await transactionReceipt(hash);
      assertCurrent();
      if (receipt.status !== "success")
        throw new Error("Transaction reverted. Balances were not changed.");
      await Promise.all(
        ["positions", "whole-balances", "payout-credits"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
      if (approval) toast.success("Approval confirmed. Review the claim action again to continue.");
      else {
        toast.success(`${kind} confirmed. Canonical balances update after indexing.`);
        setOpen(false);
        setAmount("");
      }
      setReviewed(false);
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setReviewed(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Combine />
          {position.redeemable ? "Redeem" : "Manage"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage conditional claims</DialogTitle>
          <DialogDescription>
            {market.ticker} · {market.question}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="space-y-5">
          <Segmented
            label="Claim action"
            value={kind}
            options={["Split", "Merge", "Redeem"]}
            onChange={(value) => edit(() => setKind(value))}
            className="w-full"
          />
          <Segmented
            label="Claim collateral"
            value={collateral}
            options={["Stock", "Cash"]}
            onChange={(value) => edit(() => setCollateral(value))}
            className="w-full"
          />
          <p className="text-sm font-medium leading-6 text-muted-foreground">
            {kind === "Split"
              ? `1 whole ${symbol} → 1 YES + 1 NO claim. Exact collateral approval may be needed first.`
              : kind === "Merge"
                ? `1 YES + 1 NO claim → 1 whole ${symbol}.`
                : "Redeem at the finalized payout. Losing claims burn for zero; invalid outcomes pay 50% per branch, rounded down. Review Resolution before confirming."}
          </p>
          {kind === "Redeem" && (
            <Segmented
              label="Redeem branch"
              value={branch}
              options={["YES", "NO"]}
              onChange={(value) => edit(() => setBranch(value))}
            />
          )}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="claim-amount">Amount ({symbol})</Label>
              {kind !== "Split" && (
                <Button
                  size="sm"
                  variant="link"
                  onClick={() => edit(() => setAmount(formatTokenAmount(available, decimals)))}
                >
                  Max · {formatTokenAmount(available, decimals)}
                </Button>
              )}
            </div>
            <Input
              id="claim-amount"
              className="mt-2 h-12 font-mono text-lg"
              inputMode="decimal"
              value={amount}
              onChange={(e) => edit(() => setAmount(e.target.value))}
              placeholder="0.00"
            />
          </div>
          {kind === "Redeem" && !redeemable && (
            <p role="status" className="text-sm text-warning">
              Redemption is not yet enabled for this market.
            </p>
          )}
          {reviewed && (
            <div className="rounded-lg border bg-secondary p-4 text-sm leading-6">
              Review: {kind} {formatTokenAmount(raw, decimals)} {symbol}
              {kind === "Redeem" ? `-${branch} claims` : kind === "Merge" ? " claim pairs" : ""}.
              Returned assets belong to your connected wallet. Network gas applies; confirmed
              transactions cannot be undone.
            </div>
          )}
          <Button
            variant="brand"
            className="w-full"
            disabled={busy || !valid}
            onClick={() => (reviewed ? execute() : setReviewed(true))}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            {reviewed ? `Confirm ${kind.toLowerCase()}` : `Review ${kind.toLowerCase()}`}
          </Button>
        </fieldset>
        <p className="text-xs leading-5 text-muted-foreground">
          Merge and redemption use the verified position router. Rejected payouts are recoverable
          from Portfolio. The app never has custody of your claims.
        </p>
      </DialogContent>
    </Dialog>
  );
}
