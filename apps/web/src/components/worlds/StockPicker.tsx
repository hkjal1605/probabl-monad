"use client";
import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useInSheet } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useStocks } from "@/hooks/useWorlds";
import { cn } from "@/lib/utils";
import { stockPrice } from "@/lib/worlds/format";
import type { Stock } from "@/lib/worlds/types";

/** The stocks a world can fix on, searchable, with spot. In a bottom sheet the list fills it
 * (scrolling clear of the keyboard) and the field waits for a tap. */
export function StockList({
  onPick,
  selected,
}: {
  onPick: (s: Stock) => void;
  selected?: string | null;
}) {
  const stocks = useStocks();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (stocks.data ?? []).filter(
      (s) => !term || s.symbol.toLowerCase().includes(term) || s.name.toLowerCase().includes(term),
    );
  }, [stocks.data, q]);
  const sheet = useInSheet();
  return (
    <div className={cn("flex flex-col gap-2", sheet && "min-h-0 flex-1 gap-3")}>
      <div className="relative shrink-0">
        <Search
          className={cn(
            "pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground",
            sheet ? "left-3.5" : "left-2.5",
          )}
        />
        <Input
          type="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="NVDA, Bitcoin, SPY…"
          aria-label="Find a stock"
          className={cn(
            "[&::-webkit-search-cancel-button]:hidden",
            sheet ? "h-11 rounded-full pl-10 text-base" : "pl-8",
          )}
        />
      </div>
      <div
        className={cn(
          "-mx-1 flex flex-col overflow-y-auto overscroll-contain",
          sheet ? "min-h-0 flex-1 touch-auto pb-[var(--drawer-keyboard-inset,0px)]" : "max-h-72",
        )}
      >
        {stocks.loading &&
          Array.from({ length: 5 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
            <Skeleton key={i} className="mx-1 my-1 h-9" />
          ))}
        {stocks.error && (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            Stocks are unavailable right now.
          </p>
        )}
        {!stocks.loading && !stocks.error && !list.length && (
          <p className="px-2 py-3 text-sm text-muted-foreground">No stock matches “{q}”.</p>
        )}
        {list.map((s) => (
          <Button
            key={s.underlying}
            variant="ghost"
            className={cn(
              "justify-between gap-3 px-2 data-[selected=true]:bg-accent",
              sheet ? "h-14 shrink-0 rounded-xl" : "h-11",
            )}
            data-selected={selected === s.underlying}
            onClick={() => onPick(s)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              {s.logo ? (
                // biome-ignore lint/performance/noImgElement: small static token logos.
                <img
                  src={s.logo}
                  alt=""
                  className={cn("shrink-0 rounded-full", sheet ? "size-8" : "size-6")}
                />
              ) : (
                <span
                  className={cn("shrink-0 rounded-full bg-secondary", sheet ? "size-8" : "size-6")}
                />
              )}
              <span className="flex min-w-0 flex-col items-start leading-4">
                <span className="text-sm font-medium">{s.symbol}</span>
                <span className="truncate text-xs text-muted-foreground">{s.name}</span>
              </span>
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">{stockPrice(s.spot)}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A button that opens the stock list (under it, or as a bottom sheet on a phone). */
export function StockMenu({
  onPick,
  children,
}: {
  onPick: (s: Stock) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger render={<Button variant="secondary" size="sm" />}>
        {children}
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title="Choose a stock"
        className="w-80"
        size="tall"
        keyboard
        scroll={false}
      >
        <StockList
          onPick={(s) => {
            setOpen(false);
            onPick(s);
          }}
        />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
