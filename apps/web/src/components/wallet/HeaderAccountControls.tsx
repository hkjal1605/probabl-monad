"use client";

import { ArrowDownToLine } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarkets, useOrders } from "@/hooks/useProtocolData";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { formatCompactUsd } from "@/lib/format/display";
import { loadChunk } from "@/lib/load-chunk";
import { portfolioValue } from "@/lib/portfolio/summary";
import { useAccountStep } from "./AccountGate";
import { WalletButton } from "./WalletButton";

// Loaded the first time it opens, so its form and vault code aren't in every page's bundle.
const DepositDialog = dynamic(
  () => loadChunk(() => import("./DepositDialog").then((m) => m.DepositDialog)),
  {
    ssr: false,
  },
);

const formatHeaderUsd = (value: number) => (value === 0 ? "$0.00" : formatCompactUsd(value));

export function HeaderAccountControls() {
  const wallet = useWallet();
  const step = useAccountStep();
  if (!wallet.account) return <WalletButton />;
  // Signed out or not yet invited: the header offers the next step instead of balances.
  if (step && wallet.access !== "suspended")
    return (
      <div className="flex items-center gap-5">
        <Button
          size="sm"
          className="rounded-lg px-3"
          disabled={step.disabled}
          onClick={step.action}
        >
          {step.kind === "invite"
            ? "Join with invite"
            : step.kind === "network"
              ? "Switch network"
              : "Sign in"}
        </Button>
        <WalletButton />
      </div>
    );
  return <MemberAccountControls />;
}

/** A member's portfolio value and deposits. The markets come with their spot prices, which value
 * stock-token balances. */
function MemberAccountControls() {
  const catalogue = useMarkets();
  const assets = useWalletAssets(catalogue.markets);
  const orders = useOrders();
  const [depositOpen, setDepositOpen] = useState(false),
    [depositUsed, setDepositUsed] = useState(false);
  const balancesFresh = assets.isDataFresh && !catalogue.isError;
  const valuationFresh = balancesFresh && orders.isDataFresh && orders.data?.openTruncated !== true;
  const balancesLoading = assets.isPending || catalogue.isPending;
  const valuationLoading = balancesLoading || orders.isPending || catalogue.spotPending;
  const value = useMemo(
    () => portfolioValue(catalogue.markets, assets.balances, assets.positions, orders.orders),
    [catalogue.markets, assets.balances, assets.positions, orders.orders],
  );
  return (
    <>
      <div className="flex items-center gap-5">
        <div className="hidden items-center gap-5 xl:flex">
          <Link
            href="/portfolio"
            className="flex flex-col items-end gap-1 text-right leading-none"
            title="Net portfolio value"
          >
            <span className="text-xs font-medium text-muted-foreground">Portfolio</span>
            {valuationLoading ? (
              <Skeleton className="h-3.5 w-14" aria-label="Loading portfolio value" />
            ) : (
              <span className="text-sm font-medium tabular-nums text-positive">
                {valuationFresh && value !== null ? formatHeaderUsd(value) : "—"}
              </span>
            )}
          </Link>
        </div>
        <Button
          size="sm"
          className="hidden rounded-lg px-3 sm:inline-flex"
          onClick={() => {
            setDepositUsed(true);
            setDepositOpen(true);
          }}
        >
          <ArrowDownToLine data-icon="inline-start" />
          Deposit
        </Button>
        <WalletButton />
      </div>
      {depositUsed && (
        <DepositDialog
          open={depositOpen}
          onOpenChange={setDepositOpen}
          assets={assets.assets}
          balances={assets.balances}
          fresh={balancesFresh}
          refresh={assets.refetch}
        />
      )}
    </>
  );
}
