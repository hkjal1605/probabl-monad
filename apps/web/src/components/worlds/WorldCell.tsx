import { ArrowDownRight, ArrowUpRight, CalendarCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderWorld } from "@/lib/worlds/board";
import { calendarDay, strikeText } from "@/lib/worlds/format";
import { SideTag } from "./primitives";

/** A world in the two lines a table row has room for: what it bets on (the stock, the way it
 * must move, the price and the day; or how many events it is), then the first event it needs
 * and how many more there are. The whole sentence is the row's detail view; hovering says it
 * too. */
export function WorldCell({
  world,
  className,
}: {
  world: OrderWorld | null;
  className?: string | undefined;
}) {
  if (!world)
    return (
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <span className="h-4 w-40 rounded bg-secondary" />
        <span className="h-3.5 w-56 max-w-full rounded bg-secondary/70" />
      </div>
    );
  const { stock, legs } = world;
  const first = legs[0];
  const more = legs.length - 1;
  const said = [
    stock
      ? `${stock.symbol} closes ${stock.direction} ${strikeText(stock.strike)} on ${calendarDay(stock.date)}`
      : null,
    ...legs.map((l) => `${l.wantYes ? "YES" : "NO"}: ${l.label}`),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} title={said}>
      {stock ? (
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium tabular-nums">
          <span className="rounded-md bg-info-soft px-1.5 py-0.5 text-info">{stock.symbol}</span>
          <span
            className={cn(
              "flex items-center gap-0.5",
              stock.direction === "above" ? "text-positive" : "text-danger",
            )}
          >
            {stock.direction === "above" ? (
              <ArrowUpRight className="size-4" aria-hidden />
            ) : (
              <ArrowDownRight className="size-4" aria-hidden />
            )}
            {stock.direction}
          </span>
          <span>{strikeText(stock.strike)}</span>
          <span className="truncate font-normal text-muted-foreground">
            · {calendarDay(stock.date)}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />
          {legs.length === 1 ? "One event happens" : `${legs.length} events all happen`}
        </span>
      )}
      {first && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {stock && <span className="shrink-0">if</span>}
          <SideTag wantYes={first.wantYes} className="h-4 px-1 text-[10px]" />
          <span className="min-w-0 truncate">{first.label}</span>
          {more > 0 && (
            <span className="shrink-0 rounded-full bg-secondary px-1.5 py-px text-[11px] font-medium text-foreground">
              +{more} more
            </span>
          )}
        </span>
      )}
    </div>
  );
}
