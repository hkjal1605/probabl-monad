import { Page } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";

/** The world page's shape while it loads. */
export function WorldDetailSkeleton({ bare = false }: { bare?: boolean }) {
  const body = (
    <div className="flex flex-col gap-8 pt-6 sm:pt-10" data-slot="skeleton">
      <Skeleton className="h-4 w-48" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-11/12 rounded-lg" />
        <Skeleton className="h-10 w-2/3 rounded-lg" />
      </div>
      {/* The page's grid: the events beside the trade, the stock chart across both. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Skeleton className="h-[30rem] rounded-xl lg:col-start-2 lg:row-start-1" />
        <Skeleton className="h-80 rounded-xl lg:col-start-1 lg:row-start-1" />
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
      </div>
    </div>
  );
  return bare ? body : <Page className="max-w-[1180px] px-4 pb-16 sm:px-6">{body}</Page>;
}
