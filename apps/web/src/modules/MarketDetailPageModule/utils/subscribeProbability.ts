import { retainProbabilityDisplay } from "@/services/probability";
import { subscribeProbability } from "@/services/probability-stream";
import { probabilityStore } from "@/stores/useProbabilityStore";
import type { ProbabilityView } from "@/types/api";

const same = (a: ProbabilityView, b: ProbabilityView) =>
  a.value === b.value && a.quality === b.quality && a.observedAt === b.observedAt;

/** Keeps the store's entry for `condition` live. Writes only on a change, so every subscriber of
 * a condition (a page may show it twice) and every repeated tick costs no re-render. */
export function connectProbability(condition: string, initial: ProbabilityView) {
  if (!probabilityStore.get(condition).data)
    probabilityStore.setData(condition, { probability: initial, connection: "connecting" });
  const write = (
    probability: ProbabilityView,
    connection: "connecting" | "live" | "reconnecting",
  ) => {
    const current = probabilityStore.get(condition).data;
    if (current && current.connection === connection && same(current.probability, probability))
      return;
    probabilityStore.setData(condition, { probability, connection });
  };
  return subscribeProbability(
    condition,
    (probability) => {
      const previous = probabilityStore.get(condition).data?.probability;
      write(previous ? retainProbabilityDisplay(previous, probability) : probability, "live");
    },
    // Transport state must not erase a previously verified display value.
    (connection) => write(probabilityStore.get(condition).data?.probability ?? initial, connection),
  );
}
