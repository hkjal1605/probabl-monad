"use client";
import { ArrowRight, CalendarSearch, ChartLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EventSearchDialog } from "./EventSearch";
import { StockMenu } from "./StockPicker";

/** Opinions people actually hold, as they would say them: never a market we list. */
export const EXAMPLES = [
  "If the Fed cuts rates in December, NVDA closes above $200 on Dec 19",
  "Bitcoin above $120k by end of November if the government stays open",
  "If CPI comes in hot, SPY drops below $650 by Friday",
  "Trump and Xi sign a trade deal and Apple rallies 5%",
];

/** Where a world starts: what the person thinks will happen, in their own words. Never a blank
 * page: the placeholder cycles through real opinions, and a stock or an event can start it. */
export function Composer({
  initial = "",
  busy = false,
  onSubmit,
  autoFocus = false,
  className,
}: {
  initial?: string;
  busy?: boolean;
  onSubmit: (text: string) => void;
  autoFocus?: boolean;
  className?: string | undefined;
}) {
  const [text, setText] = useState(initial);
  const [example, setExample] = useState(0);
  const [searching, setSearching] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (text || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 4_000);
    return () => clearInterval(timer);
  }, [text]);
  const add = (words: string) => {
    setText((t) => {
      const base = t.trim();
      return base ? `${base}${/[,.]$/.test(base) ? "" : ","} ${words}` : words;
    });
    requestAnimationFrame(() => area.current?.focus());
  };
  const ready = text.trim().length >= 6 && !busy;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-card p-3 ring-1 ring-border transition-shadow focus-within:ring-ring/60 sm:p-4",
        className,
      )}
    >
      <Textarea
        ref={area}
        value={text}
        autoFocus={autoFocus}
        aria-label="What do you think will happen?"
        placeholder={EXAMPLES[example]}
        maxLength={600}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && ready) {
            e.preventDefault();
            onSubmit(text.trim());
          }
        }}
        className="min-h-24 resize-none border-0 bg-transparent px-1 text-lg leading-7 shadow-none placeholder:text-muted-foreground/70 sm:text-xl sm:leading-8 md:text-xl dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <StockMenu onPick={(s) => add(`${s.symbol} closes above `)}>
          <ChartLine data-icon="inline-start" />A stock
        </StockMenu>
        <Button variant="secondary" size="sm" onClick={() => setSearching(true)}>
          <CalendarSearch data-icon="inline-start" />
          An event
        </Button>
        <Button
          className="ml-auto"
          size="lg"
          disabled={!ready}
          onClick={() => onSubmit(text.trim())}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          See my odds
          {!busy && <ArrowRight data-icon="inline-end" />}
        </Button>
      </div>
      <EventSearchDialog
        open={searching}
        onOpenChange={setSearching}
        title="Start from an event"
        onPick={(e) => {
          setSearching(false);
          add(e.label.replace(/^(The|A|An) /, (m) => m.toLowerCase()));
        }}
      />
    </div>
  );
}
