"use client";
import dynamic from "next/dynamic";
import { loadChunk } from "@/lib/load-chunk";

/** The price chart, with its chart library (about 50 KB gzipped) loaded when the first chart on a
 * page renders rather than with the page. Its data arrives after load anyway; a same-size
 * placeholder holds the space meanwhile. */
export const LazyPriceChart = dynamic(
  () => loadChunk(() => import("./LightweightPriceChart").then((m) => m.LightweightPriceChart)),
  { ssr: false, loading: () => <div className="size-full" aria-hidden="true" /> },
);
