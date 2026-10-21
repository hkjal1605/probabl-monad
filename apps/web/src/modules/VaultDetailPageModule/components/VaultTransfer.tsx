"use client";

import { useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { useDeltaVaultTransfer } from "@/hooks/useDeltaVaultTransfer";
import { sharesFor, tokenText } from "@/lib/delta-vault/amounts";
import { parseAmountInput } from "@/lib/format/amount-input";
import type { DeltaVaultAccountView, DeltaVaultView } from "@/services/delta-vaults-api-service";
import { baseHigh, quoteHigh } from "../utils/holdings";

const MODES = ["Deposit", "Withdraw"] as const;
const PERCENTS = [25, 50, 75, 100] as const;

export function VaultTransfer({
  vault,
  position,
}: {
  vault: DeltaVaultView;
  position: DeltaVaultAccountView | undefined;
}) {
  const wallet = useWallet();
  const [mode, setMode] = useState<(typeof MODES)[number]>("Deposit");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState<number>(100);
  const transfer = useDeltaVaultTransfer(vault, () => setAmount(""));
  const q = vault.quote.decimals ?? 6,
    b = vault.base.decimals ?? 18,
    quoteSymbol = vault.quote.symbol ?? "quote",
    baseSymbol = vault.base.symbol ?? "stock";
  const walletQuote = BigInt(position?.wallet.quote ?? "0"),
    walletBase = BigInt(position?.wallet.base ?? "0"),
    shares = BigInt(position?.shares ?? "0");
  // Deposits are measured against each asset's richest-branch holdings.
  const qh = quoteHigh(vault),
    bh = baseHigh(vault);
  let quote: bigint | null = null;
  try {
    quote = amount.trim() ? parseAmountInput(amount, q) : null;
  } catch {
    quote = null;
  }
  const baseNeeded = quote !== null && qh > 0n ? (quote * bh) / qh : 0n;
  const maxQuote =
    bh === 0n
      ? walletQuote
      : [walletQuote, (walletBase * qh) / bh].reduce((x, y) => (x < y ? x : y));
  const withdrawShares = sharesFor(shares, percent);
  const fraction = (raw: string | undefined) =>
    raw === undefined || shares === 0n ? 0n : (BigInt(raw) * withdrawShares) / shares;
  const limited = vault.withdrawLimitBps < 10_000;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "Deposit" ? "Add liquidity" : "Withdraw"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Segmented label="Vault action" value={mode} options={MODES} onChange={setMode} />
        {mode === "Deposit" ? (
          <>
            <Field>
              <FieldLabel htmlFor="vault-deposit">{quoteSymbol}</FieldLabel>
              <Input
                id="vault-deposit"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                disabled={transfer.busy || vault.paused}
                onChange={(event) => setAmount(event.target.value)}
              />
              <FieldDescription>
                Pairs with ≈ {tokenText(baseNeeded, b)} {baseSymbol} at the vault's current ratio.
                Wallet: {tokenText(walletQuote, q, 2)} {quoteSymbol} · {tokenText(walletBase, b)}{" "}
                {baseSymbol}
              </FieldDescription>
            </Field>
            <Button
              size="sm"
              variant="link"
              className="self-start"
              disabled={!position || maxQuote === 0n}
              onClick={() => setAmount(tokenText(maxQuote, q, q))}
            >
              Max for your balances
            </Button>
            {quote !== null && baseNeeded > walletBase && (
              <p className="text-xs text-warning">
                Your {baseSymbol} covers only part of this: the deposit shrinks to match it.
              </p>
            )}
            <Button
              // Investing is for members; withdrawing what a wallet holds never is gated.
              disabled={wallet.access !== "member" || transfer.busy || vault.paused || !quote}
              onClick={() => quote && transfer.deposit(quote, walletBase)}
            >
              {transfer.busy ? <Spinner /> : vault.paused ? "Deposits paused" : "Deposit"}
            </Button>
            <p className="text-xs text-muted-foreground">
              You add the same fraction to everything the vault holds. If it holds conditional
              positions, the side it does not need comes back to you as exchange claims.
            </p>
          </>
        ) : (
          <>
            <Segmented
              label="Share of your position"
              value={`${percent}%`}
              options={PERCENTS.map((p) => `${p}%`)}
              onChange={(value) => setPercent(Number(value.replace("%", "")))}
            />
            <div className="flex flex-col gap-1 text-sm tabular-nums">
              <p className="text-xs text-muted-foreground">
                {tokenText(withdrawShares, 18)} {vault.symbol} pays about
              </p>
              <p>
                {tokenText(fraction(position?.redeems?.quote), q)} {quoteSymbol} ·{" "}
                {tokenText(fraction(position?.redeems?.base), b)} {baseSymbol}
              </p>
            </div>
            {limited && (
              <p className="text-xs text-muted-foreground">
                Up to {tokenText(BigInt(vault.withdrawable), 18, 2)} {vault.symbol} can leave the
                vault today.
              </p>
            )}
            <Button
              disabled={!wallet.account || transfer.busy || withdrawShares === 0n}
              onClick={() => transfer.withdraw(withdrawShares)}
            >
              {transfer.busy ? <Spinner /> : "Withdraw"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Withdrawals are never paused. Unpaired conditional positions arrive as exchange claims
              in your portfolio.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
