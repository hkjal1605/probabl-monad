"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataError, EmptyState, Stat } from "@/components/ui/page";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeltaVaults } from "@/hooks/useDeltaVaults";
import { capacityPercent } from "@/lib/delta-vault/amounts";
import { formatUsd, tokenAmount } from "@/lib/format/display";
import type { DeltaVaultView } from "@/services/delta-vaults-api-service";
import { quoteHigh } from "../../VaultDetailPageModule/utils/holdings";

export function VaultsClient() {
  const { vaults, error, isPending, refetch } = useDeltaVaults();
  if (error && !vaults.length) return <DataError retry={() => void refetch()} />;
  if (isPending && !vaults.length)
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-44 w-full" aria-label="Loading vaults" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  if (!vaults.length) return <EmptyState>No vaults are open yet.</EmptyState>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {vaults.map((vault) => (
        <VaultCard key={vault.address} vault={vault} />
      ))}
    </div>
  );
}

function VaultCard({ vault }: { vault: DeltaVaultView }) {
  const decimals = vault.quote.decimals ?? 6;
  const usd = (raw: string | null) => (raw === null ? null : tokenAmount(raw, decimals));
  const capacity = capacityPercent(quoteHigh(vault), BigInt(vault.caps.quote));
  return (
    <Link href={`/vaults/${vault.address}`} className="rounded-xl focus-visible:outline-2">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="truncate">{vault.name}</CardTitle>
          <Badge variant={vault.paused ? "warning" : "positive"}>
            {vault.paused ? "Deposits paused" : "Active"}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Value (est.)" value={formatUsd(usd(vault.value))} />
            <Stat
              label={`Per ${vault.symbol} (est.)`}
              value={formatUsd(usd(vault.valuePerShare))}
            />
            <Stat
              label="Events quoted"
              value={`${vault.markets.length} · ${vault.base.symbol ?? "stock"}`}
            />
          </div>
          {capacity !== null && (
            <Progress value={capacity} aria-label="Capacity used">
              <span className="text-xs text-muted-foreground">
                Capacity {capacity.toFixed(capacity < 10 ? 1 : 0)}% used
              </span>
            </Progress>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
