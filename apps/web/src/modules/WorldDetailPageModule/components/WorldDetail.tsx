"use client";
import { ArrowLeft, MessageSquarePlus, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useMemberAccount } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { DataError, EmptyState } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { ActivityList, HolderList } from "@/components/worlds/People";
import { SectionTitle, WalletDot } from "@/components/worlds/primitives";
import { HERO_SENTENCE, HERO_WIDTH, WorldSentence } from "@/components/worlds/Sentence";
import { StockChart } from "@/components/worlds/StockChart";
import { shareLink } from "@/components/worlds/share";
import { type BreakdownLeg, WorldBreakdown } from "@/components/worlds/WorldBreakdown";
import { WorldTicket } from "@/components/worlds/WorldTicket";
import { useBook, useFills, useHolders, useRead, useStocks } from "@/hooks/useWorlds";
import { cn } from "@/lib/utils";
import { ago, legLabel, shortWallet, strikeText, until, venueResult } from "@/lib/worlds/format";
import { bookOffers, type ProductName, stakeWithin } from "@/lib/worlds/offer";
import type { BookView } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import { WorldDetailSkeleton } from "./WorldDetailSkeleton";

const STATE_TEXT: Record<string, string> = {
  trading: "Trading",
  halted: "Paused while an event is decided",
  closed: "Closed to new trades",
  failed: "Settled: the world didn't happen",
  awaitingFix: "Every event happened: waiting for the close",
  passed: "Settled: every event happened",
  fixed: "Settled",
};

/** A world as anyone sees it: what it says, how its events stand, how likely it is, who's in,
 * and the ticket to back the view, take the other side, or say your own. */
export function WorldDetail({ book: raw }: { book: string }) {
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const you = useMemberAccount();
  const book = useBook(id);
  const holders = useHolders(id);
  const fills = useFills(id);
  // The stocks list (shared, read once a minute), for the chart.
  const stocks = useStocks();
  const deployment = useRead("world-deployment", (signal) => worldsApi.deployment(signal));
  const packet = useRead(
    book.data?.metadataUri ? `packet:${book.data.metadataUri}` : null,
    (signal) => worldsApi.packet(book.data!.metadataUri, signal),
  );
  const [side, setSide] = useState<"Same view" | "Other side">("Same view");
  const [product, setProduct] = useState<ProductName>("All-in");
  const onProduct = useCallback((p: ProductName) => setProduct(p), []);
  // What the ticket's orders cost, fee included: the outcomes are for the stake they buy.
  const [amounts, setAmounts] = useState({ allIn: 20, moneyBack: 100 });
  const onAmounts = useCallback((a: { allIn: number; moneyBack: number }) => setAmounts(a), []);

  const b = book.data;
  const opinionDirection = b?.opinion?.direction ?? null;
  const direction =
    opinionDirection && side === "Other side"
      ? opinionDirection === "above"
        ? "below"
        : "above"
      : opinionDirection;
  const sentence = useMemo(() => (b ? sentenceOf(b, direction) : null), [b, direction]);
  const offer = useMemo(() => {
    if (!b) return null;
    const offers = bookOffers(
      b,
      {
        allIn: stakeWithin(amounts.allIn, b.feeBps),
        moneyBack: stakeWithin(amounts.moneyBack, b.feeBps),
      },
      direction,
    );
    return offers.find((o) => o.name === product) ?? offers[0] ?? null;
  }, [b, direction, product, amounts]);

  if (id === null) return <EmptyState>This world doesn't exist.</EmptyState>;
  if (book.loading) return <WorldDetailSkeleton bare />;
  if (book.error || !b)
    return book.error?.message.includes("not-found") ||
      (book.error as { status?: number } | null)?.status === 404 ? (
      <EmptyState>This world doesn't exist.</EmptyState>
    ) : (
      <DataError message="This world is unavailable right now." retry={book.refresh} />
    );

  const vaults = (deployment.data?.vaults ?? []).map((v) => v.toLowerCase());
  const analytics = b.analytics;
  const rulesOf = (eventKey: string) =>
    packet.data?.packet.legs.find((l) => l.eventKey.toLowerCase() === eventKey.toLowerCase())
      ?.rules ?? null;
  const decided = ["failed", "passed", "fixed"].includes(b.state);
  const stock = sentence!.stock;
  // Its stock in the stocks list: the chart's token and logo.
  const listed = b.underlying
    ? stocks.data?.find((x) => x.underlying.toLowerCase() === b.underlying!.toLowerCase())
    : undefined;
  const share = () => void shareLink(window.location.href, b.title ?? undefined);
  const ownWords = sentence ? `${b.opinion?.sentence ?? b.title ?? ""}`.replace(/\.$/, "") : "";

  return (
    <div className="flex flex-col gap-8 pt-4 sm:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          render={<Link href="/worlds" />}
          nativeButton={false}
        >
          <ArrowLeft data-icon="inline-start" />
          Worlds
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={share}>
            <Share2 data-icon="inline-start" />
            Share
          </Button>
          <Button
            variant="secondary"
            size="sm"
            render={<Link href={`/worlds/new?q=${encodeURIComponent(ownWords)}`} />}
            nativeButton={false}
          >
            <MessageSquarePlus data-icon="inline-start" />
            Say your own
          </Button>
        </div>
      </div>

      {/* The world as the worlds page says it: the same size, spacing and width, centred. */}
      <section
        className={cn(
          "mx-auto flex w-full flex-col items-center gap-5 text-center sm:gap-7",
          HERO_WIDTH,
        )}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {b.creator && (
            <span className="flex items-center gap-2">
              <WalletDot address={b.creator} className="size-4" />
              {you?.toLowerCase() === b.creator.toLowerCase() ? "You" : shortWallet(b.creator)}{" "}
              opened this world {ago(b.createdAt)}
            </span>
          )}
          <span
            className={decided ? "text-foreground" : b.tradable ? "text-positive" : "text-warning"}
          >
            {STATE_TEXT[b.state] ?? b.state}
          </span>
          {b.tradable && <span>· trades for {until(Number(b.cutoff))}</span>}
          {holders.data && (
            <span>
              · {holders.data.traders} {holders.data.traders === 1 ? "trader" : "traders"}
            </span>
          )}
        </div>
        <WorldSentence
          world={sentenceOf(b, opinionDirection)}
          size="display"
          className={cn("w-full", HERO_SENTENCE)}
        />
      </section>

      {/* One grid: the events and the trade side by side, the stock across both under them, then
          who's in and what happened. The trade comes first on a phone. */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <aside className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1">
          {opinionDirection && !decided && (
            <Segmented
              label="Your view"
              value={side}
              options={["Same view", "Other side"] as const}
              onChange={setSide}
              className="w-full"
            />
          )}
          {side === "Other side" && stock && (
            <p className="text-xs leading-4 text-muted-foreground">
              The same events, but you think {stock.symbol} ends {stock.direction}{" "}
              {strikeText(stock.strike)}.
            </p>
          )}
          {decided ? (
            <div className="flex flex-col gap-2 rounded-xl bg-card p-5 ring-1 ring-border">
              <h2 className="text-base font-medium">This world is settled</h2>
              <p className="text-sm leading-5 text-muted-foreground">
                {b.state === "failed"
                  ? "An event went the other way, so the world didn't happen: All-in pays nothing and Money-back stakes come back in full."
                  : "Every event happened. Winning positions are paid at the close."}{" "}
                Holders redeem from{" "}
                <Link
                  href="/worlds/me"
                  className="text-brand-strong underline-offset-4 hover:underline"
                >
                  My worlds
                </Link>
                .
              </p>
            </div>
          ) : (
            <WorldTicket
              world={{ kind: "book", book: b }}
              sentence={sentence!}
              direction={direction}
              onProduct={onProduct}
              onAmounts={onAmounts}
            />
          )}
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <WorldBreakdown
            legs={b.legs.map(
              (l): BreakdownLeg => ({
                key: l.eventKey,
                question: l.venue?.question ?? "An event",
                source: l.venue?.source ?? null,
                marketId: l.venue?.marketId ?? null,
                image: null,
                url: l.venue?.url ?? "#",
                endTime: l.venue?.endTime ?? null,
                rules: rulesOf(l.eventKey),
                wantYes: l.wantYes,
                yes: (() => {
                  const q = analytics?.legs.find((x) => x.eventKey === l.eventKey)?.chance;
                  return q === undefined || q === null ? null : q / 1e6;
                })(),
                result: venueResult(l.state),
                status:
                  l.outcome === "passed"
                    ? "passed"
                    : l.outcome === "failed"
                      ? "failed"
                      : l.state === "frozen" || l.state === "resolving"
                        ? "frozen"
                        : "open",
              }),
            )}
            offer={offer && !decided && b.marks ? offer : null}
            paid={offer?.name === "Money-back" ? amounts.moneyBack : amounts.allIn}
            stock={stock}
          />
        </div>

        {stock && (
          <div className="min-w-0 lg:col-span-2">
            <StockChart
              token={listed?.token ?? null}
              symbol={stock.symbol}
              logo={listed?.logo ?? null}
              spot={
                analytics?.spot && b.feedDecimals !== null
                  ? analytics.spot / 10 ** b.feedDecimals
                  : (listed?.spot ?? null)
              }
              strike={Number(stock.strike)}
              direction={stock.direction}
              date={stock.date}
              fixingTime={b.fixingTime ? Number(b.fixingTime) : null}
              events={b.legs.map((l) => ({
                key: l.eventKey,
                question: l.venue?.question ?? "An event",
                endTime: l.outcome === null ? (l.venue?.endTime ?? null) : null,
                source: l.venue?.source ?? null,
                marketId: l.venue?.marketId ?? null,
                image: null,
              }))}
              payout={offer && !decided ? offer.payout : null}
              paid={
                offer ? (offer.name === "Money-back" ? amounts.moneyBack : amounts.allIn) : null
              }
            />
          </div>
        )}

        <div className="mt-3 grid min-w-0 items-start gap-3 md:grid-cols-2 lg:col-span-2">
          <section className="flex min-w-0 flex-col gap-3">
            <SectionTitle
              aside={holders.data && <span className="text-xs text-muted-foreground">public</span>}
            >
              Who's in
            </SectionTitle>
            <div className="rounded-xl bg-card px-4 ring-1 ring-border">
              {holders.data ? (
                <HolderList
                  holders={holders.data.holders}
                  you={you}
                  direction={opinionDirection}
                  decided={decided}
                />
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  {holders.error ? "Unavailable right now." : "Loading…"}
                </p>
              )}
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-3">
            <SectionTitle>Activity</SectionTitle>
            <div className="rounded-xl bg-card px-4 py-2 ring-1 ring-border">
              {fills.data ? (
                <ActivityList fills={fills.data} vaults={vaults} />
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  {fills.error ? "Unavailable right now." : "Loading…"}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A world's sentence from its book: its legs' venue wording and its opinion's stock. */
export function sentenceOf(b: BookView, direction: "above" | "below" | null) {
  const o = b.opinion;
  return {
    legs: b.legs.map((l) => ({
      label: legLabel(l.venue?.question ?? "An event"),
      wantYes: l.wantYes,
    })),
    stock:
      o?.symbol && o.strike && o.fixingDate && direction
        ? { symbol: o.symbol, direction, strike: o.strike, date: o.fixingDate }
        : null,
  };
}
