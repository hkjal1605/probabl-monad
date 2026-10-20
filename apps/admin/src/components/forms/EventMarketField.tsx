"use client";

import { EVENT_SOURCE_NAMES, type EventSource } from "@conditional-stocks/market-data";
import { FileSearch, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FIELDS: Record<EventSource, { label: string; placeholder: string; help: string }> = {
  polymarket: {
    label: "Polymarket market slug",
    placeholder: "clarity-act-signed-into-law-in-2026",
    help: "Paste the individual market's slug, not a full URL; an event with several markets has one per outcome.",
  },
  kalshi: {
    label: "Kalshi market ticker",
    placeholder: "KXFEDDECISION-26DEC-H25",
    help: "Paste the market's ticker (one strike or outcome), not the event's or the series'.",
  },
};

/** The venue market a form works on: a Polymarket slug or a Kalshi ticker, and its fetch.
 * Without `onSourceChange` the venue is fixed (it comes from an existing market). */
export function EventMarketField({
  id,
  source,
  onSourceChange,
  value,
  onChange,
  onFetch,
  disabled,
  busy,
  action,
  help,
}: {
  id: string;
  source: EventSource;
  onSourceChange?: (source: EventSource) => void;
  value: string;
  onChange: (value: string) => void;
  onFetch: () => void;
  disabled?: boolean;
  busy?: boolean;
  action: string;
  /** Extra guidance after the venue's own. */
  help?: string;
}) {
  const field = FIELDS[source];
  return (
    <div className="flex flex-col gap-2">
      {onSourceChange && (
        <Tabs value={source} onValueChange={(next) => onSourceChange(next as EventSource)}>
          <TabsList className="grid w-full grid-cols-2 sm:w-80">
            {(["polymarket", "kalshi"] as const).map((venue) => (
              <TabsTrigger key={venue} value={venue}>
                {EVENT_SOURCE_NAMES[venue]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <Label htmlFor={id}>{field.label}</Label>
      <div className="flex gap-3">
        <Input
          id={id}
          aria-describedby={`${id}-help`}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={512}
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button onClick={onFetch} disabled={disabled || !value.trim()}>
          {busy ? <LoaderCircle className="animate-spin" /> : <FileSearch />}
          {action}
        </Button>
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {field.help}
        {help ? ` ${help}` : ""}
      </p>
    </div>
  );
}
