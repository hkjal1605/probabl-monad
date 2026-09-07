export interface MatcherMetricsSnapshot {
  canonicalEvents: bigint;
  checkpoints: bigint;
  leasesDenied: bigint;
  proposals: bigint;
  reorgs: bigint;
  shadowDivergences: bigint;
  skips: Readonly<Record<string, bigint>>;
}

export class MatcherMetrics {
  canonicalEvents = 0n;
  checkpoints = 0n;
  leasesDenied = 0n;
  proposals = 0n;
  reorgs = 0n;
  shadowDivergences = 0n;
  readonly skips = new Map<string, bigint>();

  recordSkip(reason: string): void {
    this.skips.set(reason, (this.skips.get(reason) ?? 0n) + 1n);
  }

  snapshot(): MatcherMetricsSnapshot {
    return {
      canonicalEvents: this.canonicalEvents,
      checkpoints: this.checkpoints,
      leasesDenied: this.leasesDenied,
      proposals: this.proposals,
      reorgs: this.reorgs,
      shadowDivergences: this.shadowDivergences,
      skips: Object.fromEntries([...this.skips.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
  }
}
