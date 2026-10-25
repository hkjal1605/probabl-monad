"use client";

import { formatTokenAmount } from "@conditional-stocks/domain";
import { position as positionTx } from "@conditional-stocks/evm-client";
import { Combine } from "lucide-react";
import { useState } from "react";
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
import { parseAmountInput } from "@/lib/format/amount-input";
import { baseHalt, claimBalance } from "@/lib/markets/base";
import { refreshStores } from "@/stores/createResourceStore";
import type { MarketView, PositionView } from "@/types/api";

/** Splits whole tokens into YES and NO claims, or merges pairs back, in a market not yet resolved
 * (a resolved market's claims are redeemed with RedeemDialog). */
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
    [kind, setKind] = useState<"Split" | "Merge">("Merge");
  const options = [
    { collateral: 0 as const, label: market.quoteTokenMetadata?.symbol ?? "USDC" },
    { collateral: 1 as const, label: market.base.symbol },
  ];
  const held = (c: 0 | 1) => claimBalance(position, c, 0) + claimBalance(position, c, 1);
  const [collateral, setCollateral] = useState<0 | 1>(
      () => initialCollateral ?? (held(1) > 0n || held(0) === 0n ? 1 : 0),
    ),
    [amount, setAmount] = useState("");
  const [review, setReview] = useState<{ scope: string } | null>(null);
  const scope = [wallet.account, market.id, kind, collateral, amount, open].join(":");
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
  const available = yes < no ? yes : no;
  let raw = 0n;
  try {
    raw = parseAmountInput(amount, decimals);
  } catch {
    /* Invalid input is not actionable. */
  }
  const valid =
    !disabled &&
    walletData.isDataFresh &&
    raw > 0n &&
    raw < 1n << 96n &&
    (kind === "Split"
      ? market.lifecycle === "open" && !halt && raw <= wholeAvailable
      : raw <= available);
  const edit = (action: () => void) => {
    setReview(null);
    action();
  };
  const prepareReview = () =>
    run(async () => {
      if (!wallet.account || !valid) throw new Error("Choose a valid claim action first.");
      setReview({ scope });
    });
  const execute = () =>
    run(async (assertCurrent) => {
      if (!wallet.account || !valid || !reviewed)
        throw new Error("Review a valid claim action first.");
      // Claims live on the market's venue: its exchange and on-chain market id.
      const { exchange } = venueDeployment(market.venue);
      const transaction = positionTx(
        exchange,
        kind === "Split" ? "split" : "merge",
        Number(market.venue.marketId),
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
      <DialogTrigger render={<Button variant="outline" size="xs" disabled={disabled} />}>
        <Combine />
        Manage
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
              options={["Split", "Merge"]}
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
                : `1 YES + 1 NO claim → 1 whole ${symbol}.`}
            </p>
            <Field>
              <div className="flex items-center justify-between">
                <Label htmlFor="claim-amount">Amount ({symbol})</Label>
                {kind === "Merge" && (
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
            {reviewed && (
              <Alert role="status">
                <AlertDescription>
                  Review: {kind} {formatTokenAmount(raw, decimals)} {symbol}
                  {kind === "Merge" ? " claim pairs" : ""}. Returned assets belong to your connected
                  wallet. Network gas applies; confirmed transactions cannot be undone.
                </AlertDescription>
              </Alert>
            )}
            <Button
              variant="default"
              className="w-full"
              disabled={busy || !valid}
              onClick={() => (reviewed ? execute() : prepareReview())}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {reviewed ? `Confirm ${kind.toLowerCase()}` : `Review ${kind.toLowerCase()}`}
            </Button>
          </FieldGroup>
        </FieldSet>
      </DialogContent>
    </Dialog>
  );
}
