"use client";
import { ArrowLeftRight, ChartLine } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LifecycleBadge } from "@/components/data/StatusBadge";
import { PriceChart } from "@/components/market/PriceChart";
import { ProbabilityGauge } from "@/components/market/ProbabilityGauge";
import { SpotReference } from "@/components/market/SpotReference";
import { TokenIdentity } from "@/components/market/TokenIdentity";
import { ClaimTable } from "@/components/portfolio/ClaimTable";
import { OrderTable } from "@/components/portfolio/OrderTable";
import { PositionTable } from "@/components/portfolio/PositionTable";
import { WalletTradeTable } from "@/components/portfolio/WalletTradeTable";
import { useUiStore } from "@/components/providers/UiStateProvider";
import { useMemberAccount } from "@/components/providers/WalletProvider";
import { Avatar, AvatarFallback, AvatarLazyImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  LineTabsList as TabsList,
  LineTabsTrigger as TabsTrigger,
} from "@/components/ui/line-tabs";
import { DataError, EmptyState, Page, Stat } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useProbabilityStream } from "@/hooks/useProbabilityStream";
import { useMarkets } from "@/hooks/useProtocolData";
import { formatNumber, formatTime } from "@/lib/format/display";
import { marketPath, publicIdOf } from "@/lib/markets/identity";
import { midpoint, percent, spotImpactPercent } from "@/lib/markets/presentation";
import { type DepthLevel, depthLevels, visibleDepthPerSide } from "@/lib/markets/visible-depth";
import { cn } from "@/lib/utils";
import { marketsStore } from "@/stores/useMarketsStore";
import type { BranchBook, MarketView } from "@/types/api";
import { MarketAssetSwitcher } from "./MarketAssetSwitcher";
import { MarketDetailPageSkeleton } from "./MarketDetailPageSkeleton";
import { MarketRulesDialog } from "./MarketRulesDialog";
import { OrderTicket } from "./OrderTicket";
import { QuotePauseNotice } from "./QuotePauseNotice";

const EMPTY_PROBABILITY: MarketView["probability"] = {
  ask: null,
  bid: null,
  observedAt: null,
  quality: "disconnected",
  value: null,
};
type WorkspaceView = "chart" | "trade";
/** Where the workspace is one column (global.css): the chart and ticket views, no book. */
const PHONE = "(max-width: 899px)";
function OutcomeStat({ market, branch }: { market: MarketView; branch: "YES" | "NO" }) {
  const impact = spotImpactPercent(market, branch);
  return (
    <Stat
      variant="market"
      label={`${market.ticker}-${branch}`}
      value={
        <span className="flex items-baseline gap-1.5">
          <span>{formatNumber(midpoint(branch === "YES" ? market.yes : market.no))}</span>
          <span
            title={
              impact === null ? "Spot comparison unavailable" : `${percent(impact)} versus spot`
            }
            className={cn(
              "text-xs",
              impact === null || impact === 0
                ? "text-muted-foreground"
                : impact > 0
                  ? "text-positive"
                  : "text-destructive",
            )}
          >
            {percent(impact)}
          </span>
        </span>
      }
    />
  );
}

export function MarketWorkspace({
  marketId,
  initialMarkets = [],
}: {
  marketId: string;
  initialMarkets?: MarketView[];
}) {
  // The segment is a slug or public id; an older numeric link is resolved by the API, which
  // answers with that one market.
  const publicId = publicIdOf(marketId);
  // Reads are keyed by the public id, as the index stream names markets, so its frames refresh
  // them. The page starts from the market list the header already read, and its own read
  // refreshes that, so a market opens without a skeleton.
  const key = publicId ?? marketId;
  const [seed] = useState(() =>
    (initialMarkets.length ? initialMarkets : (marketsStore.get("all").data?.markets ?? [])).filter(
      (m) => m.id === publicId,
    ),
  );
  const query = useMarkets(seed, key);
  const indexedMarket = publicId
    ? query.markets.find((m) => m.id === publicId)
    : query.markets.length === 1
      ? query.markets[0]
      : undefined;
  const router = useRouter();
  const canonical = indexedMarket ? marketPath(indexedMarket) : null;
  useEffect(() => {
    if (canonical && canonical !== `/markets/${marketId}`) router.replace(canonical);
  }, [canonical, marketId, router]);
  const stream = useProbabilityStream(
    indexedMarket?.mapping.conditionId ?? "",
    indexedMarket?.probability ?? EMPTY_PROBABILITY,
  );
  const market = useMemo(
    () => (indexedMarket ? { ...indexedMarket, probability: stream.probability } : undefined),
    [indexedMarket, stream.probability],
  );
  const [tab, setTab] = useState("positions"),
    [bookBranch, setBookBranch] = useState<"YES" | "NO">("YES");
  // On a phone the chart and the ticket are two views of one slot (the book is left out). Each
  // switch brings the view into sight, as the account tables below can be scrolled to.
  const [view, setView] = useState<{ name: WorkspaceView; at: number }>({ name: "chart", at: 0 });
  const chartRef = useRef<HTMLDivElement>(null),
    ticketRef = useRef<HTMLDivElement>(null);
  const showView = (name: WorkspaceView) => setView({ name, at: Date.now() });
  useEffect(() => {
    if (view.at)
      (view.name === "trade" ? ticketRef : chartRef).current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  }, [view]);
  // A trade handed to this market's ticket (a position's Close, a Buy on the markets list) opens it.
  const prefill = useUiStore((s) => s.prefill);
  useEffect(() => {
    if (prefill && prefill.marketId === indexedMarket?.id && matchMedia(PHONE).matches)
      setView({ name: "trade", at: Date.now() });
  }, [prefill, indexedMarket?.id]);
  if (!market)
    return query.isPending ? (
      <MarketDetailPageSkeleton />
    ) : (
      <Page>
        {query.isError ? (
          <DataError
            retry={() => {
              void query.refetch();
            }}
          />
        ) : (
          <EmptyState>
            Market not found in the canonical indexer.
            <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
              Explore markets
            </Button>
          </EmptyState>
        )}
      </Page>
    );
  return (
    <Page
      variant="terminal"
      className="market-workspace-scrollbars-hidden flex min-h-0 flex-col bg-secondary px-0 py-0 xl:overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 bg-background px-3 py-3">
        <div className="min-w-0 flex-[1_1_28rem]">
          <div className="flex items-center gap-3">
            <Avatar size="lg" className="rounded-xl after:rounded-xl">
              {market.imageUrl && (
                <AvatarLazyImage
                  src={market.imageUrl}
                  alt=""
                  className="rounded-xl"
                  referrerPolicy="no-referrer"
                />
              )}
              <AvatarFallback className="rounded-xl">{market.question.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="text-lg font-medium leading-6">{market.question}</h1>
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
                <span>Cutoff {formatTime(market.cutoff)}</span>
                <LifecycleBadge state={market.lifecycle} />
                <MarketRulesDialog market={market} />
              </div>
            </div>
            <ProbabilityGauge probability={market.probability} />
          </div>
        </div>
        <MarketAssetSwitcher market={market} />
      </div>
      <div
        data-view={view.name}
        className="market-workspace-grid grid min-h-0 flex-1 items-stretch gap-0.5 bg-secondary p-0.5 xl:overflow-hidden"
      >
        {/* The prices, chart, book and account tabs. From xl they scroll together as one column
            beside the ticket (global.css); below that they are items of the grid itself. */}
        <div className="market-workspace-main gap-0.5">
          <div className="market-workspace-stats overflow-hidden rounded-[4px] bg-background">
            <div className="@container/prices flex flex-wrap items-center gap-x-6 gap-y-3 border-y px-3 py-3">
              <OutcomeStat market={market} branch="YES" />
              <SpotReference price={market.spotReference} variant="market" />
              <OutcomeStat market={market} branch="NO" />
              <BaseToken market={market} />
            </div>
            <QuotePauseNotice market={market} />
            {market.bookQuality === "truncated" && (
              <DataError
                message={
                  "Book display limit reached. Best-price and depth indicators are withheld; the API still reviews against its full candidate book."
                }
              />
            )}
          </div>
          <div
            ref={chartRef}
            className="market-workspace-chart min-h-0 min-w-0 scroll-mb-16 overflow-hidden rounded-[4px]"
          >
            <PriceChart market={market} />
          </div>
          <Card
            variant="panel"
            className="market-workspace-book min-h-0 min-w-0 data-[variant=panel]:rounded-[4px]"
          >
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Order book outcome"
                variant="chart"
                options={[`${market.ticker}-YES`, `${market.ticker}-NO`]}
                value={`${market.ticker}-${bookBranch}`}
                onChange={(value) => setBookBranch(value === `${market.ticker}-YES` ? "YES" : "NO")}
              />
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-0">
              <BranchDepth
                book={bookBranch === "YES" ? market.yes : market.no}
                label={`${market.ticker}-${bookBranch}`}
                available={market.bookQuality === "available"}
              />
            </CardContent>
          </Card>
          <Card
            variant="panel"
            className="market-workspace-information min-h-0 min-w-0 overflow-hidden data-[variant=panel]:rounded-[4px]"
          >
            <Tabs value={tab} onValueChange={setTab} className="flex-1 gap-0">
              <TabsList aria-label="Market information">
                {[
                  ["positions", "Positions"],
                  ["orders", "Orders"],
                  ["claims", "Claims"],
                  ["trades", "Trades"],
                ].map(
                  ([value, label]) =>
                    value && (
                      <TabsTrigger key={value} value={value}>
                        {label}
                      </TabsTrigger>
                    ),
                )}
              </TabsList>
              <TabsContent value="positions">
                <AccountMarkets market={market}>
                  {(markets) => <PositionTable markets={markets} currentMarketId={market.id} />}
                </AccountMarkets>
              </TabsContent>
              <TabsContent value="orders">
                <AccountMarkets market={market}>
                  {(markets) => <OrderTable markets={markets} currentMarketId={market.id} />}
                </AccountMarkets>
              </TabsContent>
              <TabsContent value="claims">
                <AccountMarkets market={market}>
                  {(markets) => <ClaimTable markets={markets} currentMarketId={market.id} />}
                </AccountMarkets>
              </TabsContent>
              <TabsContent value="trades">
                <AccountMarkets market={market}>
                  {(markets) => <WalletTradeTable markets={markets} currentMarketId={market.id} />}
                </AccountMarkets>
              </TabsContent>
            </Tabs>
          </Card>
        </div>
        <div
          ref={ticketRef}
          className="market-workspace-ticket min-h-0 min-w-0 scroll-mb-16 rounded-[4px] bg-card xl:overflow-y-auto xl:overscroll-contain"
        >
          <OrderTicket key={market.id} market={market} />
        </div>
      </div>
      <nav
        aria-label="Market view"
        className="market-view-bar fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t bg-background pb-[env(safe-area-inset-bottom)] min-[900px]:hidden"
      >
        {(
          [
            ["chart", "Chart", ChartLine],
            ["trade", "Trade", ArrowLeftRight],
          ] as const
        ).map(([name, label, Icon]) => (
          <Button
            key={name}
            variant="ghost"
            aria-pressed={view.name === name}
            onClick={() => showView(name)}
            className={cn(
              "h-14 gap-2 rounded-none hover:bg-transparent focus-visible:border-transparent focus-visible:bg-accent focus-visible:ring-0 dark:hover:bg-transparent",
              view.name === name
                ? "text-brand-strong hover:text-brand-strong"
                : "text-muted-foreground hover:text-muted-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4.5" />
            {label}
          </Button>
        ))}
      </nav>
    </Page>
  );
}
/** The markets the account tabs show: every market for a member, this page's own live read in
 * place of its list entry. The list is the one the header reads for members, so this adds no
 * request; anyone else gets this market alone (and the tabs' sign-in prompts). */
function AccountMarkets({
  market,
  children,
}: {
  market: MarketView;
  children: (markets: MarketView[]) => ReactNode;
}) {
  return useMemberAccount() ? (
    <MemberMarkets market={market}>{children}</MemberMarkets>
  ) : (
    children([market])
  );
}
function MemberMarkets({
  market,
  children,
}: {
  market: MarketView;
  children: (markets: MarketView[]) => ReactNode;
}) {
  const catalogue = useMarkets().markets;
  const markets = useMemo(
    () => [market, ...catalogue.filter((m) => m.id !== market.id)],
    [market, catalogue],
  );
  return children(markets);
}
function BranchDepth({
  book,
  label,
  available,
}: {
  book: BranchBook;
  label: string;
  available: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleLevels, setVisibleLevels] = useState(5);
  /** The height below the column headers and of one row, once measured. */
  const [space, setSpace] = useState<{ body: number; row: number } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const header = container.querySelector<HTMLElement>("thead")?.getBoundingClientRect().height;
      const midpointRow = container
        .querySelector<HTMLElement>("[data-depth-midpoint]")
        ?.getBoundingClientRect().height;
      if (!header || !midpointRow || container.clientHeight <= 0) return;
      const next = visibleDepthPerSide(container.clientHeight, header, midpointRow);
      setVisibleLevels((current) => (current === next ? current : next));
      const body = container.clientHeight - header;
      setSpace((current) =>
        current?.body === body && current.row === midpointRow
          ? current
          : { body, row: midpointRow },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const asks = depthLevels(book.asks, visibleLevels);
  const bids = depthLevels(book.bids, visibleLevels);
  const mid = midpoint(book);
  const spread = book.spread;
  const askTotal = asks.at(-1)?.cumulative ?? 0;
  const bidTotal = bids.at(-1)?.cumulative ?? 0;
  const row = (level: DepthLevel, ask: boolean, total: number) => (
    <TableRow
      key={level.priceExact}
      className={cn("tabular-nums", ask ? "text-danger" : "text-positive")}
      style={{
        backgroundImage: `linear-gradient(to left, var(--${ask ? "danger" : "positive"}-soft) ${total > 0 ? (level.cumulative / total) * 100 : 0}%, transparent ${total > 0 ? (level.cumulative / total) * 100 : 0}%)`,
      }}
    >
      <TableCell className="text-sm">{formatNumber(level.price)}</TableCell>
      <TableCell className="text-right text-sm">{formatNumber(level.quantity, 2)}</TableCell>
      <TableCell className="text-right text-sm">{formatNumber(level.cumulative, 2)}</TableCell>
    </TableRow>
  );
  const columns = 3;
  // The headers stay on top and the midpoint in the middle of the rows below them: the space
  // a side's levels leave is filled above the asks and below the bids. Each side shows at most
  // `visibleLevels` rows, which fit in half that space, so the book always fills its height.
  const half = space ? (space.body - space.row) / 2 : 0;
  const fill = (rows: number, side: "asks" | "bids") => {
    const height = space ? half - rows * space.row : 0;
    return height > 0 ? (
      <tr key={`${side}-fill`} role="presentation">
        <td colSpan={columns} style={{ height, padding: 0 }} />
      </tr>
    ) : null;
  };
  /** An empty side shows the RFQ makers' price for a $100 order, which a market order fills at. */
  const emptyRow = (ask: boolean) => {
    const quoted = ask ? book.quote?.ask : book.quote?.bid;
    return (
      <TableRow
        key={`${ask ? "ask" : "bid"}-empty`}
        className={quoted ? cn("tabular-nums", ask ? "text-danger" : "text-positive") : undefined}
      >
        <TableCell colSpan={columns} className={quoted ? "text-sm" : "text-muted-foreground"}>
          {quoted ? (
            <>
              {formatNumber(Number(quoted))}
              <span className="ml-2 text-xs text-muted-foreground">vault quote · $100</span>
            </>
          ) : available ? (
            `No ${ask ? "asks" : "bids"}`
          ) : (
            "—"
          )}
        </TableCell>
      </TableRow>
    );
  };
  return (
    <div
      ref={containerRef}
      // Below xl the book's grid row sizes to its content: it keeps room for five levels a side.
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden max-xl:min-h-84"
    >
      <Table aria-label={label} density="compact">
        <TableHeader className="[&_tr]:border-b-0">
          <TableRow className="hover:bg-transparent [&_th]:font-medium">
            <TableHead>Price</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr]:border-b-0">
          {fill(Math.max(asks.length, 1), "asks")}
          {asks.length === 0 && emptyRow(true)}
          {[...asks].reverse().map((level) => row(level, true, askTotal))}
          <TableRow data-depth-midpoint>
            <TableCell colSpan={columns}>
              <strong className="text-sm tabular-nums">{formatNumber(mid)}</strong>
              <span className="ml-2 text-xs text-muted-foreground">
                spr <span className="text-sm">{formatNumber(spread)}</span>
              </span>
            </TableCell>
          </TableRow>
          {bids.map((level) => row(level, false, bidTotal))}
          {bids.length === 0 && emptyRow(false)}
          {fill(Math.max(bids.length, 1), "bids")}
        </TableBody>
      </Table>
    </div>
  );
}

/** The market's stock token with its issuer's live UI multiplier and pause state: at the
 * right end of the prices row when it is wide enough, else on its own line below. */
function BaseToken({ market }: { market: MarketView }) {
  const { live } = market.base;
  return (
    <section
      aria-label="Stock token"
      className="flex min-w-0 basis-full flex-wrap items-center justify-start gap-2 @2xl/prices:min-w-64 @2xl/prices:flex-1 @2xl/prices:basis-0 @2xl/prices:justify-end"
    >
      <span className="flex shrink-0 items-center gap-2 rounded-md bg-secondary px-2 py-1 text-xs">
        <TokenIdentity
          symbol={market.base.symbol}
          metadata={market.base.metadata}
          showName={false}
          iconSize="sm"
        />
        {live.multiplierValue !== 1 && (
          <span
            className="tabular-nums text-muted-foreground"
            title="Economic shares per token (issuer UI multiplier)"
          >
            ×{live.multiplierValue.toFixed(4)}
          </span>
        )}
        {!live.tradable && (
          <Badge variant="warning" title="The issuer has paused transfers of this token">
            Paused
          </Badge>
        )}
      </span>
    </section>
  );
}
