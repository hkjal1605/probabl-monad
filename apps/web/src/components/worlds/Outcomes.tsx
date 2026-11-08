import { cn } from "@/lib/utils";

/** How likely something is, as a length: a thin track with `share` (0 to 1) filled in `tone`. A
 * chance above nothing always shows a sliver. */
export function ChanceBar({
  share,
  tone,
  className,
}: {
  share: number;
  tone: string;
  className?: string | undefined;
}) {
  const width = share > 0 ? Math.min(100, Math.max(1, share * 100)) : 0;
  return (
    <div className={cn("h-1.5 flex-1 overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
