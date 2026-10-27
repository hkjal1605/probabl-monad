"use client";
import { useEffect, useRef } from "react";
import { connectProbability } from "@/modules/MarketDetailPageModule/utils/subscribeProbability";
import { expireCachedProbability } from "@/services/probability";
import useProbabilityStore, { probabilityStore } from "@/stores/useProbabilityStore";
import type { ProbabilityView } from "@/types/api";

export function useProbabilityStream(conditionId: string, initial: ProbabilityView) {
  const entry = useProbabilityStore((s) => s.entries[conditionId]?.data);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => {
    if (!conditionId) return;
    return connectProbability(conditionId, initialRef.current);
  }, [conditionId]);
  // The shown value goes stale 90 s after it was observed: one timer at that moment, not a clock.
  const observedAt = entry?.probability.observedAt;
  useEffect(() => {
    const at = observedAt ? Date.parse(observedAt) + 90_000 : NaN;
    if (!conditionId || !Number.isFinite(at) || at <= Date.now()) return;
    const timer = setTimeout(
      () => {
        const current = probabilityStore.get(conditionId).data;
        if (!current) return;
        const probability = expireCachedProbability(current.probability);
        if (probability.quality !== current.probability.quality)
          probabilityStore.setData(conditionId, { ...current, probability });
      },
      at - Date.now() + 1,
    );
    return () => clearTimeout(timer);
  }, [conditionId, observedAt]);
  useEffect(() => {
    if (!conditionId || initial.value === null || !Number.isFinite(initial.value)) return;
    const current = probabilityStore.get(conditionId).data;
    const currentAt = current?.probability.observedAt
      ? Date.parse(current.probability.observedAt)
      : Number.NEGATIVE_INFINITY;
    const initialAt = initial.observedAt
      ? Date.parse(initial.observedAt)
      : Number.NEGATIVE_INFINITY;
    // HTTP catalogue refreshes can recover a display value while an SSE feed is
    // disconnected. Promote that recovery without reconnecting the shared stream.
    if (
      !current ||
      current.probability.value === null ||
      (initial.quality === "valid" &&
        current.probability.quality !== "valid" &&
        initialAt >= currentAt)
    )
      probabilityStore.setData(conditionId, {
        connection: current?.connection ?? "connecting",
        probability: initial,
      });
  }, [conditionId, initial]);
  return (
    entry ?? { probability: expireCachedProbability(initial), connection: "disabled" as const }
  );
}
