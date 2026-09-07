"use client";

import { Input } from "@conditional-stocks/ui-kit/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@conditional-stocks/ui-kit/select";
import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { MarketCard } from "@/components/market/MarketCard";
import type { MarketView } from "@/lib/api/types";

export function MarketsExplorer({
  markets,
  now,
}: {
  markets: MarketView[];
  now?: number | undefined;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const visible = useMemo(
    () =>
      markets.filter((market) => {
        const matches = `${market.question} ${market.ticker}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return (
          matches &&
          (filter === "all" ||
            (filter === "active" && market.lifecycle === "open") ||
            (filter === "resolving" &&
              ["frozen", "awaiting-resolution", "resolved", "redeemable"].includes(
                market.lifecycle,
              )))
        );
      }),
    [filter, markets, query],
  );
  return (
    <>
      <div className="mt-8 flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:flex-row">
        <label className="relative flex-1" htmlFor="market-search">
          <span className="sr-only">Search markets</span>
          <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input
            id="market-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search event or ticker"
            className="pl-9"
          />
        </label>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SlidersHorizontal />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active markets</SelectItem>
            <SelectItem value="resolving">Resolution</SelectItem>
            <SelectItem value="all">All lifecycle states</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {visible.length === 0 ? (
        <div className="mt-8 flex min-h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
          No markets match this view.
        </div>
      ) : (
        <div className="mt-8 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {visible.map((market) => (
            <MarketCard key={market.id} market={market} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
