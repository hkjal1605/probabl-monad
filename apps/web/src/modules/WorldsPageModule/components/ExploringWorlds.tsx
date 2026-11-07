"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExploredCard } from "@/components/worlds/ExploredCard";
import { useExploring } from "@/hooks/useWorlds";
import { ShowMore, ViewAll } from "./LiveWorlds";

/** Worlds the full list shows at first, and adds per "Show more". */
const PAGE = 12;

/** "What people are exploring": the worlds visitors priced lately that nobody holds yet (those
 * are in the live worlds), the most recently priced first, each a tap away from a bet. On the
 * worlds page its first `limit` with a way to the full list (`/worlds/exploring`), left out until
 * there is one; there a page at a time. Only the worlds shown are read. */
export function ExploringWorlds({
  limit,
  heading = "h2",
}: {
  limit?: number;
  heading?: "h1" | "h2";
}) {
  const [shown, setShown] = useState(PAGE);
  const exploring = useExploring(limit ?? shown);
  const worlds = exploring.data?.worlds ?? [];
  const total = exploring.data?.total ?? 0;
  const full = limit === undefined;
  if (!full && !worlds.length) return null;
  const Heading = heading;
  return (
    <section className="flex flex-col gap-5" aria-labelledby="exploring-title">
      <div className="flex items-center justify-between gap-4">
        <Heading
          id="exploring-title"
          className="text-[28px] leading-tight font-medium tracking-[-0.02em] sm:text-4xl"
        >
          What people are exploring
        </Heading>
        {!full && (
          <ViewAll href="/worlds/exploring" label="View all the worlds people are exploring" />
        )}
      </div>
      {worlds.length ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {worlds.slice(0, limit ?? shown).map((w) => (
              <ExploredCard key={w.specHash} world={w} />
            ))}
          </div>
          {full && total > shown && (
            <ShowMore loading={exploring.loading} onClick={() => setShown((n) => n + PAGE)} />
          )}
        </>
      ) : exploring.loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
            <Skeleton key={i} className="h-72 rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-3xl bg-card px-6 py-12 text-center ring-1 ring-border">
          <p className="text-lg font-medium">No one has priced a world yet</p>
          <Button size="lg" render={<Link href="/worlds" />} nativeButton={false}>
            Price yours
          </Button>
        </div>
      )}
    </section>
  );
}
