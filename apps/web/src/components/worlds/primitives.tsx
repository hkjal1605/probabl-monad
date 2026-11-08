import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarLazyImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { eventImage } from "@/lib/worlds/images";
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
      <h2 className="text-lg font-medium">{children}</h2>
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

/** An event's picture, the way the markets list shows one: the venue's artwork in a rounded
 * square, its venue's initial while it loads or when there is none. */
export function EventThumb({
  event,
  className,
}: {
  event: { source: Venue | null; marketId?: string | null; image?: string | null };
  className?: string | undefined;
}) {
  const src = eventImage(event);
  return (
    <Avatar className={cn("size-12 shrink-0 rounded-xl after:rounded-xl", className)}>
      {src && (
        <AvatarLazyImage src={src} alt="" referrerPolicy="no-referrer" className="rounded-xl" />
      )}
      <AvatarFallback className="rounded-xl text-xs font-semibold">
        {event.source === "kalshi" ? "K" : event.source === "polymarket" ? "P" : "?"}
      </AvatarFallback>
    </Avatar>
  );
}

/** Which way a world needs an event to go, as a small switch with both answers in view: the
 * chosen one slides under its label, green for Yes, red for No. */
export function SideSwitch({
  wantYes,
  onChange,
  className,
}: {
  wantYes: boolean;
  onChange: (wantYes: boolean) => void;
  className?: string | undefined;
}) {
  const side = (yes: boolean) => (
    <button
      type="button"
      aria-pressed={wantYes === yes}
      onClick={() => onChange(yes)}
      className={cn(
        "relative z-10 flex h-6 items-center justify-center rounded-full px-2.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        wantYes === yes
          ? yes
            ? "text-positive"
            : "text-danger"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {yes ? "Yes" : "No"}
    </button>
  );
  return (
    <fieldset
      className={cn(
        "relative grid shrink-0 grid-cols-2 rounded-full bg-secondary p-0.5",
        className,
      )}
    >
      <legend className="sr-only">The way this event has to go</legend>
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full transition-[translate,background-color] duration-200 ease-out motion-reduce:transition-none",
          wantYes ? "translate-x-0 bg-positive-soft" : "translate-x-full bg-danger-soft",
        )}
      />
      {side(true)}
      {side(false)}
    </fieldset>
  );
}
