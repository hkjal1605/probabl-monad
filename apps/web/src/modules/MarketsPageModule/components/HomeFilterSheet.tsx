"use client";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { type DiscoveryFilters, defaultFilters } from "@/stores/ui-store";

const STATUS = { active: "Active", resolving: "Resolution", all: "All" } as const;
const SORT = { newest: "Newest", oldest: "Oldest" } as const;
const VIEW = { Feed: "Feed", Columns: "Columns", Matrix: "Matrix" } as const;

/** One filter's choices, shown in full: a phone has room for them all in a sheet. */
function Choice<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Record<K, string>;
  value: K;
  onChange: (value: K) => void;
}) {
  const entries = Object.entries(options) as [K, string][];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Segmented
        label={label}
        options={entries.map(([, text]) => text)}
        value={options[value]}
        onChange={(text) => {
          const key = entries.find(([, option]) => option === text)?.[0];
          if (key) onChange(key);
        }}
        className="w-full [&_[data-slot=toggle-group-item]]:h-10"
      />
    </div>
  );
}

/** On a phone the category tabs take the filter row, so status, sort and view sit behind one
 * button (marked when any differs from the default) in a sheet from the bottom of the screen. */
export function HomeFilterSheet({
  filters,
  setFilters,
  events,
}: {
  filters: DiscoveryFilters;
  setFilters: (patch: Partial<DiscoveryFilters>) => void;
  /** Events the current filters show. */
  events: number;
}) {
  const changed = (["lifecycle", "sort", "view"] as const).filter(
    (key) => filters[key] !== defaultFilters[key],
  ).length;
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={changed ? `Filters, ${changed} changed` : "Filters"}
            className="relative shrink-0 md:hidden"
          />
        }
      >
        <SlidersHorizontal aria-hidden="true" />
        {changed > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 size-2 rounded-full bg-brand ring-2 ring-background"
          />
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="gap-0 rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-2">
          <Choice
            label="Status"
            options={STATUS}
            value={filters.lifecycle}
            onChange={(lifecycle) => setFilters({ lifecycle })}
          />
          <Choice
            label="Sort"
            options={SORT}
            value={filters.sort}
            onChange={(sort) => setFilters({ sort })}
          />
          <Choice
            label="View"
            options={VIEW}
            value={filters.view}
            onChange={(view) => setFilters({ view })}
          />
        </div>
        <SheetFooter className="flex-row pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            variant="outline"
            size="lg"
            disabled={!changed}
            onClick={() =>
              setFilters({
                lifecycle: defaultFilters.lifecycle,
                sort: defaultFilters.sort,
                view: defaultFilters.view,
              })
            }
          >
            Reset
          </Button>
          <SheetClose render={<Button size="lg" className="flex-1" />}>
            Show {events} {events === 1 ? "event" : "events"}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
