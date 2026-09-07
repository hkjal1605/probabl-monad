import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import { ArrowUpRight, FileCheck2, Gavel, TimerReset } from "lucide-react";
import { LifecycleBadge } from "@/components/data/StatusBadge";
import { DemoPage } from "@/components/demo/DemoPage";
import { protocolConfig } from "@/config/protocol";
import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { shortAddress } from "@/lib/format/display";

export async function ResolutionPageModule({ selected }: { selected?: string }) {
  if (await isDemoMode()) return <DemoPage page="resolution" marketId={selected} />;
  const markets = await serverApi.markets();
  const rows = await Promise.all(
    markets.map(async (market) => ({ market, resolution: await serverApi.resolution(market.id) })),
  );
  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 py-14 sm:px-8">
      <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">
        Resolution center
      </p>
      <h1 className="mt-4 font-display text-5xl font-medium tracking-[-0.06em] sm:text-6xl">
        Human-reviewed. Publicly verifiable.
      </h1>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
        Track the manual v1 process from cutoff through independent evidence review, multisig
        execution, canonical reconciliation, and redemption.
      </p>
      <div className="mt-10 grid gap-5">
        {rows.map(({ market, resolution }) => (
          <Card key={market.id} className={selected === market.id ? "border-brand/50" : ""}>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{market.ticker}</Badge>
                  <LifecycleBadge state={market.lifecycle} />
                </div>
                <CardTitle className="mt-4 text-xl">{market.question}</CardTitle>
              </div>
              {resolution ? (
                <FileCheck2 className="text-positive" />
              ) : (
                <TimerReset className="text-muted-foreground" />
              )}
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 rounded-xl bg-muted/45 p-4 sm:grid-cols-4">
                <Fact
                  label="Mapped condition"
                  value={shortAddress(market.mapping.conditionId, 6)}
                />
                <Fact
                  label="Final reference"
                  value={
                    resolution
                      ? resolution.yesPayout === "1"
                        ? "YES"
                        : resolution.noPayout === "1"
                          ? "NO"
                          : "Invalid · 50/50"
                      : "Awaiting manual review"
                  }
                />
                <Fact
                  label="Local payout"
                  value={
                    resolution
                      ? `${resolution.yesPayout}/${resolution.noPayout} ÷ ${resolution.payoutDenominator}`
                      : "Not finalized"
                  }
                />
                <Fact
                  label="Admin transaction"
                  value={
                    resolution?.transactionHash
                      ? shortAddress(resolution.transactionHash, 6)
                      : "Not submitted"
                  }
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Polymarket is the mapped evidence source; the local multisig remains the v1
                  settlement authority.
                </p>
                {resolution?.evidenceUri && (
                  <Button asChild variant="outline" size="sm">
                    <a href={resolution.evidenceUri} target="_blank" rel="noreferrer">
                      Evidence <ArrowUpRight />
                    </a>
                  </Button>
                )}
                {resolution?.transactionHash && protocolConfig.explorerUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={`${protocolConfig.explorerUrl.replace(/\/$/, "")}/tx/${resolution.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Admin transaction <ArrowUpRight />
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
            <Gavel className="text-muted-foreground" />
            <p className="mt-4 font-semibold">No markets are indexed</p>
          </div>
        )}
      </div>
    </main>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  );
}
