/** The API's shutdown, in order and promptly, on SIGINT or SIGTERM:
 *
 * 1. the listener closes (new connections are refused, so the proxy answers for the gap until
 *    the next process listens) while requests in flight go on;
 * 2. background work stops and long-lived sockets are closed, so their clients reconnect to the
 *    next process;
 * 3. requests in flight finish, for up to `drainMs` (with none, this takes no time);
 * 4. state is flushed and resources closed, within `flushMs`;
 * 5. the process exits, which ends whatever is still open: the live streams (server-sent
 *    events), whose clients reconnect.
 *
 * Nothing here waits on the server's own "stopped" promise. Bun's graceful stop does not settle
 * while a stream is open, nor after the server itself closed a WebSocket; and a forced stop
 * asked after a graceful one neither closes the open streams nor settles (Bun 1.3.14). A
 * shutdown that awaited them sat deaf, its listener already closed, until the process manager
 * killed it a minute and a half later: every restart was that long an outage.
 *
 * Every wait is bounded, a second signal exits at once, and the outcome is logged with how long
 * it took. */
export interface ShutdownSteps {
  /** Closes the listener: new connections are refused, requests in flight go on. What it
   * returns is not awaited. */
  stopListening(): unknown;
  /** Stops timers and closes long-lived sockets whose clients should reconnect elsewhere. */
  quiesce(): void;
  /** Requests in flight now. */
  inflight(): number;
  /** Flushes what is queued and closes resources (the index's checkpoint, the database). */
  flush(): Promise<unknown>;
  /** The longest requests in flight are waited for, and the longest the flush may take. */
  drainMs: number;
  flushMs: number;
  log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>): void;
  /** Ends the process (injectable for tests). */
  exit?(code: number): void;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The signal handler: call it with the signal's name. */
export function createShutdown(steps: ShutdownSteps) {
  const exit = steps.exit ?? ((code: number) => process.exit(code));
  let startedAt = 0;
  return async function shutdown(signal: string) {
    if (startedAt) {
      // Asked again while stopping: whoever asks wants out now.
      steps.log("warn", "api.stop.forced", { signal, ms: Date.now() - startedAt });
      return exit(1);
    }
    startedAt = Date.now();
    steps.log("info", "api.stopping", { signal, inflight: steps.inflight() });
    for (const step of [steps.stopListening, steps.quiesce])
      try {
        // A listener's stop may reject later; nothing waits on it.
        void Promise.resolve(step()).catch(() => {});
      } catch (error) {
        steps.log("warn", "api.stop.step-failed", { error: String(error) });
      }
    const drainUntil = startedAt + steps.drainMs;
    while (steps.inflight() > 0 && Date.now() < drainUntil) await wait(25);
    const cut = steps.inflight();
    if (cut) steps.log("warn", "api.stop.requests-cut", { inflight: cut, drainMs: steps.drainMs });
    const drainedMs = Date.now() - startedAt;
    const flushed = await Promise.race([
      steps.flush().then(
        () => "flushed" as const,
        (error) => {
          steps.log("error", "api.stop.flush-failed", { error: String(error) });
          return "failed" as const;
        },
      ),
      wait(steps.flushMs).then(() => "timed-out" as const),
    ]);
    steps.log(flushed === "flushed" ? "info" : "error", "api.stopped", {
      signal,
      outcome: flushed,
      drainedMs,
      ms: Date.now() - startedAt,
    });
    exit(flushed === "flushed" ? 0 : 1);
  };
}
