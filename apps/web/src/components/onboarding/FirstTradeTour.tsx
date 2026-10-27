"use client";
import dynamic from "next/dynamic";
import { loadChunk } from "@/lib/load-chunk";
import { useFirstTradeTour } from "@/stores/first-trade-tour";

// Loaded only while a tour runs, so no other visit pays for it.
const FirstTradeTourGuide = dynamic(
  () => loadChunk(() => import("./FirstTradeTourGuide").then((m) => m.FirstTradeTourGuide)),
  { ssr: false },
);

/** The first-trade tour, while this browser has one running. */
export function FirstTradeTour() {
  const tour = useFirstTradeTour();
  return tour?.status === "active" ? <FirstTradeTourGuide reached={tour.step} /> : null;
}
