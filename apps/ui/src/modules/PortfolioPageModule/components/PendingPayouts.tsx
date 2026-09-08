"use client";

import { formatTokenAmount, parseTokenAmount } from "@conditional-stocks/domain";
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
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/components/providers/WalletProvider";
import { protocolConfig } from "@/config/protocol";
import type { MarketView, PayoutCreditView } from "@/lib/api/types";
import { shortAddress } from "@/lib/format/display";
import { payoutWithdrawal, verifyPayoutResponse } from "@/lib/trading/payouts";

interface Page {
  vault: string;
  payouts: PayoutCreditView[];
  nextCursor: string | null;
}

export function PendingPayouts({ markets }: { markets: MarketView[] }) {
  const wallet = useWallet();
  const credits = useInfiniteQuery({
    queryKey: ["payout-credits", wallet.account],
    initialPageParam: "",
    queryFn: async ({ pageParam }): Promise<Page> => {
      const response = await fetch(
        `/api/indexer/payouts/${wallet.account}${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Pending payouts are temporarily unavailable");
      const page = (await response.json()) as Page;
      if (
        !protocolConfig.payoutVault ||
        page.vault?.toLowerCase() !== protocolConfig.payoutVault.toLowerCase()
      )
        throw new Error("Payout vault configuration does not match the indexer");
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(wallet.account),
    refetchInterval: 8_000,
  });
  const rows = credits.data?.pages.flatMap((page) => page.payouts) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending payouts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Rejected payouts remain yours in the vault, in the same asset and amount. These are
          separate from spendable wallet balances. Withdraw to this wallet or another receiving
          address; no protocol withdrawal fee applies.
        </p>
        {credits.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {credits.error.message}
          </p>
        ) : credits.isPending ? (
          <p className="text-sm text-muted-foreground">Reading pending payouts…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending payouts.</p>
        ) : (
          rows.map((credit) => {
            const market = markets.find(
              (m) =>
                m.id === credit.marketId ||
                m.baseToken.toLowerCase() === credit.collateralToken.toLowerCase(),
            );
            const symbol =
              credit.kind === "quote"
                ? "USDG"
                : (market?.ticker ?? shortAddress(credit.collateralToken));
            return (
              <div
                key={credit.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">
                    {formatTokenAmount(BigInt(credit.amount), credit.decimals)} {symbol}
                    {credit.branch ? ` ${credit.branch} claims` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {credit.branch
                      ? (market?.question ?? shortAddress(credit.marketId ?? ""))
                      : "Whole collateral"}{" "}
                    · {credit.confirmation}
                  </p>
                </div>
                <WithdrawPayout credit={credit} symbol={symbol} />
              </div>
            );
          })
        )}
        {credits.hasNextPage && (
          <Button
            variant="outline"
            onClick={() => credits.fetchNextPage()}
            disabled={credits.isFetchingNextPage}
          >
            Load more payouts
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function WithdrawPayout({ credit, symbol }: { credit: PayoutCreditView; symbol: string }) {
  const wallet = useWallet();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState(credit.beneficiary);
  const [amount, setAmount] = useState(formatTokenAmount(BigInt(credit.amount), credit.decimals));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!wallet.account) return;
    setBusy(true);
    try {
      const raw = parseTokenAmount(amount.trim(), credit.decimals);
      const expected = payoutWithdrawal({
        credit,
        amount: raw,
        recipient: recipient.trim(),
        account: wallet.account,
        config: protocolConfig,
      });
      if (wallet.chainId !== protocolConfig.chainId) await wallet.ensureNetwork();
      const token = wallet.sessionToken ?? (await wallet.authenticate());
      const response = await fetch("/api/gateway/payouts/withdraw/prepare", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          asset: credit.asset,
          tokenId: credit.tokenId,
          amount: String(raw),
          recipient: recipient.trim(),
        }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Withdrawal preparation failed");
      const hash = await wallet.sendTransaction(verifyPayoutResponse(expected, result));
      toast.success(
        `Payout withdrawal submitted: ${hash.slice(0, 10)}… Balances update after indexing.`,
      );
      setOpen(false);
      await cache.invalidateQueries({ queryKey: ["payout-credits", wallet.account] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Withdrawal failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setRecipient(credit.beneficiary);
          setAmount(formatTokenAmount(BigInt(credit.amount), credit.decimals));
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Claim payout
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim pending payout</DialogTitle>
          <DialogDescription>
            Withdraw your exact {symbol}
            {credit.branch ? ` ${credit.branch} claims` : ""}. Choose another receiving address if
            this wallet rejects the asset. You pay network gas.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor={`payout-amount-${credit.id}`}>Amount ({symbol})</Label>
        <Input
          id={`payout-amount-${credit.id}`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          disabled={busy}
        />
        <Label htmlFor={`payout-recipient-${credit.id}`}>Receiving address</Label>
        <Input
          id={`payout-recipient-${credit.id}`}
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          disabled={busy}
        />
        <p className="break-all text-xs text-muted-foreground">
          Asset: {credit.asset}
          {credit.branch ? ` · Token ID: ${credit.tokenId}` : ""}
        </p>
        <Button variant="brand" onClick={submit} disabled={busy}>
          {busy ? "Preparing withdrawal…" : "Confirm withdrawal"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
