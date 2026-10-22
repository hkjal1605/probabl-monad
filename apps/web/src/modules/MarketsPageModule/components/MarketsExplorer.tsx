"use client";
import { CalendarDays } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { EventCard } from "@/components/market/EventCard";
import { ProbabilityGauge } from "@/components/market/ProbabilityGauge";
import { TokenIdentity } from "@/components/market/TokenIdentity";
import { useUiStore } from "@/components/providers/UiStateProvider";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Masonry } from "@/components/ui/masonry";
import { DataError, EmptyState, Page } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMarkets } from "@/hooks/useProtocolData";
import { formatNumber } from "@/lib/format/display";
import { loadChunk } from "@/lib/load-chunk";
import {
  CALENDAR_TAB,
  inMarketTab,
  type MarketTab,
  marketTabFromPathname,
  marketTabPath,
  marketTopic,
  visibleTabs,
} from "@/lib/markets/categories";
import { marketPath } from "@/lib/markets/identity";
import {
  eventKey,
  groupMarkets,
  impactPercent,
  marketAssetKey,
  midpoint,
  percent,
  sortEventGroups,
} from "@/lib/markets/presentation";
import { withoutUnpricedMarkets } from "@/lib/markets/quote-pause";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";
import { HomeBanner } from "./HomeBanner";
import { MarketsColumns } from "./MarketsColumns";
import { MarketsPageSkeleton } from "./MarketsPageSkeleton";
import { MarketsToolbar } from "./MarketsToolbar";

// The calendar's own code loads only when it is opened.
const EventCalendar = dynamic(
  () => loadChunk(() => import("./EventCalendar").then((m) => m.EventCalendar)),
  {
    ssr: false,
  },
);

/** The matrix's event and probability columns stay in view while the asset columns between them
 * scroll sideways. They are opaque, so they take the row's hover colour too. */
const MATRIX_PINNED = "sticky z-10 bg-background transition-colors [tr:hover>&]:bg-accent";

export function MarketsExplorer({
  markets: initial,
  now: _now,
  category: routeCategory,
}: {
  markets: MarketView[];
  now?: number;
  category: MarketTab;
}) {
  const pathname = usePathname(),
    query = useMarkets(initial),
    markets = query.markets;
  const filters = useUiStore((s) => s.filters),
    setFilters = useUiStore((s) => s.setFilters);
  const pathnameCategory = marketTabFromPathname(pathname) ?? routeCategory;
  const [category, setCategory] = useState(pathnameCategory);
  useLayoutEffect(() => {
    setCategory(pathnameCategory);
    setFilters({ category: pathnameCategory });
  }, [pathnameCategory, setFilters]);
  const filtersRef = useRef<HTMLElement>(null),
    tabsRef = useRef<HTMLDivElement>(null),
    listRef = useRef<HTMLDivElement>(null);
  // The filters stick under the header and testnet banner, whose height varies (the banner wraps,
  // and comes and goes; a phone pins the header alone); what sticks or is scrolled to below the
  // filters goes under both.
  useLayoutEffect(() => {
    const chrome = document.querySelector<HTMLElement>("[data-site-chrome]"),
      header = chrome?.querySelector("header"),
      bar = filtersRef.current;
    if (!chrome || !header || !bar) return;
    const style = document.documentElement.style;
    const measure = () => {
      const pinned =
        getComputedStyle(chrome).display === "contents" ? header.offsetHeight : chrome.offsetHeight;
      style.setProperty("--home-chrome", `${pinned}px`);
      style.setProperty("--home-sticky", `${pinned + bar.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [chrome, header, bar]) observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      style.removeProperty("--home-chrome");
      style.removeProperty("--home-sticky");
    };
  }, []);
  /** A new category's markets show from their start, the filters staying where they are. */
  const showFromStart = () => {
    const list = listRef.current,
      bar = filtersRef.current;
    if (!list || !bar) return;
    const top =
      list.getBoundingClientRect().top + window.scrollY - bar.getBoundingClientRect().bottom;
    if (window.scrollY > top) window.scrollTo({ top });
  };
  // Recomputed only when the markets or the filters change, so the event groups (and the cards
  // they feed) keep their identity across unrelated renders.
  const { listed, visible, tokens, tabs } = useMemo(() => {
    // Markets the vaults stopped quoting as their event is all but decided are left out, and
    // active events never list frozen (halted or delisted) sibling markets.
    const priced = withoutUnpricedMarkets(markets);
    const listed =
      filters.lifecycle === "active" ? priced.filter((m) => m.lifecycle !== "frozen") : priced;
    const visible = sortEventGroups(
      groupMarkets(listed).filter((assets) =>
        assets.some(
          (m) =>
            inMarketTab(m, category) &&
            (filters.lifecycle === "all" ||
              (filters.lifecycle === "active" ? m.lifecycle === "open" : m.lifecycle !== "open")),
        ),
      ),
      filters.sort,
    );
    // Asset identity (the stock), not a token address or a potentially shared display symbol,
    // determines matrix columns: one per stock among the events shown.
    const tokens = [...new Map(visible.flat().map((m) => [marketAssetKey(m), m])).values()].sort(
      (a, b) => a.ticker.localeCompare(b.ticker),
    );
    // The fixed tabs, each topic with markets, and the calendar; the open tab always shows.
    const tabs = visibleTabs(markets);
    if (!tabs.includes(category)) tabs.splice(tabs.length - 1, 0, category);
    return { listed, visible, tokens, tabs };
  }, [markets, filters.lifecycle, filters.sort, category]);
  // The chosen category stays in sight in its scrolling row, centred where it can be so its
  // neighbours show too (a link can open one past the screen's edge). The row settles when the
  // full market list adds tabs and when the web font loads, so it centres again then.
  const tabKey = tabs.join("|");
  const centred = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new category or tab list moves the pressed tab, read from the row.
  useLayoutEffect(() => {
    const centre = (smooth: boolean) => {
      const row = tabsRef.current,
        tab = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!row || !tab) return;
      const r = row.getBoundingClientRect(),
        t = tab.getBoundingClientRect();
      row.scrollBy({
        left: t.left + t.width / 2 - (r.left + r.width / 2),
        behavior: smooth ? "smooth" : "auto",
      });
    };
    centre(centred.current && !matchMedia("(prefers-reduced-motion: reduce)").matches);
    centred.current = true;
    if (document.fonts.status !== "loaded") void document.fonts.ready.then(() => centre(false));
  }, [category, tabKey]);
  const calendar = category === CALENDAR_TAB;
  const showSkeleton = query.isPending && markets.length === 0;
  return (
    <Page
      variant="terminal"
      className="page-scrollbars-hidden markets-viewport flex max-w-[1350px] flex-col px-4 py-0 lg:px-6"
    >
      <section
        ref={filtersRef}
        aria-label="Market categories"
        className="sticky top-(--home-chrome) z-30 -mx-4 flex min-h-16 shrink-0 items-center bg-background px-4 py-4 max-md:min-h-0 max-md:border-b max-md:py-0 lg:-mx-6 lg:px-6"
      >
        {/* The categories have the row to themselves and scroll in it when they outgrow it. On a
            phone the row runs to the screen's edges and fades out at them. */}
        <div
          ref={tabsRef}
          className="home-category-tabs -mb-2 min-w-0 flex-1 overflow-x-auto pb-2 [scrollbar-width:none] max-md:-mx-4 max-md:mb-0 max-md:px-4 max-md:pb-0 max-md:[mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)]"
        >
          <Segmented
            label="Market category"
            variant="category"
            className="shrink-0"
            value={category}
            options={tabs}
            renderOption={(tab) =>
              tab === CALENDAR_TAB ? (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays aria-hidden="true" className="size-3.5" />
                  {tab}
                </span>
              ) : (
                tab
              )
            }
            onChange={(nextCategory) => {
              showFromStart();
              setCategory(nextCategory);
              setFilters({ category: nextCategory });
              const nextPath = marketTabPath(nextCategory);
              if (window.location.pathname !== nextPath)
                window.history.pushState(null, "", nextPath);
            }}
          />
        </div>
      </section>
      {/* The categories stay put; the banner, the filters and the markets scroll under them. */}
      <div ref={listRef} className="flex-1 pb-3 max-md:pt-3">
        {calendar ? (
          <EventCalendar markets={markets} loading={showSkeleton} />
        ) : showSkeleton ? (
          <MarketsPageSkeleton view={filters.view} />
        ) : (
          <>
            {/* The selected category's first event leads; the most traded span every category. */}
            <HomeBanner featured={visible[0]} category={category} markets={listed} />
            <MarketsToolbar filters={filters} setFilters={setFilters} events={visible.length} />
            {query.isInitialError && (
              <DataError
                retry={() => {
                  void query.refetch();
                }}
              />
            )}
            {!visible.length ? (
              <EmptyState>No markets match this view. Try another filter.</EmptyState>
            ) : filters.view === "Feed" ? (
              <Masonry className="grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((assets) => (
                  <EventCard key={assets[0] ? eventKey(assets[0]) : "empty"} markets={assets} />
                ))}
              </Masonry>
            ) : filters.view === "Columns" ? (
              <MarketsColumns groups={visible} />
            ) : (
              <Card variant="panel">
                <Table>
                  <TableHeader className="[&_tr]:border-b-0">
                    <TableRow className="border-b-0 hover:bg-transparent [&_th]:py-3">
                      <TableHead
                        className={cn(
                          MATRIX_PINNED,
                          "left-0 shadow-[inset_-1px_0_0_var(--border)]",
                        )}
                      >
                        Event
                      </TableHead>
                      {tokens.map((token) => (
                        <TableHead key={marketAssetKey(token)} className="text-foreground">
                          <TokenIdentity
                            symbol={token.ticker}
                            metadata={token.assetMetadata}
                            showName={false}
                            iconSize="sm"
                          />
                        </TableHead>
                      ))}
                      <TableHead
                        className={cn(
                          MATRIX_PINNED,
                          "right-0 text-center font-medium text-foreground shadow-[inset_1px_0_0_var(--border)]",
                        )}
                      >
                        Probability
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((assets) => {
                      const market = assets[0];
                      if (!market) return null;
                      return (
                        <TableRow key={eventKey(market)} className="border-b-0">
                          <TableCell
                            className={cn(
                              MATRIX_PINNED,
                              "left-0 min-w-52 max-w-80 whitespace-normal shadow-[inset_-1px_0_0_var(--border)] max-md:min-w-36 max-md:max-w-40",
                            )}
                          >
                            <Link href={marketPath(market)} className="font-semibold">
                              {market.question}
                            </Link>
                            <p className="mt-2 text-xs font-medium text-muted-foreground">
                              {marketTopic(market)} · {market.lifecycle}
                            </p>
                          </TableCell>
                          {tokens.map((token) => {
                            const asset = assets.find(
                              (m) => marketAssetKey(m) === marketAssetKey(token),
                            );
                            const impact = asset ? impactPercent(asset) : null;
                            return (
                              <TableCell key={marketAssetKey(token)}>
                                {asset ? (
                                  <Link
                                    href={marketPath(asset)}
                                    className={cn(
                                      buttonVariants({ variant: "ghost" }),
                                      "h-auto min-w-24 flex-col gap-2 border-0 py-3",
                                      impact === null
                                        ? "bg-secondary hover:bg-secondary"
                                        : impact >= 0
                                          ? "bg-positive-soft hover:bg-positive-soft"
                                          : "bg-danger-soft hover:bg-danger-soft",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        impact === null
                                          ? "text-muted-foreground"
                                          : impact >= 0
                                            ? "text-positive"
                                            : "text-destructive",
                                      )}
                                    >
                                      {percent(impact)}
                                    </span>
                                    <span>{formatNumber(midpoint(asset.yes))}</span>
                                  </Link>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell
                            className={cn(
                              MATRIX_PINNED,
                              "right-0 shadow-[inset_1px_0_0_var(--border)] [&>[role=img]]:mx-auto",
                            )}
                          >
                            <ProbabilityGauge
                              probability={market.probability}
                              conditionId={market.mapping.conditionId}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
