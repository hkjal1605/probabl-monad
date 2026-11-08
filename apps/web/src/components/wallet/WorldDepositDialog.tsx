"use client";
/** The header's deposit on worlds pages: dollars (the one token worlds trade in, as the chain
 * names it: USDG on Robinhood Chain, USDC on Monad) from the wallet into the world balance, the
 * same deposit My worlds and the ticket make. Its reads (the wallet's dollars, the world account,
 * the token) run only while it is open. */
import { formatTokenAmount } from "@conditional-stocks/domain";
import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldSet, FieldTitle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { protocolConfig, worldsEnabled } from "@/config/protocol";
import { useWorldAccount, useWorldAccountBusy } from "@/hooks/useWorldAccount";
import { formatCompactNumber, tokenAmount } from "@/lib/format/display";
import { tokenDisplay } from "@/lib/tokens/catalog";
import { vaultAmount } from "@/lib/trading/vault";
import { DepositAmountField, TokenIcon } from "./DepositFields";

export function WorldDepositDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const busy = useWorldAccountBusy();
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (busy) details.cancel();
        else onOpenChange(next);
      }}
    >
      <DialogContent className="gap-5 sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Deposit funds</DialogTitle>
          <WorldsTradeIn />
        </DialogHeader>
        {/* Mounted only while open, so the account is read only then. */}
        <WorldDepositForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Which token, once the chain says. */
function WorldsTradeIn() {
  const token = useWorldAccount().quoteToken;
  return (
    <DialogDescription>
      Worlds trade in {token?.symbol ?? "dollars"}. It goes to your world balance.
    </DialogDescription>
  );
}

function WorldDepositForm({ onDone }: { onDone: () => void }) {
  const account = useWorldAccount();
  const SYMBOL = account.quoteToken?.symbol ?? "";
  const DECIMALS = account.quoteToken?.decimals ?? 6;
  const [amount, setAmount] = useState("");
  const held = account.walletBalance;
  const image = SYMBOL ? tokenDisplay(SYMBOL, null, protocolConfig.chainId)?.image : null;
  let raw: bigint | null = null;
  let error: string | null = null;
  if (amount.trim()) {
    try {
      raw = vaultAmount(amount, DECIMALS, SYMBOL);
      if (held !== null && raw > held) error = "Amount exceeds your wallet balance.";
    } catch (e) {
      error = e instanceof Error ? e.message : "Enter a valid amount.";
    }
  }
  const available =
    held === null
      ? null
      : `${formatCompactNumber(tokenAmount(held.toString(), DECIMALS))} ${SYMBOL}`;
  if (!worldsEnabled)
    return (
      <p className="text-sm text-muted-foreground">
        Worlds are not switched on for this network yet.
      </p>
    );
  return (
    <>
      <FieldSet disabled={account.busy}>
        <FieldGroup>
          <Field>
            <FieldTitle>Asset</FieldTitle>
            {/* The one token a world balance holds: shown, not chosen. */}
            <div
              data-testid="world-deposit-asset"
              className="flex h-11 w-full items-center gap-2 rounded-lg bg-secondary px-2.5"
            >
              <TokenIcon symbol={SYMBOL} image={image} />
              <span className="font-medium leading-none">{SYMBOL}</span>
              <span
                className="ml-auto text-xs font-medium tabular-nums text-muted-foreground"
                title={`${SYMBOL} wallet balance`}
              >
                {held === null ? "—" : formatCompactNumber(tokenAmount(held.toString(), DECIMALS))}
              </span>
            </div>
          </Field>
          <DepositAmountField
            id="world-deposit-amount"
            symbol={SYMBOL}
            available={available}
            amount={amount}
            onAmount={setAmount}
            error={error}
            onMax={() => held !== null && setAmount(formatTokenAmount(held, DECIMALS))}
            maxDisabled={held === null || held === 0n}
          />
        </FieldGroup>
      </FieldSet>
      <DialogFooter className="border-0 bg-transparent pt-0">
        <Button
          size="lg"
          className="w-full rounded-lg"
          disabled={
            account.busy ||
            !account.quote ||
            !account.quoteToken ||
            held === null ||
            raw === null ||
            Boolean(error)
          }
          onClick={() => {
            if (raw !== null) void account.deposit(raw, onDone);
          }}
        >
          {account.busy ? (
            <Spinner />
          ) : (
            <>
              <ArrowDownToLine data-icon="inline-start" />
              Deposit {SYMBOL}
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
