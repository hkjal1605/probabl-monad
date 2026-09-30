"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataError, EmptyState, PageHeading, Stat } from "@/components/ui/page";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeltaVaultAccount, useDeltaVaults } from "@/hooks/useDeltaVaults";
import { useMarkets } from "@/hooks/useProtocolData";
import { capacityPercent } from "@/lib/delta-vault/amounts";
import { formatUsd, tokenAmount } from "@/lib/format/display";
import { baseHigh, quoteHigh } from "../utils/holdings";
import { VaultHoldings } from "./VaultHoldings";
import { VaultMarkets } from "./VaultMarkets";
import { VaultPosition } from "./VaultPosition";
import { VaultTransfer } from "./VaultTransfer";

export function VaultDetailClient({ address }: { address: string }) {
  const { vaults, error, isPending, refetch } = useDeltaVaults();
  const vault = vaults.find((v) => v.address.toLowerCase() === address.toLowerCase());
  const { markets } = useMarkets();
  const position = useDeltaVaultAccount(vault?.address);
  if (error && !vault) return <DataError retry={() => void refetch()} />;
  if (isPending && !vault) return <Skeleton className="h-96 w-full" aria-label="Loading vault" />;
  if (!vault)
    return (
      <EmptyState>
        <p>This vault is not available here.</p>
        <Link href="/vaults" className="underline">
          All vaults
        </Link>
      </EmptyState>
    );
  const decimals = vault.quote.decimals ?? 6;
  const usd = (raw: string | null) => (raw === null ? null : tokenAmount(raw, decimals));
  const quoteCapacity = capacityPercent(quoteHigh(vault), BigInt(vault.caps.quote)),
    baseCapacity = capacityPercent(baseHigh(vault), BigInt(vault.caps.base));
  const capacity =
    quoteCapacity === null || baseCapacity === null
      ? (quoteCapacity ?? baseCapacity)
      : Math.max(quoteCapacity, baseCapacity);
  return (
    <>
      <PageHeading
        title={vault.name}
        description={`Quotes ${vault.base.symbol ?? "its stock"} in both outcomes of ${vault.markets.length} ${vault.markets.length === 1 ? "event" : "events"}. Deposits and withdrawals are in kind: every share owns the same slice of everything the vault holds.`}
      >
        <Badge variant={vault.paused ? "warning" : "positive"}>
          {vault.paused ? "Deposits paused · withdrawals open" : "Active"}
        </Badge>
      </PageHeading>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Value (est.)" value={formatUsd(usd(vault.value))} />
                <Stat
                  label={`Per ${vault.symbol} (est.)`}
                  value={formatUsd(usd(vault.valuePerShare))}
                />
                <Stat
                  label="Withdrawals"
                  value={
                    vault.withdrawLimitBps >= 10_000
                      ? "Any time"
                      : `${vault.withdrawLimitBps / 100}% / day`
                  }
                />
                <Stat label="Quoting" value={vault.paused ? "Paused" : "Live"} />
              </div>
              {capacity !== null && (
                <Progress value={capacity} aria-label="Capacity used">
                  <span className="text-xs text-muted-foreground">
                    Capacity {capacity.toFixed(capacity < 10 ? 1 : 0)}% used
                  </span>
                </Progress>
              )}
              <p className="text-xs text-muted-foreground">
                Estimates value {vault.base.symbol ?? "the stock"} at the vault's oracle price and
                each event's positions at its current probability. Deposits and withdrawals never
                use these estimates.
              </p>
            </CardContent>
          </Card>
          <VaultHoldings vault={vault} markets={markets} />
          <VaultMarkets vault={vault} markets={markets} />
        </div>
        <div className="flex flex-col gap-6">
          <VaultPosition vault={vault} position={position.account} markets={markets} />
          <VaultTransfer vault={vault} position={position.account} />
        </div>
      </div>
    </>
  );
}
