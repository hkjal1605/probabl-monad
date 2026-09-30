"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/page";
import { useWalletLogin } from "@/components/wallet/WalletLoginProvider";
import { tokenText } from "@/lib/delta-vault/amounts";
import { formatUsd, tokenAmount } from "@/lib/format/display";
import type { DeltaVaultAccountView, DeltaVaultView } from "@/services/delta-vaults-api-service";
import type { MarketView } from "@/types/api";

export function VaultPosition({
  vault,
  position,
  markets,
}: {
  vault: DeltaVaultView;
  position: DeltaVaultAccountView | undefined;
  markets: MarketView[];
}) {
  const login = useWalletLogin();
  const q = vault.quote.decimals ?? 6,
    b = vault.base.decimals ?? 18;
  if (!position)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your position</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            Connect a wallet to deposit or see shares.
          </p>
          <Button size="sm" onClick={login}>
            Connect wallet
          </Button>
        </CardContent>
      </Card>
    );
  const shares = BigInt(position.shares),
    supply = BigInt(vault.totalSupply);
  const value =
    vault.valuePerShare === null ? null : (shares * BigInt(vault.valuePerShare)) / 10n ** 18n;
  const claims = (position.redeems?.claims ?? []).flatMap((c) => {
    const market = markets.find(
      (m) => m.id === vault.markets.find((vm) => vm.venueId === c.venueId)?.market?.id,
    );
    return (
      [
        [c.yesQuote, q, vault.quote.symbol, "YES"],
        [c.noQuote, q, vault.quote.symbol, "NO"],
        [c.yesBase, b, vault.base.symbol, "YES"],
        [c.noBase, b, vault.base.symbol, "NO"],
      ] as const
    )
      .filter(([amount]) => BigInt(amount) > 0n)
      .map(([amount, decimals, symbol, outcome]) => ({
        key: `${c.venueId}-${symbol}-${outcome}`,
        text: `${tokenText(BigInt(amount), decimals)} ${symbol ?? ""} if ${outcome}`,
        market: market?.ticker ?? `market ${c.venueId}`,
      }));
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your position</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Stat label={vault.symbol} value={tokenText(shares, 18, 4)} />
          <Stat
            label="Value (est.)"
            value={formatUsd(value === null ? null : tokenAmount(String(value), q))}
          />
        </div>
        {shares > 0n && position.redeems && (
          <div className="flex flex-col gap-1 text-sm tabular-nums">
            <p className="text-xs text-muted-foreground">
              {supply === 0n ? "0" : (Number((shares * 10_000n) / supply) / 100).toFixed(2)}% of the
              vault. Withdrawing everything now pays:
            </p>
            <p>
              {tokenText(BigInt(position.redeems.quote), q)} {vault.quote.symbol} ·{" "}
              {tokenText(BigInt(position.redeems.base), b)} {vault.base.symbol}
            </p>
            {claims.map((c) => (
              <p key={c.key} className="text-muted-foreground">
                + {c.text} · {c.market}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
