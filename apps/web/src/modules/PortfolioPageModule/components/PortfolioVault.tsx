"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVaultTransfer } from "@/hooks/useVaultTransfer";
import type { assetsForMarkets, useWalletAssets } from "@/hooks/useWalletAssets";
import { formatCompactNumber } from "@/lib/format/display";

type Asset = ReturnType<typeof assetsForMarkets>[number];
type Balance = ReturnType<typeof useWalletAssets>["balances"][number];

/** A balance in compact form (1.23K, 4.5M), cut to cents first so small ones never round up. */
const compactBalance = (raw: string, decimals: number) => {
  const cents = decimals >= 2 ? BigInt(raw) / 10n ** BigInt(decimals - 2) : BigInt(raw) * 100n;
  return formatCompactNumber(Number(cents) / 100);
};

export function PortfolioVault({
  assets,
  balances,
  fresh,
  refresh,
}: {
  assets: Asset[];
  balances: Balance[];
  fresh: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<{
    asset: Asset;
    action: "deposit" | "withdraw";
  } | null>(null);
  const [amount, setAmount] = useState("");
  const open = (asset: Asset, action: "deposit" | "withdraw") => {
    setAmount("");
    setSelected({ asset, action });
  };
  const transfer = useVaultTransfer({
    selection: selected,
    amount,
    balances,
    fresh,
    refresh,
    onSuccess: () => {
      setSelected(null);
      setAmount("");
    },
  });
  const chosen = selected && balances.find((row) => row.token === selected.asset.token);
  // Wallet balances can go stale while the page idles (a bearer session's stream does not carry
  // them), so an open dialog rereads them once: on opening and whenever they age out again.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (selected && !fresh) void refreshRef.current();
  }, [selected, fresh]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!fresh && balances.length === 0 ? (
        <Skeleton className="h-20 w-full" aria-label="Loading vault balances" />
      ) : assets.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">
          Assets appear here when a market is available.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Available</TableHead>
              <TableHead>In orders</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-0">
            {assets.map((asset) => {
              const row = balances.find((value) => value.token === asset.token);
              const b = row?.balance;
              return (
                <TableRow key={asset.token}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      <Avatar size="sm">
                        {asset.metadata?.image && <AvatarImage src={asset.metadata.image} alt="" />}
                        <AvatarFallback className="text-[9px]">
                          {asset.symbol.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      {asset.symbol}
                    </span>
                  </TableCell>
                  <TableCell>
                    {b ? compactBalance(b.vaultAvailable, asset.decimals) : "—"}
                  </TableCell>
                  <TableCell>{b ? compactBalance(b.reserved, asset.decimals) : "—"}</TableCell>
                  <TableCell>
                    {b ? compactBalance(b.canonicalBalance, asset.decimals) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-base text-foreground"
                        disabled={!b}
                        onClick={() => open(asset, "deposit")}
                      >
                        Deposit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-base"
                        disabled={!b || BigInt(b.vaultAvailable) === 0n}
                        onClick={() => open(asset, "withdraw")}
                      >
                        Withdraw
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(value, details) => {
          if (transfer.busy) details.cancel();
          else if (!value) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">
              {selected?.action === "deposit"
                ? "Deposit into Trading Account"
                : "Withdraw from vault"}
            </DialogTitle>
            {selected?.action === "withdraw" && (
              <DialogDescription>
                {selected.asset.symbol} · Only funds not reserved by open orders can be withdrawn.
              </DialogDescription>
            )}
          </DialogHeader>
          <FieldSet disabled={transfer.busy}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="vault-amount">Amount ({selected?.asset.symbol})</FieldLabel>
                <Input
                  id="vault-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                />
              </Field>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium tabular-nums">
                  Balance:{" "}
                  {chosen && selected
                    ? `${compactBalance(
                        selected.action === "deposit"
                          ? chosen.balance.canonicalBalance
                          : chosen.balance.vaultAvailable,
                        selected.asset.decimals,
                      )} ${selected.asset.symbol}`
                    : "—"}
                </span>
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto px-0"
                  disabled={!chosen || !fresh}
                  onClick={() => setAmount(chosen ? transfer.maxAmount() : "")}
                >
                  Max
                </Button>
              </div>
            </FieldGroup>
          </FieldSet>
          <Button
            disabled={transfer.busy || !fresh || !transfer.balance || !amount}
            onClick={transfer.submit}
          >
            {transfer.busy ? <Spinner /> : selected?.action === "deposit" ? "Deposit" : "Withdraw"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
