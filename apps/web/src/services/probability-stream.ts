import type { ProbabilityView } from "@/types/api";
import {
  expireCachedProbability,
  PROBABILITY_BATCH_SIZE,
  parseProbabilityMessage,
  probabilityStreamUrl,
} from "./probability";

type Status = "connecting" | "live" | "reconnecting";
interface Subscription {
  listeners: Set<(value: ProbabilityView) => void>;
  statuses: Set<(value: Status) => void>;
  latest?: ProbabilityView;
  status: Status;
}
interface Source {
  conditions: string[];
  source: EventSource;
  failures: number;
  retry?: ReturnType<typeof setTimeout>;
}
const subscriptions = new Map<string, Subscription>();
let sources: Source[] = [];
let scheduled = false;

const setStatus = (entry: Subscription | undefined, value: Status) => {
  if (!entry) return;
  entry.status = value;
  for (const listener of entry.statuses) listener(value);
};
const conditionOf = (data: unknown, key: "topic" | "conditionId") => {
  try {
    const value = (JSON.parse(String(data)) as Record<string, unknown>)?.[key];
    return typeof value === "string" ? value.replace(/^probability\./, "") : "";
  } catch {
    return "";
  }
};
const close = (s: Source) => {
  clearTimeout(s.retry);
  s.source.close();
};

/** Opens one stream for `conditions` (at most a batch). A stream the server closed for good (a
 * non-200 answer, which EventSource doesn't retry) reopens with backoff while it is still needed. */
function open(conditions: string[], failures = 0): Source | undefined {
  let source: EventSource;
  try {
    source = new EventSource(probabilityStreamUrl(conditions));
  } catch {
    for (const condition of conditions) setStatus(subscriptions.get(condition), "reconnecting");
    return undefined;
  }
  const entry: Source = { conditions, source, failures };
  source.addEventListener("probability", (event) => {
    const data = (event as MessageEvent).data;
    const condition = conditionOf(data, "topic");
    const subscription = conditions.includes(condition) ? subscriptions.get(condition) : undefined;
    if (!subscription) return;
    entry.failures = 0;
    try {
      const value = expireCachedProbability(parseProbabilityMessage(JSON.parse(data), condition));
      subscription.latest = value;
      setStatus(subscription, "live");
      for (const listener of subscription.listeners) listener(value);
    } catch {
      setStatus(subscription, "reconnecting");
    }
  });
  source.addEventListener("unavailable", (event) => {
    const condition = conditionOf((event as MessageEvent).data, "conditionId");
    if (conditions.includes(condition)) setStatus(subscriptions.get(condition), "reconnecting");
  });
  source.onerror = () => {
    for (const condition of conditions) setStatus(subscriptions.get(condition), "reconnecting");
    if (source.readyState !== EventSource.CLOSED || entry.retry) return;
    entry.retry = setTimeout(
      () => {
        const index = sources.indexOf(entry);
        if (index < 0) return;
        const still = conditions.filter((c) => subscriptions.has(c));
        const next = still.length ? open(still, entry.failures + 1) : undefined;
        sources.splice(index, 1, ...(next ? [next] : []));
      },
      Math.min(30_000, 2_000 * 2 ** entry.failures),
    );
  };
  return entry;
}

/** Brings the streams in line with the subscriptions, once per batch of (un)subscriptions (a
 * page's cards mount together). A stream closes once none of its conditions is subscribed; new
 * conditions get a stream of their own, and the streams are merged back into the fewest batches
 * when that leaves more than one spare. Values and statuses carry over, so nothing blanks. */
function sync() {
  scheduled = false;
  sources = sources.filter((s) => {
    const needed = s.conditions.some((c) => subscriptions.has(c));
    if (!needed) close(s);
    return needed;
  });
  const covered = new Set(sources.flatMap((s) => s.conditions));
  const added = [...subscriptions.keys()].filter((c) => !covered.has(c)).sort();
  if (!added.length) return;
  const fewest = Math.ceil(subscriptions.size / PROBABILITY_BATCH_SIZE);
  const batches = (list: string[]) =>
    Array.from({ length: Math.ceil(list.length / PROBABILITY_BATCH_SIZE) }, (_, i) =>
      list.slice(i * PROBABILITY_BATCH_SIZE, (i + 1) * PROBABILITY_BATCH_SIZE),
    );
  if (sources.length + batches(added).length > fewest + 1) {
    for (const s of sources) close(s);
    sources = [];
    for (const batch of batches([...subscriptions.keys()].sort())) {
      const s = open(batch);
      if (s) sources.push(s);
    }
    return;
  }
  for (const batch of batches(added)) {
    const s = open(batch);
    if (s) sources.push(s);
  }
}
const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(sync);
};

/** Live probabilities over the API's shared SSE streams: every condition subscribed on the page
 * rides a shared connection (up to 50 per connection), shared by all its subscribers. */
export function subscribeProbability(
  condition: string,
  update: (value: ProbabilityView) => void,
  status: (value: Status) => void,
) {
  const canonical = condition.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(canonical)) {
    status("reconnecting");
    return () => {};
  }
  let entry = subscriptions.get(canonical);
  if (!entry) {
    entry = { listeners: new Set(), statuses: new Set(), status: "connecting" };
    subscriptions.set(canonical, entry);
    schedule();
  }
  const own = entry;
  own.listeners.add(update);
  own.statuses.add(status);
  status(own.status);
  if (own.latest && own.status === "live") update(expireCachedProbability(own.latest));
  return () => {
    own.listeners.delete(update);
    own.statuses.delete(status);
    if (!own.listeners.size && subscriptions.get(canonical) === own) {
      subscriptions.delete(canonical);
      schedule();
    }
  };
}
