"use client";
import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useStocks } from "@/hooks/useWorlds";
import { stockPrice } from "@/lib/worlds/format";
import type { Stock } from "@/lib/worlds/types";

/** The stocks a world can fix on, searchable, with spot. */
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
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="NVDA, Bitcoin, SPY…"
          aria-label="Find a stock"
          className="pl-8"
        />
      </div>
      <div className="-mx-1 flex max-h-72 flex-col overflow-y-auto">
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
            className="h-11 justify-between gap-3 px-2 data-[selected=true]:bg-accent"
            data-selected={selected === s.underlying}
            onClick={() => onPick(s)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              {s.logo ? (
                // biome-ignore lint/performance/noImgElement: small static token logos.
                <img src={s.logo} alt="" className="size-6 shrink-0 rounded-full" />
              ) : (
                <span className="size-6 shrink-0 rounded-full bg-secondary" />
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

/** A button that opens the stock list. */
export function StockMenu({
  onPick,
  children,
}: {
  onPick: (s: Stock) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="secondary" size="sm" />}>{children}</PopoverTrigger>
      <PopoverContent className="w-80">
        <StockList
          onPick={(s) => {
            setOpen(false);
            onPick(s);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
