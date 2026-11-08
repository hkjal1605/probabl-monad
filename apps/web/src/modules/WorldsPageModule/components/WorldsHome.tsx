"use client";
import { useState } from "react";
import { worldsEnabled } from "@/config/protocol";
import { ExploringWorlds } from "./ExploringWorlds";
import { LiveWorlds } from "./LiveWorlds";
import { type ShownWorld, WorldPayouts } from "./WorldPayouts";
import { WorldStarter } from "./WorldStarter";

/** Cards each list shows here (and reads: no more), with "View All" to its own page. */
const HOME_CARDS = 4;

/** The worlds home: where a world starts (someone's words), the worlds people are exploring,
 * and every world people trade. */
export function WorldsHome() {
  const [shown, setShown] = useState<ShownWorld | null>(null);
  /** Back to the starter, with its first open event's search opened. */
  const focusStarter = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector<HTMLElement>('#say [data-slot="event"]')?.click();
  };

  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      {/* Say it */}
      {/* As wide as the cards below it: the sentence gets the room to read in fewer, larger lines. */}
      {/* The sentence leads the page; the page's heading is for assistive technology only. */}
      <section className="mx-auto flex w-full flex-col items-center gap-5 pt-8 text-center sm:gap-7 sm:pt-16">
        <h1 className="sr-only">Worlds</h1>
        {!worldsEnabled && (
          <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
            Worlds are off on this network.
          </p>
        )}
        <div id="say" className="w-full">
          <WorldStarter onShown={setShown} />
        </div>
      </section>

      {/* What the world above pays, both ways, live. */}
      <section>
        <WorldPayouts shown={shown} />
      </section>

      {/* Worlds others priced that nobody holds yet, each a tap from a bet */}
      <ExploringWorlds limit={HOME_CARDS} />

      {/* Every world people trade */}
      <LiveWorlds limit={HOME_CARDS} onStart={focusStarter} />
    </div>
  );
}
