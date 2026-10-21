interface Stream {
  source?: EventSource;
  listeners: Set<(value: unknown) => void>;
  errors: Set<() => void>;
  failures: number;
  retry?: ReturnType<typeof setTimeout> | undefined;
}
const streams = new Map<string, Stream>();

/** Opens `url`'s stream into `entry`. A stream the server closed for good (a non-200 answer,
 * which EventSource doesn't retry) reopens with backoff while it has listeners. */
function connect(url: string, entry: Stream) {
  const source = new EventSource(url);
  entry.source = source;
  source.addEventListener("prices", (event) => {
    entry.failures = 0;
    try {
      const value = JSON.parse((event as MessageEvent).data);
      for (const listener of entry.listeners) listener(value);
    } catch {
      for (const listener of entry.errors) listener();
    }
  });
  source.addEventListener("unavailable", () => {
    for (const listener of entry.errors) listener();
  });
  source.onerror = () => {
    for (const listener of entry.errors) listener();
    if (source.readyState !== EventSource.CLOSED || entry.retry) return;
    entry.retry = setTimeout(
      () => {
        entry.retry = undefined;
        if (streams.get(url) === entry) connect(url, entry);
      },
      Math.min(30_000, 2_000 * 2 ** entry.failures++),
    );
  };
}

/** Share identical subscriptions across components; close on last unsubscribe. */
export function subscribePrices(
  url: string,
  update: (value: unknown) => void,
  unavailable: () => void,
) {
  let entry = streams.get(url);
  if (!entry) {
    entry = { listeners: new Set(), errors: new Set(), failures: 0 };
    streams.set(url, entry);
    connect(url, entry);
  }
  const own = entry;
  own.listeners.add(update);
  own.errors.add(unavailable);
  return () => {
    own.listeners.delete(update);
    own.errors.delete(unavailable);
    if (!own.listeners.size) {
      clearTimeout(own.retry);
      own.source?.close();
      streams.delete(url);
    }
  };
}
