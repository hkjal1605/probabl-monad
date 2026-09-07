import { Skeleton } from "@conditional-stocks/ui-kit/skeleton";
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 py-14 sm:px-8">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="mt-6 h-16 max-w-3xl" />
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-64 rounded-2xl" />
        ))}
      </div>
    </main>
  );
}
