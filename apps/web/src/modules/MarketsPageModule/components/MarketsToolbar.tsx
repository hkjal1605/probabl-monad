"use client";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DiscoveryFilters } from "@/stores/ui-store";
import { HomeFilterSheet } from "./HomeFilterSheet";

/** The row between the banner and the markets: which markets and in what order on the left, how
 * they are laid out on the right. A phone keeps all three behind one button. */
export function MarketsToolbar({
  filters,
  setFilters,
  events,
}: {
  filters: DiscoveryFilters;
  setFilters: (patch: Partial<DiscoveryFilters>) => void;
  /** Events the current filters show. */
  events: number;
}) {
  return (
    <section aria-label="Market filters" className="mb-3 flex items-center gap-1">
      <div className="flex items-center gap-1 max-md:hidden">
        <Select
          value={filters.lifecycle}
          items={{
            active: "Active markets",
            resolving: "Resolution",
            all: "All lifecycle states",
          }}
          onValueChange={(value) => {
            if (value === "active" || value === "resolving" || value === "all")
              setFilters({ lifecycle: value });
          }}
        >
          <SelectTrigger aria-label="Lifecycle" size="xs" variant="filter-chip">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="active">Active markets</SelectItem>
              <SelectItem value="resolving">Resolution</SelectItem>
              <SelectItem value="all">All lifecycle states</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={filters.sort}
          items={{ newest: "Newest first", oldest: "Oldest first" }}
          onValueChange={(value) => {
            if (value === "newest" || value === "oldest") setFilters({ sort: value });
          }}
        >
          <SelectTrigger aria-label="Sort markets" size="xs" variant="filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Segmented
        label="Market view"
        variant="compact"
        className="ml-auto max-md:hidden"
        value={filters.view}
        options={["Feed", "Columns", "Matrix"]}
        onChange={(view) => setFilters({ view })}
      />
      <HomeFilterSheet filters={filters} setFilters={setFilters} events={events} />
    </section>
  );
}
