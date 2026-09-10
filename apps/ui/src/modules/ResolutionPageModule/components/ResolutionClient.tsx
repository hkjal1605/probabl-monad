"use client";
import { Button } from "@conditional-stocks/ui-kit/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@conditional-stocks/ui-kit/select";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { LifecycleBadge } from "@/components/data/StatusBadge";
import { useDemo } from "@/components/providers/DemoProvider";
import { DataError, EmptyState, Page, PageHeading, Stat } from "@/components/ui/page";
import { protocolConfig } from "@/config/protocol";
import { useMarkets } from "@/hooks/useProtocolData";
import { api } from "@/lib/api/client";
import type { MarketView } from "@/lib/api/types";
import { formatTime } from "@/lib/format/display";
import { outcomeLabel, safeExternalUrl } from "@/lib/markets/resolution";
import { MarketRules } from "@/modules/MarketDetailPageModule/components/MarketRules";

const stages = ["open", "frozen", "awaiting-resolution", "resolved", "redeemable"];
const labels = ["OPEN", "FROZEN", "REVIEW", "RESOLVED", "REDEEMABLE"];
export function ResolutionClient({
  markets: initial,
  selected,
}: {
  markets: MarketView[];
  selected?: string | undefined;
}) {
  const query = useMarkets(initial),
    { markets } = query;
  return (
    <Page>
      <PageHeading
        title="Resolution"
        description={
          <>
            From open books to a settled outcome.
            <br />
            Public evidence, canonical payouts, and claim redemption.
          </>
        }
      >
        <div className="flex gap-8">
          <Stat label="open" value={markets.filter((m) => m.lifecycle === "open").length} />
          <Stat
            label="in review"
            value={markets.filter((m) => m.lifecycle === "awaiting-resolution").length}
          />
          <Stat
            label="redeemable"
            value={markets.filter((m) => m.lifecycle === "redeemable").length}
          />
        </div>
      </PageHeading>
      {query.isError && (
        <DataError
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {markets.map((market) => (
          <ResolutionCard key={market.id} market={market} selected={selected === market.id} />
        ))}
      </div>
      {!markets.length && !query.isError && (
        <section className="panel">
          <EmptyState>
            {query.isFetching ? "Reading markets…" : "No markets are indexed."}
          </EmptyState>
        </section>
      )}
    </Page>
  );
}
function ResolutionCard({ market, selected }: { market: MarketView; selected: boolean }) {
  const demo = useDemo();
  const [outcome, setOutcome] = useState<"YES" | "NO" | "INVALID">("YES");
  const query = useQuery({
    queryKey: ["resolution", market.id, protocolConfig.chainId],
    queryFn: ({ signal }) => api.resolution(market.id, signal),
    // The indexer creates a resolution row only after finalization. Market polling detects that transition.
    enabled: !demo && ["resolved", "redeemable", "archived"].includes(market.lifecycle),
    refetchInterval: 8000,
  });
  const resolution = demo
    ? (demo.state.markets.find((m) => m.view.id === market.id)?.resolution ?? null)
    : (query.data ?? null);
  const index = market.lifecycle === "archived" ? 5 : stages.indexOf(market.lifecycle);
  const evidence = safeExternalUrl(resolution?.evidenceUri),
    explorer = !demo ? safeExternalUrl(protocolConfig.explorerUrl) : null;
  const advance = () => {
    if (!demo) return;
    if (
      market.lifecycle === "awaiting-resolution" &&
      !window.confirm(
        `Finalize ${outcome} in this local simulation? Reset is required to change it.`,
      )
    )
      return;
    try {
      demo.dispatch({ type: "advance", marketId: market.id, outcome });
      toast.success("Demo lifecycle advanced.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lifecycle action failed");
    }
  };
  return (
    <article
      id={market.id}
      className={`panel scroll-mt-20 p-5 sm:p-6 ${selected ? "border-brand/50" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <strong className="font-mono text-xs">{market.ticker}</strong>
          <LifecycleBadge state={market.lifecycle} />
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          Cutoff {formatTime(market.cutoff)}
        </span>
      </div>
      <h2 className="mt-5 text-lg font-semibold leading-7 tracking-tight">{market.question}</h2>
      <p className="mt-2 text-xs font-medium text-muted-foreground">
        Applies to this market’s books and claims. Each local market resolves independently.
      </p>
      <ol className="my-7 grid grid-cols-5" aria-label="Resolution lifecycle">
        {labels.map((label, i) => (
          <li
            key={label}
            aria-current={index === i ? "step" : undefined}
            className={`relative space-y-3 border-t-2 pt-4 text-center text-[10px] font-semibold tracking-wide sm:text-xs ${i <= index ? "border-positive text-positive" : "text-muted-foreground"}`}
          >
            <span
              className={`absolute -top-1.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full ${i <= index ? "bg-positive" : "bg-border"}`}
            />
            {label}
          </li>
        ))}
      </ol>
      <p className="text-sm font-medium leading-6 text-muted-foreground">
        {market.lifecycle === "open"
          ? "Both books are open. At cutoff, trading stops; expired or closed orders can release their escrow."
          : market.lifecycle === "scheduled"
            ? "Trading has not opened yet."
            : index < 3
              ? "Trading is closed. Independent evidence review and an authorized onchain resolution are required."
              : `Final reference: ${outcomeLabel(resolution)}. Payouts follow the local contract’s finalized numerator and denominator.`}
      </p>
      {!demo && query.isError && (
        <DataError
          message="Resolution evidence is temporarily unavailable."
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {resolution?.payoutDenominator && (
        <div className="mt-4 flex flex-wrap justify-between gap-3 rounded-lg bg-secondary p-4 text-sm">
          <span>
            YES payout{" "}
            <b className="font-mono">
              {resolution.yesPayout}/{resolution.payoutDenominator}
            </b>
          </span>
          <span>
            NO payout{" "}
            <b className="font-mono">
              {resolution.noPayout}/{resolution.payoutDenominator}
            </b>
          </span>
        </div>
      )}
      <details className="my-5 border-y py-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Evidence &amp; exact terms
        </summary>
        <MarketRules market={market} />
        {resolution?.evidenceHash && (
          <p className="break-all font-mono text-xs">Evidence hash: {resolution.evidenceHash}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {evidence && (
            <Button asChild size="sm" variant="outline">
              <a href={evidence} target="_blank" rel="noreferrer">
                Evidence <ArrowUpRight />
              </a>
            </Button>
          )}
          {explorer &&
            resolution?.transactionHash &&
            /^0x[0-9a-fA-F]{64}$/.test(resolution.transactionHash) && (
              <Button asChild size="sm" variant="outline">
                <a
                  href={`${explorer.replace(/\/$/, "")}/tx/${resolution.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Admin transaction <ArrowUpRight />
                </a>
              </Button>
            )}
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="link" asChild>
          <Link href={`/markets/${market.id}`}>View market →</Link>
        </Button>
        {market.lifecycle === "redeemable" || market.lifecycle === "archived" ? (
          <Button variant="brand" asChild>
            <Link href="/portfolio">Redeem in portfolio</Link>
          </Button>
        ) : (
          demo && (
            <div className="flex gap-2">
              {market.lifecycle === "awaiting-resolution" && (
                <Select
                  value={outcome}
                  onValueChange={(value) => {
                    if (value === "YES" || value === "NO" || value === "INVALID") setOutcome(value);
                  }}
                >
                  <SelectTrigger aria-label="Demo resolution outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">YES</SelectItem>
                    <SelectItem value="NO">NO</SelectItem>
                    <SelectItem value="INVALID">Invalid · 50/50</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" onClick={advance}>
                {market.lifecycle === "open"
                  ? "Simulate cutoff"
                  : market.lifecycle === "awaiting-resolution"
                    ? "Finalize demo resolution"
                    : "Advance demo lifecycle"}
              </Button>
            </div>
          )
        )}
      </div>
    </article>
  );
}
