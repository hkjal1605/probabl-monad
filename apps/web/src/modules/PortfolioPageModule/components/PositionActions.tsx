"use client";

import { formatTokenAmount, parseTokenAmount } from "@conditional-stocks/domain";
import {
  conditionalStocksAbi,
  planRedemption,
  position as positionTx,
  type RedemptionPlan,
  redeem,
} from "@conditional-stocks/evm-client";
import { Combine } from "lucide-react";
import { useState } from "react";
import { readContract } from "viem/actions";
import { useWallet } from "@/components/providers/WalletProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldSet, FieldLabel as Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { venueDeployment } from "@/config/protocol";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { usePositions } from "@/hooks/useProtocolData";
import { baseHalt, claimBalance } from "@/lib/markets/base";
import { rpc } from "@/lib/trading/rpc";
import { refreshStores } from "@/stores/createResourceStore";
import type { MarketView, PositionView } from "@/types/api";

/** The finalized payout, read from the exchange itself rather than the index. */
async function canonicalPayout(exchange: `0x${string}`, marketId: number) {
  const client = rpc();
  const [terms, book] = await Promise.all([
    readContract(client, {
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "terms",
      args: [marketId],
    }),
    readContract(client, {
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "book",
      args: [marketId],
    }),
  ]);
  if (terms.state !== 6 && terms.state !== 7)
    throw new Error("Redemption is not yet enabled for this market.");
  return [book.payoutYes, book.payoutNo] as const;
}

export function PositionActions({
  position,
  market,
  collateral: initialCollateral,
  disabled = false,
}: {
  position: PositionView;
  market: MarketView;
  /** Initially selected collateral: 0 = quote claims, 1 = base-token claims. */
  collateral?: 0 | 1;
  disabled?: boolean;
}) {
  const wallet = useWallet();
  const walletData = usePositions();
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<"Split" | "Merge" | "Redeem">(
      position.redeemable ? "Redeem" : "Merge",
    );
  const options = [
    { collateral: 0 as const, label: market.quoteTokenMetadata?.symbol ?? "USDC" },
    { collateral: 1 as const, label: market.base.symbol },
  ];
  const held = (c: 0 | 1) => claimBalance(position, c, 0) + claimBalance(position, c, 1);
  const [collateral, setCollateral] = useState<0 | 1>(
      () => initialCollateral ?? (held(1) > 0n || held(0) === 0n ? 1 : 0),
    ),
    [branch, setBranch] = useState<"All" | "YES" | "NO">("All"),
    [amount, setAmount] = useState("");
  const [review, setReview] = useState<{
    scope: string;
    plan?: RedemptionPlan;
    payouts?: readonly [number, number];
  } | null>(null);
  const scope = [wallet.account, market.id, kind, collateral, branch, amount, open].join(":");
  const { busy, run } = useAsyncAction(scope);
  const reviewed = review?.scope === scope ? review : null;
  const decimals = collateral === 1 ? market.base.decimals : market.quoteTokenDecimals,
    symbol = options[collateral]!.label;
  const halt = collateral === 1 ? baseHalt(market) : null;
  const yes = claimBalance(position, collateral, 0),
    no = claimBalance(position, collateral, 1);
  const wholeToken = collateral === 1 ? market.base.token : market.quoteToken;
  const wholeAvailable = BigInt(
    walletData.data?.owner === wallet.account
      ? (walletData.data.balances[wholeToken]?.vaultAvailable ?? "0")
      : "0",
  );
  const available = kind === "Merge" ? (yes < no ? yes : no) : branch === "YES" ? yes : no;
  const redeemable = position.redeemable;
  const allClaims = kind === "Redeem" && branch === "All";
  let raw = 0n;
  try {
    raw = parseTokenAmount(amount.trim(), decimals);
  } catch {
    /* Invalid input is not actionable. */
  }
  const valid =
    !disabled &&
    walletData.isDataFresh &&
    (allClaims
      ? yes + no > 0n
      : raw > 0n &&
        raw < 1n << 96n &&
        (kind === "Split"
          ? market.lifecycle === "open" && !halt && raw <= wholeAvailable
          : raw <= available)) &&
    (kind !== "Redeem" || redeemable);
  const edit = (action: () => void) => {
    setReview(null);
    action();
  };
  const redeemAmounts = () => ({
    yes: allClaims ? yes : branch === "YES" ? raw : 0n,
    no: allClaims ? no : branch === "NO" ? raw : 0n,
  });
  const prepareReview = () =>
    run(async (assertCurrent) => {
      if (!wallet.account || !valid) throw new Error("Choose a valid claim action first.");
      if (kind !== "Redeem") {
        setReview({ scope });
        return;
      }
      const payouts = await canonicalPayout(
        venueDeployment(market.venue).exchange,
        Number(market.venue.marketId),
      );
      assertCurrent();
      const { yes: y, no: n } = redeemAmounts();
      setReview({ scope, payouts, plan: planRedemption(y, n, payouts) });
    });
  const plan = reviewed?.plan;
  const nothingToBurn = !!plan && plan.redeemYes + plan.redeemNo === 0n;
  const zeroPayout = !!plan && !nothingToBurn && plan.credit === 0n;
  const execute = () =>
    run(async (assertCurrent) => {
      if (!wallet.account || !valid || !reviewed)
        throw new Error("Review a valid claim action first.");
      // Claims live on the market's venue: its exchange and on-chain market id.
      const { exchange } = venueDeployment(market.venue);
      const id = Number(market.venue.marketId);
      let transaction: ReturnType<typeof redeem>;
      if (kind === "Redeem") {
        const payouts = await canonicalPayout(exchange, id);
        assertCurrent();
        if (!plan || nothingToBurn || payouts.some((p, i) => p !== reviewed.payouts?.[i]))
          throw new Error("Redemption changed or has no exact payout; review again.");
        transaction = redeem(exchange, id, collateral, plan.redeemYes, plan.redeemNo);
      } else
        transaction = positionTx(
          exchange,
          kind === "Split" ? "split" : "merge",
          id,
          collateral,
          raw,
        );
      assertCurrent();
      const hash = await wallet.sendTransaction(transaction);
      assertCurrent();
      await refreshStores(["positions", "payout-credits"]);
      toast.add({
        type: "success",
        title: `${kind} confirmed · ${hash.slice(0, 10)}… Balances update after indexing.`,
      });
      setOpen(false);
      setAmount("");
      setReview(null);
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(value, details) => {
        if (busy) details.cancel();
        if (!busy) {
          setOpen(value);
          setReview(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="border-0 bg-primary/10 px-3 text-primary hover:bg-primary/10 hover:text-primary"
            disabled={disabled}
          />
        }
      >
        <Combine />
        {position.redeemable ? "Redeem" : "Manage"}
      </DialogTrigger>
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[400px]"
      >
        <DialogHeader>
          <DialogTitle>Manage conditional claims</DialogTitle>
          <DialogDescription>
            {market.ticker} · {market.question}
          </DialogDescription>
        </DialogHeader>
        <FieldSet disabled={busy} className="flex flex-col gap-3">
          <FieldGroup>
            <Segmented
              disabled={busy}
              label="Claim action"
              value={kind}
              options={["Split", "Merge", "Redeem"]}
              onChange={(value) => edit(() => setKind(value))}
              className="w-full"
            />
            <Segmented
              disabled={busy}
              label="Claim collateral"
              value={symbol}
              options={options.map((option) => option.label)}
              onChange={(value) =>
                edit(() =>
                  setCollateral(
                    options.find((option) => option.label === value)?.collateral ?? collateral,
                  ),
                )
              }
              className="w-full"
            />
            {kind === "Split" && halt && (
              <p role="status" className="text-sm text-warning">
                {symbol} cannot be split: {halt}
              </p>
            )}
            <p className="text-sm font-semibold leading-6 text-muted-foreground">
              {kind === "Split"
                ? `1 deposited ${symbol} → 1 YES + 1 NO claim. Available in vault: ${formatTokenAmount(wholeAvailable, decimals)} ${symbol}.`
                : kind === "Merge"
                  ? `1 YES + 1 NO claim → 1 whole ${symbol}.`
                  : "Redeem claims at the finalized payout. An INVALID resolution pays half per claim and keeps an odd raw unit rather than rounding its value away. Losing claims pay zero."}
            </p>
            {kind === "Redeem" && (
              <Segmented
                disabled={busy}
                label="Redeem branch"
                value={branch}
                options={["All", "YES", "NO"]}
                onChange={(value) => edit(() => setBranch(value))}
              />
            )}
            {allClaims ? (
              <Alert role="status">
                <AlertDescription>
                  Available: {formatTokenAmount(yes, decimals)} YES and{" "}
                  {formatTokenAmount(no, decimals)} NO claims. Review will show the exact payout,
                  quantities burned and any retained claim.
                </AlertDescription>
              </Alert>
            ) : (
              <Field>
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
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => edit(() => setAmount(e.target.value))}
                  placeholder="0.00"
                />
              </Field>
            )}
            {kind === "Redeem" && !redeemable && (
              <p role="status" className="text-sm text-warning">
                Redemption is not yet enabled for this market.
              </p>
            )}
            {plan ? (
              <Alert role="status" aria-label="Exact redemption review">
                <AlertDescription>
                  <p>
                    Redeem {formatTokenAmount(plan.redeemYes, decimals)} YES and{" "}
                    {formatTokenAmount(plan.redeemNo, decimals)} NO.
                  </p>
                  <p>
                    Receive {formatTokenAmount(plan.credit, decimals)} {symbol} vault credit (
                    {plan.credit.toString()} raw units).
                  </p>
                  {plan.retainedYes + plan.retainedNo > 0n && (
                    <p>
                      Retain {plan.retainedYes.toString()} YES / {plan.retainedNo.toString()} NO raw
                      claim: half of one raw unit cannot be paid exactly.
                    </p>
                  )}
                  {nothingToBurn && (
                    <p role="status" className="text-warning">
                      Nothing can be redeemed in whole raw units. Keep the claim or combine it with
                      another claim.
                    </p>
                  )}
                  {zeroPayout && (
                    <Alert>
                      <AlertDescription>
                        Zero payout: these losing claims will be permanently burned for no
                        collateral.
                      </AlertDescription>
                    </Alert>
                  )}
                  <p>Returned credit belongs to your connected wallet. Network gas applies.</p>
                </AlertDescription>
              </Alert>
            ) : (
              reviewed && (
                <Alert role="status">
                  <AlertDescription>
                    Review: {kind} {formatTokenAmount(raw, decimals)} {symbol}
                    {kind === "Redeem"
                      ? `-${branch} claims`
                      : kind === "Merge"
                        ? " claim pairs"
                        : ""}
                    . Returned assets belong to your connected wallet. Network gas applies;
                    confirmed transactions cannot be undone.
                  </AlertDescription>
                </Alert>
              )
            )}
            <Button
              variant="default"
              className="w-full"
              disabled={busy || !valid || nothingToBurn}
              onClick={() => (reviewed ? execute() : prepareReview())}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {reviewed
                ? zeroPayout
                  ? "Confirm zero-payout burn"
                  : `Confirm ${kind.toLowerCase()}`
                : `Review ${kind.toLowerCase()}`}
            </Button>
          </FieldGroup>
        </FieldSet>
      </DialogContent>
    </Dialog>
  );
}
