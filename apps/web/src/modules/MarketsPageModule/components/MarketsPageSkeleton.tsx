import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DiscoveryFilters } from "@/stores/ui-store";
import { COLUMNS_TABLE, ColumnsHeader } from "./MarketsColumns";

const CARD_ROWS = [0, 1, 2] as const;
const FEED_CARDS = [0, 1, 2, 3, 4, 5] as const;
const MATRIX_ROWS = [0, 1, 2, 3, 4, 5] as const;
const COLUMN_EVENTS = [0, 1, 2, 3] as const;

/** The banner's shape: the featured event card (two thirds) and the most traded list. */
function FeaturedBannerSkeleton() {
  return (
    <div
      className="mb-6 grid gap-4 lg:h-[33rem] lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]"
      aria-hidden="true"
    >
      <Card variant="market" className="flex flex-col p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="size-14 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-full max-w-md" />
          </div>
          <Skeleton className="h-12 w-16 rounded-xl" />
        </div>
        <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
          <div className="flex flex-col gap-4">
            <div className="flex gap-1.5">
              <Skeleton className="h-8 w-20 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
            {CARD_ROWS.map((row) => (
              <div key={row} className="flex items-center justify-between py-1">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
          <Skeleton className="min-h-64 rounded-lg" />
        </div>
        <div className="mt-5 flex justify-between border-border border-t pt-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-36" />
        </div>
      </Card>
      <Card variant="market" className="flex flex-col gap-6 p-5 sm:p-6">
        <Skeleton className="h-6 w-32" />
        {CARD_ROWS.map((row) => (
          <div key={row} className="flex flex-col gap-3">
            <div className="flex gap-3">
              <Skeleton className="size-11 rounded-xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-9 rounded-lg" />
              <Skeleton className="h-9 rounded-lg" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function EventCardSkeleton() {
  return (
    <Card variant="market" className="min-w-0" aria-hidden="true">
      <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-12 w-16 rounded-xl" />
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="border-0 hover:bg-transparent">
              {CARD_ROWS.map((column) => (
                <TableHead key={column} className="px-2">
                  <Skeleton className="h-3 w-10" />
                </TableHead>
              ))}
              <TableHead className="px-2">
                <Skeleton className="ml-auto h-3 w-10" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CARD_ROWS.map((row) => (
              <TableRow key={row} className="border-0 hover:bg-transparent">
                <TableCell className="w-px px-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                </TableCell>
                <TableCell className="w-1/3 px-2">
                  <Skeleton className="h-7 w-full" />
                </TableCell>
                <TableCell className="w-px px-2">
                  <Skeleton className="mx-auto h-4 w-12" />
                </TableCell>
                <TableCell className="w-1/3 px-2">
                  <Skeleton className="ml-auto h-7 w-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MatrixSkeleton() {
  return (
    <Card variant="panel" aria-hidden="true">
      <Table>
        <TableHeader className="[&_tr]:border-b-0">
          <TableRow className="border-b-0 hover:bg-transparent [&_th]:py-3">
            <TableHead>
              <Skeleton className="h-4 w-16" />
            </TableHead>
            {CARD_ROWS.map((column) => (
              <TableHead key={column}>
                <Skeleton className="h-6 w-16" />
              </TableHead>
            ))}
            <TableHead>
              <Skeleton className="mx-auto h-4 w-20" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MATRIX_ROWS.map((row) => (
            <TableRow key={row} className="border-b-0 hover:bg-transparent">
              <TableCell>
                <Skeleton className="h-5 w-full max-w-72" />
              </TableCell>
              {CARD_ROWS.map((column) => (
                <TableCell key={column}>
                  <Skeleton className="h-12 min-w-24" />
                </TableCell>
              ))}
              <TableCell>
                <Skeleton className="mx-auto h-12 w-16 rounded-xl" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ColumnsSkeleton() {
  return (
    <Card variant="market" aria-hidden="true">
      <Table className={COLUMNS_TABLE}>
        <ColumnsHeader />
        <TableBody>
          {COLUMN_EVENTS.map((event) => [
            <TableRow key={event} className="hover:bg-transparent">
              <TableCell className="pl-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-md" />
                  <Skeleton className="h-4 w-full max-w-64" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell colSpan={6} />
            </TableRow>,
            ...CARD_ROWS.slice(0, 2).map((row) => (
              <TableRow key={`${event}:${row}`} className="hover:bg-transparent">
                <TableCell className="pl-[3.75rem]">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                </TableCell>
                <TableCell />
                {CARD_ROWS.map((column) => (
                  <TableCell key={column}>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                ))}
                <TableCell>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                <TableCell />
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table>
    </Card>
  );
}

export function MarketsPageSkeleton({ view }: { view: DiscoveryFilters["view"] }) {
  return (
    <div role="status" aria-label="Loading markets" aria-busy="true">
      <FeaturedBannerSkeleton />
      {view === "Feed" ? (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEED_CARDS.map((card) => (
            <EventCardSkeleton key={card} />
          ))}
        </div>
      ) : view === "Columns" ? (
        <ColumnsSkeleton />
      ) : (
        <MatrixSkeleton />
      )}
    </div>
  );
}
