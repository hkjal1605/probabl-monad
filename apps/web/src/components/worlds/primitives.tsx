import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Venue } from "@/lib/worlds/types";

/** Where an event trades. */
export function VenueMark({ source, className }: { source: Venue | null; className?: string }) {
  if (!source) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", source === "kalshi" ? "bg-positive" : "bg-info")}
      />
      {source === "kalshi" ? "Kalshi" : "Polymarket"}
    </span>
  );
}

/** YES or NO: the side of an event a world needs. */
export function SideTag({ wantYes, className }: { wantYes: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide",
        wantYes ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger",
        className,
      )}
    >
      {wantYes ? "YES" : "NO"}
    </span>
  );
}

/** A label above a big number, the way the three numbers of a world read. */
export function BigNumber({
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "positive" | "muted";
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-xl font-medium leading-6 tabular-nums sm:text-2xl sm:leading-7",
          tone === "positive" && "text-positive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** One fact of a ticket: what it is, its value, and a line under it. */
export function Fact({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5",
        className,
      )}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
      {note && <dd className="col-span-2 text-xs leading-4 text-muted-foreground">{note}</dd>}
    </div>
  );
}

/** A small section title inside a world's page. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="text-base font-medium">{children}</h2>
      {aside}
    </div>
  );
}

/** A deterministic avatar for a wallet: two tones from its address. */
export function WalletDot({ address, className }: { address: string; className?: string }) {
  const hue = Number.parseInt(address.slice(2, 6), 16) % 360;
  const hue2 = (hue + 40 + (Number.parseInt(address.slice(6, 8), 16) % 80)) % 360;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-5 shrink-0 rounded-full ring-1 ring-border", className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${hue2} 70% 40%))` }}
    />
  );
}
