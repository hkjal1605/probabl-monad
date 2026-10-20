/** Spaces calls to a rate-limited API (Kalshi's public one answers bursts with 429): each call
 * starts at least `1000 / perSecond` ms after the previous one, in call order. */
export class RequestPacer {
  #next = 0;

  constructor(readonly perSecond: number) {}

  async run<T>(call: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const start = Math.max(now, this.#next);
    this.#next = start + 1000 / this.perSecond;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
    return call();
  }
}
