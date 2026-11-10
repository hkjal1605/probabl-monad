import { cn } from "@/lib/utils";
import type { ProductName } from "@/lib/worlds/offer";
import { clock, urgency } from "./QuoteBoard";

/** An order's figure under its small label, as the order cards set them side by side. */
export function Stat({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Which of the two bets an order is. */
export function ProductTag({ product }: { product: ProductName }) {
  return (
    <span
      className={cn(
        "w-fit rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        product === "Money-back" ? "bg-info-soft text-info" : "bg-brand-soft text-brand-strong",
      )}
    >
      {product}
    </span>
  );
}

/** How long an open order has left: the time, and a line that drains with it (`share` of its
 * life left). */
export function Countdown({ left, share }: { left: number; share: number }) {
  return (
    <div className="flex w-16 flex-col gap-1.5">
      <span
        className={cn(
          "text-sm font-medium tabular-nums",
          left <= 60_000 ? urgency(left) : "text-foreground",
        )}
      >
        {clock(left)}
      </span>
      <span className="h-0.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-1000 ease-linear",
            left <= 60_000 ? "bg-warning" : "bg-foreground/40",
          )}
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
    </div>
  );
}
