"use client";
import { useState } from "react";
import { useMemberAccount, useWallet } from "@/components/providers/WalletProvider";
import { SectionTitle } from "@/components/worlds/primitives";
import { useSecond } from "@/hooks/useRfqOrder";
import { useWorldBoard } from "@/hooks/useWorldBoard";
import { cn } from "@/lib/utils";
import { OpenOrders } from "./OpenOrders";
import { OrderSheet } from "./OrderSheet";
import { TradeHistory } from "./TradeHistory";

/** The Explore page: the orders out for quotes, which anyone can take the other side of, and
 * under them every world trade. One stream keeps both current. */
export function Explore() {
  const board = useWorldBoard();
  const wallet = useWallet();
  const member = useMemberAccount();
  // A connected wallet knows its own orders and quotes, signed in or not.
  const me = member ?? wallet.account ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const open = board.rfqs.filter((r) => r.status === "open").length;
  const now = useSecond(open > 0) + board.skew;
  // The order on show stays on show after it closed and left the board.
  const [kept, setKept] = useState<(typeof board.rfqs)[number] | null>(null);
  const current = selected ? (board.rfqs.find((r) => r.id === selected) ?? null) : null;
  if (current && current !== kept) setKept(current);
  const shown = selected ? (current ?? (kept?.id === selected ? kept : null)) : null;

  return (
    <div className="flex flex-col gap-12 pt-2 sm:pt-4">
      <h1 className="sr-only">Explore</h1>

      <section className="flex flex-col gap-4" aria-labelledby="open-orders">
        <SectionTitle
          aside={
            <span
              className="flex items-center gap-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <span className="relative flex size-2 shrink-0" aria-hidden>
                {board.status === "live" && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60 motion-reduce:hidden" />
                )}
                <span
                  className={cn(
                    "relative inline-flex size-2 rounded-full",
                    board.status === "live" ? "bg-positive" : "bg-muted-foreground/50",
                  )}
                />
              </span>
              {board.status === "live"
                ? open === 1
                  ? "1 open · live"
                  : `${open} open · live`
                : board.status === "offline"
                  ? "Reconnecting…"
                  : "Connecting…"}
            </span>
          }
        >
          <span id="open-orders">Open orders</span>
        </SectionTitle>
        <OpenOrders
          board={board}
          me={me}
          now={now}
          selected={selected}
          onOpen={(rfq) => setSelected(rfq.id)}
        />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="trades">
        <SectionTitle>
          <span id="trades">Trades</span>
        </SectionTitle>
        <TradeHistory live={board.trades} books={board.books} epoch={board.epoch} me={me} />
      </section>

      <OrderSheet
        rfq={shown}
        book={shown ? board.books.get(shown.book) : undefined}
        me={me}
        skew={board.skew}
        minQuoteSeconds={board.minQuoteSeconds}
        onClose={() => setSelected(null)}
        onShown={board.show}
      />
    </div>
  );
}
