"use client";

import { ArrowDownToLine } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useVaultTransfer } from "@/hooks/useVaultTransfer";
import type { WalletAsset, WalletAssetBalance } from "@/hooks/useWalletAssets";
import { formatCompactNumber, tokenAmount } from "@/lib/format/display";
import { vaultAmount } from "@/lib/trading/vault";
import { DepositAmountField, TokenIcon } from "./DepositFields";

function AssetIcon({ asset }: { asset: WalletAsset }) {
  return <TokenIcon symbol={asset.symbol} image={asset.metadata?.image} />;
}

export function DepositDialog({
  open,
  onOpenChange,
  assets,
  balances,
  fresh,
  refresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: WalletAsset[];
  balances: WalletAssetBalance[];
  fresh: boolean;
  refresh: () => Promise<unknown>;
}) {
  const orderedAssets = useMemo(
    () =>
      [...assets].sort(
        (left, right) =>
          Number(right.symbol.toUpperCase() === "USDC") -
            Number(left.symbol.toUpperCase() === "USDC") || left.symbol.localeCompare(right.symbol),
      ),
    [assets],
  );
  const [selectedMint, setSelectedMint] = useState("");
  const [amount, setAmount] = useState("");
  const asset =
    orderedAssets.find((item) => item.token === selectedMint) ?? orderedAssets.at(0) ?? null;
  const selection = asset ? { action: "deposit" as const, asset } : null;
  const transfer = useVaultTransfer({
    selection: open ? selection : null,
    amount,
    balances,
    fresh,
    refresh,
    onSuccess: () => {
      setAmount("");
      onOpenChange(false);
    },
  });
  const selectedBalance = balances.find((row) => row.token === asset?.token)?.balance;
  const walletRaw = !selectedBalance || !asset ? null : BigInt(selectedBalance.canonicalBalance);
  let amountError: string | null = null;
  if (amount.trim()) {
    try {
      const raw = vaultAmount(amount, asset?.decimals ?? 0, asset?.symbol);
      if (walletRaw !== null && raw > walletRaw)
        amountError = "Amount exceeds your wallet balance.";
    } catch (error) {
      amountError = error instanceof Error ? error.message : "Enter a valid amount.";
    }
  }
  const items = Object.fromEntries(orderedAssets.map((item) => [item.token, item.symbol]));
  const walletBalance = (item: WalletAsset) => {
    const indexed = balances.find((row) => row.token === item.token)?.balance;
    if (!indexed) return "0";
    return formatCompactNumber(tokenAmount(indexed.canonicalBalance, item.decimals));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (transfer.busy) details.cancel();
        else {
          if (!next) setAmount("");
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="gap-5 sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Deposit funds</DialogTitle>
        </DialogHeader>

        {orderedAssets.length === 0 ? (
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>No supported assets yet</ItemTitle>
              <p className="text-sm text-muted-foreground">
                Assets appear after the market catalogue and wallet balances are indexed.
              </p>
            </ItemContent>
          </Item>
        ) : (
          <FieldSet disabled={transfer.busy}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="header-deposit-asset">Asset</FieldLabel>
                <Select
                  value={asset?.token ?? ""}
                  items={items}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    setSelectedMint(value);
                    setAmount("");
                  }}
                >
                  <SelectTrigger id="header-deposit-asset" className="h-11 w-full bg-secondary">
                    {asset && <AssetIcon asset={asset} />}
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    alignItemWithTrigger={false}
                    className="max-h-48 w-(--anchor-width) max-w-(--anchor-width)"
                  >
                    <SelectGroup>
                      {orderedAssets.map((item) => (
                        <SelectItem
                          key={item.token}
                          value={item.token}
                          className="py-2.5 pr-8 pl-2"
                        >
                          <span className="flex w-full items-center gap-2">
                            <AssetIcon asset={item} />
                            <span className="font-medium leading-none">{item.symbol}</span>
                            <span
                              className="ml-auto text-right text-xs font-medium tabular-nums text-muted-foreground"
                              title={`${item.symbol} wallet balance`}
                            >
                              {walletBalance(item)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <DepositAmountField
                id="header-deposit-amount"
                symbol={asset?.symbol}
                available={
                  walletRaw === null || !asset
                    ? null
                    : `${formatCompactNumber(tokenAmount(walletRaw.toString(), asset.decimals))} ${asset.symbol}`
                }
                amount={amount}
                onAmount={setAmount}
                error={amountError}
                onMax={() => setAmount(transfer.maxAmount())}
                maxDisabled={!selectedBalance || !fresh}
              />
            </FieldGroup>
          </FieldSet>
        )}

        <DialogFooter className="border-0 bg-transparent pt-0">
          <Button
            size="lg"
            className="w-full rounded-lg"
            disabled={
              transfer.busy || !fresh || !selectedBalance || !amount.trim() || Boolean(amountError)
            }
            onClick={transfer.submit}
          >
            {transfer.busy ? (
              <Spinner />
            ) : (
              <>
                <ArrowDownToLine data-icon="inline-start" />
                Deposit {asset?.symbol}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
