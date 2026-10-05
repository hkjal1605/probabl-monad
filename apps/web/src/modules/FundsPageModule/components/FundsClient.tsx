"use client";

import { useWallet } from "@/components/providers/WalletProvider";
import { AccountStepEmpty } from "@/components/wallet/AccountGate";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { PortfolioVault } from "@/modules/PortfolioPageModule/components/PortfolioVault";
import { TradingPermissionCard } from "@/modules/PortfolioPageModule/components/TradingPermissionCard";
import type { MarketView } from "@/types/api";

export function FundsClient({ markets }: { markets: MarketView[] }) {
  const wallet = useWallet();
  const assets = useWalletAssets(markets);
  if (wallet.access !== "member" && wallet.access !== "suspended")
    return <AccountStepEmpty>Connect a wallet to manage deposited tokens.</AccountStepEmpty>;
  return (
    <div className="mx-auto grid max-w-[1120px] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <PortfolioVault
        assets={assets.assets}
        balances={assets.balances}
        fresh={assets.isDataFresh}
        refresh={assets.refetch}
      />
      <TradingPermissionCard />
    </div>
  );
}
