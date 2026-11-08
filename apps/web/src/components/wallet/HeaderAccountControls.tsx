"use client";

import { ArrowDownToLine } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMarkets, useOrders } from "@/hooks/useProtocolData";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { useWorldPositions } from "@/hooks/useWorldAccount";
import { formatCompactUsd } from "@/lib/format/display";
import { loadChunk } from "@/lib/load-chunk";
import { portfolioValue } from "@/lib/portfolio/summary";
import { isWorldsPath } from "@/lib/worlds/paths";
import { worldPortfolioValue } from "@/lib/worlds/portfolio";
import { useAccountStep } from "./AccountGate";
import { WalletButton } from "./WalletButton";

// Loaded the first time one opens, so their forms and vault code aren't in every page's bundle.
const DepositDialog = dynamic(
  () => loadChunk(() => import("./DepositDialog").then((m) => m.DepositDialog)),
  {
    ssr: false,
  },
);
const WorldDepositDialog = dynamic(
  () => loadChunk(() => import("./WorldDepositDialog").then((m) => m.WorldDepositDialog)),
  { ssr: false },
);

/** Where the header shows the portfolio value (Tailwind's `xl`): narrower, it isn't shown. */
const VALUE_SHOWN = "(min-width: 1280px)";

const formatHeaderUsd = (value: number) => (value === 0 ? "$0.00" : formatCompactUsd(value));

export function HeaderAccountControls() {
  const wallet = useWallet();
  const pathname = usePathname();
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
  // Worlds pages show and fund the world account; every other page the exchange account.
  return isWorldsPath(pathname) ? <WorldAccountControls /> : <MemberAccountControls />;
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
          <PortfolioValue
            href="/portfolio"
            title="Net portfolio value"
            loading={valuationLoading}
            value={valuationFresh ? value : null}
          />
        </div>
        <DepositButton
          onClick={() => {
            setDepositUsed(true);
            setDepositOpen(true);
          }}
        />
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

/** On worlds pages: the world account's value (its balance and positions, as My worlds counts
 * them) and deposits of the token worlds trade in into its balance. The value is read only where it is shown, and the
 * deposit's reads only while its dialog is open; no exchange data is read here. */
function WorldAccountControls() {
  const shown = useMediaQuery(VALUE_SHOWN);
  const [depositOpen, setDepositOpen] = useState(false),
    [depositUsed, setDepositUsed] = useState(false);
  return (
    <>
      <div className="flex items-center gap-5">
        {shown && <WorldPortfolioValue />}
        <DepositButton
          onClick={() => {
            setDepositUsed(true);
            setDepositOpen(true);
          }}
        />
        <WalletButton />
      </div>
      {depositUsed && <WorldDepositDialog open={depositOpen} onOpenChange={setDepositOpen} />}
    </>
  );
}

function WorldPortfolioValue() {
  const positions = useWorldPositions();
  return (
    <PortfolioValue
      href="/worlds/me"
      title="World balance and positions"
      loading={positions.loading}
      value={positions.data && !positions.error ? worldPortfolioValue(positions.data) : null}
    />
  );
}

function PortfolioValue({
  href,
  title,
  loading,
  value,
}: {
  href: string;
  title: string;
  loading: boolean;
  /** null when it can't be valued now. */
  value: number | null;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-end gap-1 text-right leading-none"
      title={title}
      data-testid="header-portfolio"
    >
      <span className="text-xs font-medium text-muted-foreground">Portfolio</span>
      {loading ? (
        <Skeleton className="h-3.5 w-14" aria-label="Loading portfolio value" />
      ) : (
        <span className="text-sm font-medium tabular-nums text-positive">
          {value !== null ? formatHeaderUsd(value) : "—"}
        </span>
      )}
    </Link>
  );
}

function DepositButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" className="hidden rounded-lg px-3 sm:inline-flex" onClick={onClick}>
      <ArrowDownToLine data-icon="inline-start" />
      Deposit
    </Button>
  );
}
