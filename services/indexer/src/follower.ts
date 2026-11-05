/** Live chain index over JSON-RPC.
 *
 * Two in-memory replicas of the exchange ledger (`@conditional-stocks/evm-client/ledger`):
 * - confirmed: the chain tip. Trading reads (markets, books, orders, streams, order planning) and
 *   wallet views use it.
 * - base: the finalized block. Its trades and closed orders are persisted, and a checkpoint of it
 *   makes restarts replay only the blocks after it.
 *
 * Tip: each poll is one header request. A head linked to the tip by parentHash needs no reorg
 * check, its logsBloom decides whether eth_getLogs is needed at all, and logs are read by block
 * hash so they belong to exactly that block. Gaps of up to 50 blocks are filled by header and
 * checked for linkage; larger gaps (downtime), and any gap on a chain with sub-second blocks, use
 * ranged eth_getLogs (one call per poll instead of one per block). A head behind the tip (a
 * lagging endpoint) is ignored; a broken link rebuilds the tip from the base.
 *
 * Polling follows the chain's own block interval (learned from header timestamps) unless
 * `pollMs` fixes it: the next poll is due just before the next block, then every quarter
 * interval until it appears, so few polls find nothing new. With several endpoints, a head that
 * stops advancing is compared with the others and the follower moves to one that is ahead: a
 * node that answers but has stalled cannot freeze the index.
 *
 * Finality: finalized ranges are read again with ranged eth_getLogs, in parallel chunks sized to
 * what the provider accepts, so persisted history never depends on what the tip saw. When the
 * two differ, the tip is rebuilt. The finalized head is read every `finalityMs` while it advances
 * and backs off while it stands still.
 *
 * What it replays is a `Ledger`: the exchange's by default (`exchangeLedger`), or another set of
 * contracts' (the world books, `@conditional-stocks/indexer/worlds`) with its own replica. */
import type { Database } from "@conditional-stocks/db";
import {
  applyTransaction,
  type ChainState,
  cloneState,
  type DecodedEvent,
  decodeLog,
  emptyState,
  isFill,
  type OrderState,
  restoreState,
  StaleCheckpointError,
  type Touched,
  type TradeDetails,
  touched,
  tradeDetails,
} from "@conditional-stocks/evm-client/ledger";
import { type Address, getAddress, type Hex, type Log, type PublicClient } from "viem";
import { logRangeLimit, mapLimit, mayContain } from "./rpc.ts";

/** A replica's position on the chain. */
export interface LedgerState {
  block: bigint;
  hash: Hex;
  timestamp: bigint;
}
/** A decoded log, in chain order. */
export interface LedgerEvent {
  name: string;
  args: Record<string, unknown>;
  block: bigint;
  logIndex: number;
  transactionHash: Hex;
}
/** What the follower replays: the contracts it reads and how their logs build a replica.
 * `D` is a per-event detail resolved right after its transaction applies (the exchange's
 * trades); `X` are records that leave both replicas once final (its closed orders). */
export interface Ledger<S extends LedgerState, C, E extends LedgerEvent, D = never, X = never> {
  addresses: readonly Address[];
  /** The replica before the deployment block. */
  empty(): S;
  clone(s: S): S;
  /** A replica from its checkpoint text. */
  restore(text: string): S;
  /** Whether a restore failed only because the checkpoint predates the replica's format (the
   * follower then replays from the deployment block). */
  stale(error: unknown): boolean;
  /** Throws when a restored replica belongs to another deployment. */
  verify(restored: S): void;
  decode(log: Log, timestamp: bigint): E;
  touched(): C;
  merge(into: C, from: C): void;
  /** Applies the events of one transaction. */
  apply(s: S, events: E[], changes: C): void;
  details?(s: S, e: E): D | undefined;
  /** Evicts what finalization made final (`changes` is what it touched up to `block`). */
  evict?(base: S, confirmed: S, changes: C, block: bigint): X[];
}

/** The exchange's ledger (`@conditional-stocks/evm-client/ledger`). */
export function exchangeLedger(
  exchange: Address,
  quote: Address,
): Ledger<ChainState, Touched, DecodedEvent, TradeDetails, OrderState> {
  return {
    addresses: [getAddress(exchange)],
    empty: () => emptyState(quote),
    clone: cloneState,
    restore: restoreState,
    stale: (error) => error instanceof StaleCheckpointError,
    verify(restored) {
      if (getAddress(restored.quote) !== getAddress(quote))
        throw new Error("Checkpoint belongs to another deployment");
    },
    decode: decodeLog,
    touched,
    merge(into, from) {
      for (const key of ["markets", "owners", "orders"] as const)
        for (const value of from[key]) (into[key] as Set<unknown>).add(value);
    },
    apply: (s, events, changes) => void applyTransaction(s, events, changes),
    details: (s, e) => (isFill(e.name) ? tradeDetails(s, e) : undefined),
    evict(base, confirmed, changes, block) {
      // Closed orders are final: they move to persisted history and leave both replicas. Only
      // an order these events touched can have closed.
      const closed: OrderState[] = [];
      for (const key of changes.orders) {
        const order = base.orders.get(key);
        if (order && order.status !== "open" && order.updatedBlock <= block) {
          closed.push(order);
          base.orders.delete(key);
          confirmed.orders.delete(key);
        }
      }
      return closed;
    },
  };
}

export interface CommitNotice<S = ChainState, C = Touched, E = DecodedEvent, D = TradeDetails> {
  block: bigint;
  state: S;
  changes: C;
  events: E[];
  trades: Map<string, D>;
  /** The tip was rebuilt from the base: events after the base block were replaced. */
  rebuilt: boolean;
}
export interface FinalizedNotice<
  S = ChainState,
  E = DecodedEvent,
  D = TradeDetails,
  X = OrderState,
> {
  block: bigint;
  hash: Hex;
  base: S;
  events: E[];
  /** Execution details of each Trade (resolved while replaying), by `${block}:${logIndex}`. */
  trades: Map<string, D>;
  /** Orders closed at or before `block`: final, already evicted from both replicas. */
  closed: X[];
}
export interface FollowerOptions<
  S extends LedgerState = ChainState,
  C = Touched,
  E extends LedgerEvent = DecodedEvent,
  D = TradeDetails,
  X = OrderState,
> {
  client: PublicClient;
  /** One client per RPC endpoint, each failing over to the others. The follower reads through
   * one of them and moves on when a poll fails or its head stalls behind another endpoint. */
  endpoints?: PublicClient[];
  /** The contract followed and its quote token: the exchange's, unless `ledger` replays
   * another deployment (whose main contract and quote token they then name). */
  exchange: Address;
  quote: Address;
  /** What to replay instead of the exchange. */
  ledger?: Ledger<S, C, E, D, X>;
  deploymentBlock: bigint;
  domain: string;
  db?: Pick<Database, "checkpoint">;
  /** Fixed head polling interval; by default polls follow the chain's block interval. */
  pollMs?: number;
  /** Interval between reads of the finalized block while it advances (default 15 s). */
  finalityMs?: number;
  /** Initial eth_getLogs block span; it adapts to what the provider accepts. */
  logRange?: bigint;
  /** Blocks behind the head treated as final, for an RPC without the `finalized` tag. */
  finalityDepth?: bigint;
  onCommit?(notice: CommitNotice<S, C, E, D>): void;
  /** Called in order and synchronously: persistence must not hold up the follower. */
  onFinalized?(notice: FinalizedNotice<S, E, D, X>): void;
  onError?(error: unknown): void;
}

interface Tip {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}
interface Header extends Tip {
  parentHash: Hex;
  logsBloom: Hex | null;
  transactions: readonly unknown[];
}
interface PendingBlock<C, E> extends Tip {
  events: E[];
  changes: C;
}
interface BlockEvents<E> {
  block: Tip;
  events: E[];
}

/** Largest gap filled header by header; beyond it the tip catches up with ranged eth_getLogs. */
const MAX_GAP = 50n;
/** Below this block interval, any gap of more than one block is read by range, not by header. */
const FAST_BLOCK_MS = 1_000;
const LOG_CONCURRENCY = 4;
/** Header reads in flight: public endpoints rate-limit bursts (a replay from the deployment
 * block reads one header per block with logs when the logs carry no timestamp). */
const HEADER_CONCURRENCY = 4;
const MAX_LOG_RANGE = 100_000n;
/** Bounds of the learned block interval, which paces adaptive polling. */
const MIN_POLL_MS = 250;
const MAX_POLL_MS = 12_000;
/** Finalized-head reads back off to at most this multiple of `finalityMs`. */
const FINALITY_BACKOFF = 8;
const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];

const tradeKey = (e: LedgerEvent) => `${e.block}:${e.logIndex}`;
const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const fingerprint = (events: LedgerEvent[]) =>
  events.map((e) => `${tradeKey(e)}:${e.transactionHash}:${e.name}:${json(e.args)}`).join("|");
/** Groups decoded logs by transaction (logs arrive in block and log order). */
function* byTransaction<E extends LedgerEvent>(events: E[]) {
  let batch: E[] = [];
  for (const e of events) {
    if (
      batch.length &&
      (batch[0]!.transactionHash !== e.transactionHash || batch[0]!.block !== e.block)
    ) {
      yield batch;
      batch = [];
    }
    batch.push(e);
  }
  if (batch.length) yield batch;
}
const zeroBloom = (bloom: Hex | null) => !bloom || /^0x0*$/.test(bloom);
const header = (block: {
  number: bigint | null;
  hash: Hex | null;
  parentHash: Hex;
  timestamp: bigint;
  logsBloom: Hex | null;
  transactions: readonly unknown[];
}): Header => {
  if (block.number === null || block.hash === null) throw new Error("Pending block from RPC");
  return {
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp,
    logsBloom: block.logsBloom,
    transactions: block.transactions,
  };
};

/** A stored checkpoint's text: zstd-compressed compact JSON, or a legacy uncompressed one. */
export function checkpointText(bytes: Uint8Array): string {
  const compressed = ZSTD.every((byte, i) => bytes[i] === byte);
  return (compressed ? Bun.zstdDecompressSync(bytes) : Buffer.from(bytes)).toString("utf8");
}
/** A stored checkpoint of the exchange. */
export const readCheckpoint = (bytes: Uint8Array): ChainState =>
  restoreState(checkpointText(bytes));

export class ChainFollower<
  S extends LedgerState = ChainState,
  C = Touched,
  E extends LedgerEvent = DecodedEvent,
  D = TradeDetails,
  X = OrderState,
> {
  readonly ledger: Ledger<S, C, E, D, X>;
  base: S;
  confirmed: S;
  ready = false;
  /** The block of the checkpoint this run resumed from: its history was persisted by an earlier
   * run, and every later block is finalized again by this one. Undefined without a checkpoint. */
  restored: bigint | undefined;
  /** Increments whenever the confirmed replica changes, so reads can be memoized per revision. */
  revision = 0;
  /** Unfinalized blocks with protocol events, applied to the confirmed replica. */
  private pending: PendingBlock<C, E>[] = [];
  private head: Tip;
  private range: bigint;
  /** Span limit a provider stated in an error, or just below a span it refused. */
  private maxRange = MAX_LOG_RANGE;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private running: Promise<void> = Promise.resolve();
  private lastSuccess = 0;
  private finalityDue = 0;
  private finalityDelay: number;
  /** Learned block interval (a guess until the first sample) and the head it was updated from. */
  private blockMs = 1_000;
  private learned = false;
  private sample: { number: bigint; timestamp: bigint } | undefined;
  private endpoint = 0;
  private advancedAt = 0;
  private probedAt = 0;
  /** Whether a poll is in flight, and whether a poke asked for another right after it. */
  private polling = false;
  private again = false;
  /** Callers waiting for the confirmed replica to reach a block. */
  private waiters: { block: bigint; resolve: () => void; reject: (error: Error) => void }[] = [];
  /** An empty logsBloom proves a block without logs once the endpoint is seen to compute blooms
   * (chains may zero them); a finalized re-read that differs from the tip revokes the trust. */
  private emptyBloom: "unknown" | "trusted" | "revoked" = "unknown";

  constructor(readonly options: FollowerOptions<S, C, E, D, X>) {
    this.ledger =
      options.ledger ??
      (exchangeLedger(options.exchange, options.quote) as unknown as Ledger<S, C, E, D, X>);
    this.base = this.ledger.empty();
    this.base.block = options.deploymentBlock - 1n;
    this.confirmed = this.base;
    this.head = this.baseTip();
    this.range = options.logRange ?? 2_000n;
    this.finalityDelay = options.finalityMs ?? 15_000;
  }

  private get client() {
    return this.options.endpoints?.[this.endpoint] ?? this.options.client;
  }

  /** Current polling interval: fixed, or the learned block interval. */
  interval() {
    return this.options.pollMs ?? this.blockMs;
  }

  health() {
    const age = this.lastSuccess ? Date.now() - this.lastSuccess : Number.POSITIVE_INFINITY;
    return {
      healthy: this.ready && age < Math.max(15_000, this.interval() * 10),
      confirmedBlock: this.confirmed.block,
      finalizedBlock: this.base.block,
      lagMs: age,
    };
  }

  async start() {
    const { db, domain } = this.options;
    const checkpoint = await db?.checkpoint(domain);
    // A checkpoint from an older replica lacks state it now keeps: the replica is rebuilt from
    // the deployment block (persisting history again is idempotent).
    let restored: S | undefined;
    try {
      restored = checkpoint ? this.ledger.restore(checkpointText(checkpoint.state)) : undefined;
    } catch (error) {
      if (!this.ledger.stale(error)) throw error;
      this.options.onError?.(
        new Error(`Replaying from the deployment block: ${(error as Error).message}`),
      );
    }
    if (restored) {
      this.ledger.verify(restored);
      this.base = restored;
      this.restored = restored.block;
    }
    // Blocks after the checkpoint are read from the chain by the first finality pass.
    this.confirmed = this.ledger.clone(this.base);
    this.head = this.baseTip();
    this.advancedAt = Date.now();
    // The first pass catches up from the checkpoint (or the deployment block). A failed read
    // (a rate limit, a node hiccup) is retried with backoff from where the pass got to, rather
    // than failing the start and losing the progress.
    let advanced = false;
    for (let attempt = 0; ; attempt++) {
      try {
        advanced = await this.tick();
        break;
      } catch (error) {
        if (this.stopped) throw error;
        this.options.onError?.(error);
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempt)));
      }
    }
    this.ready = true;
    this.schedule(this.delay(advanced));
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(new Error("The chain follower stopped"));
  }

  /** Polls now instead of at the next scheduled poll (say, once the caller's own transaction
   * was included); a poll in flight is followed by another straight away. */
  poke() {
    if (this.stopped || !this.ready) return;
    if (this.polling) {
      this.again = true;
      return;
    }
    clearTimeout(this.timer);
    this.schedule(0);
  }

  /** Resolves as soon as the confirmed replica reaches `block`, or rejects after `timeoutMs`. */
  reached(block: bigint, timeoutMs: number): Promise<void> {
    if (this.confirmed.block >= block) return Promise.resolve();
    if (this.stopped) return Promise.reject(new Error("The chain follower stopped"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`The chain view did not reach block ${block} in time`));
      }, timeoutMs);
      const waiter = {
        block,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.push(waiter);
    });
  }

  /** Waits for an in-flight poll (shutdown). */
  drain() {
    return this.running;
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      let next = this.interval();
      this.polling = true;
      this.running = this.tick()
        .then((advanced) => {
          next = this.delay(advanced);
        })
        .catch((error) => {
          this.rotate();
          this.options.onError?.(error);
        })
        .finally(() => {
          this.polling = false;
          const now = this.again;
          this.again = false;
          this.schedule(now ? 0 : next);
        });
    }, delay);
  }

  /** Just before the next block is due after one arrived (drifting the poll phase towards block
   * production, so detection latency converges low), then a quarter interval while waiting. */
  private delay(advanced: boolean) {
    if (this.options.pollMs !== undefined) return this.options.pollMs;
    return Math.max(MIN_POLL_MS, Math.round(advanced ? this.blockMs * 0.95 : this.blockMs / 4));
  }

  private baseTip(): Tip {
    return { number: this.base.block, hash: this.base.hash, timestamp: this.base.timestamp };
  }

  /** Returns whether the tip advanced. */
  async tick() {
    const latest = header(await this.client.getBlock());
    this.learn(latest);
    if (Date.now() >= this.finalityDue || latest.number - this.head.number > MAX_GAP) {
      const before = this.base.block;
      const every = this.options.finalityMs ?? 15_000;
      try {
        const advanced = await this.advanceFinality(latest);
        this.finalityDelay = advanced
          ? every
          : Math.min(this.finalityDelay * 2, every * FINALITY_BACKOFF);
        this.finalityDue = Date.now() + this.finalityDelay;
      } catch (error) {
        // Finality never holds up the tip: retry on the next poll, and rebuild the tip on any
        // partial catch-up so it reflects the base.
        this.finalityDue = 0;
        this.options.onError?.(error);
        if (this.base.block > before)
          this.rebuildTip(
            this.pending.filter((p) => p.number > this.base.block),
            this.head.number > this.base.block ? this.head : this.baseTip(),
          );
      }
    }
    const from = this.head.number;
    await this.advanceTip(latest);
    this.lastSuccess = Date.now();
    if (this.head.number > from) this.advancedAt = this.lastSuccess;
    else await this.probe();
    return this.head.number > from;
  }

  /** Updates the block interval from header timestamps, weighting by the blocks spanned. */
  private learn(latest: Header) {
    const sample = this.sample;
    this.sample = { number: latest.number, timestamp: latest.timestamp };
    if (!sample || latest.number <= sample.number || latest.timestamp < sample.timestamp) return;
    const blocks = Number(latest.number - sample.number);
    const ms = Math.min(
      MAX_POLL_MS,
      Math.max(MIN_POLL_MS, (Number(latest.timestamp - sample.timestamp) * 1000) / blocks),
    );
    const weight = this.learned ? Math.min(1, blocks / 8) : 1;
    this.blockMs = this.blockMs * (1 - weight) + ms * weight;
    this.learned = true;
  }

  private rotate() {
    const count = this.options.endpoints?.length ?? 0;
    if (count > 1) this.endpoint = (this.endpoint + 1) % count;
  }

  /** A head that has not moved for a while is compared with the other endpoints' heads; the
   * follower moves to the furthest one if it is ahead (at most one probe per stall window). */
  private async probe() {
    const endpoints = this.options.endpoints;
    const stall = Math.max(30_000, this.interval() * 15);
    const now = Date.now();
    if (!endpoints || endpoints.length < 2 || now - this.advancedAt < stall) return;
    if (now - this.probedAt < stall) return;
    this.probedAt = now;
    const heads = await Promise.all(
      endpoints.map((client) => client.getBlockNumber({ cacheTime: 0 }).catch(() => -1n)),
    );
    let best = this.endpoint;
    for (let i = 0; i < heads.length; i++) if (heads[i]! > heads[best]!) best = i;
    if (best !== this.endpoint && heads[best]! > this.head.number) {
      this.options.onError?.(
        new Error(`RPC endpoint ${this.endpoint} stalled at ${this.head.number}; using ${best}`),
      );
      this.endpoint = best;
    }
  }

  /** Whether a block can hold the ledger's logs, judged from its header alone. */
  private mayHaveLogs(h: Header) {
    if (!h.transactions.length) return false;
    if (zeroBloom(h.logsBloom)) return this.emptyBloom !== "trusted";
    if (this.emptyBloom === "unknown") this.emptyBloom = "trusted";
    return this.ledger.addresses.some((address) => mayContain(h.logsBloom, address));
  }

  /** The `address` filter of eth_getLogs. */
  private get filter() {
    const { addresses } = this.ledger;
    return addresses.length === 1 ? addresses[0]! : [...addresses];
  }

  private async advanceTip(latest: Header): Promise<void> {
    const client = this.client;
    // A lagging endpoint, or no new block: nothing to do.
    if (latest.number < this.head.number || latest.hash === this.head.hash) return;
    const anchored = this.head.number === this.base.block;
    const gap = latest.number - this.head.number;
    if (gap === 0n) {
      // Same height, different block: the tip was reorganized.
      if (anchored) return;
      this.rebuildTip([], this.baseTip());
      return this.advanceTip(latest);
    }
    // Gaps beyond what headers should fill are read as one ranged eth_getLogs: past MAX_GAP on any
    // chain, and past one block on a chain with blocks under a second (Robinhood Chain, Monad),
    // where a poll finds several blocks and reading each header would cost an RPC call per block.
    if (gap > (this.blockMs < FAST_BLOCK_MS ? 1n : MAX_GAP)) {
      if (
        !anchored &&
        header(await client.getBlock({ blockNumber: this.head.number })).hash !== this.head.hash
      )
        this.rebuildTip([], this.baseTip());
      const logs: Log[] = [];
      for await (const chunk of this.chunks(this.head.number, latest.number))
        logs.push(...chunk.logs);
      if (logs.some((log) => log.blockNumber === latest.number && log.blockHash !== latest.hash))
        throw new Error("Logs and head come from different forks");
      this.commit(await this.blocksOf(logs, new Map([[latest.hash, latest.timestamp]])), latest);
      return;
    }
    const numbers: bigint[] = [];
    for (let n = this.head.number + 1n; n < latest.number; n++) numbers.push(n);
    const headers = [
      ...(await mapLimit(numbers, HEADER_CONCURRENCY, async (blockNumber) =>
        header(await client.getBlock({ blockNumber })),
      )),
      latest,
    ];
    for (let i = 1; i < headers.length; i++)
      if (headers[i]!.parentHash !== headers[i - 1]!.hash)
        throw new Error("Inconsistent headers from the RPC endpoint");
    if (!anchored && headers[0]!.parentHash !== this.head.hash) {
      this.rebuildTip([], this.baseTip());
      return this.advanceTip(latest);
    }
    const blocks = await mapLimit(headers, HEADER_CONCURRENCY, async (h) => ({
      block: h,
      events: this.mayHaveLogs(h) ? await this.blockEvents(h) : [],
    }));
    this.commit(blocks, latest);
  }

  /** Protocol events of one block, read by its hash. */
  private async blockEvents(block: Header) {
    const logs = await this.client.getLogs({ address: this.filter, blockHash: block.hash });
    if (logs.some((log) => log.blockHash !== block.hash || log.blockNumber !== block.number))
      throw new Error("Logs do not belong to the requested block");
    return (await this.blocksOf(logs, new Map([[block.hash, block.timestamp]])))[0]?.events ?? [];
  }

  /** Applies blocks of events to the confirmed replica and moves the tip to `head`. */
  private commit(blocks: BlockEvents<E>[], head: Tip, reset?: C) {
    const ledger = this.ledger;
    const changes = reset ?? ledger.touched();
    const events: E[] = [];
    const trades = new Map<string, D>();
    for (const { block, events: list } of blocks) {
      if (!list.length || block.number <= this.base.block) continue;
      const own = ledger.touched();
      for (const batch of byTransaction(list)) {
        ledger.apply(this.confirmed, batch, own);
        this.detail(this.confirmed, batch, trades);
      }
      ledger.merge(changes, own);
      this.pending.push({ ...block, events: list, changes: own });
      events.push(...list);
    }
    this.head = { number: head.number, hash: head.hash, timestamp: head.timestamp };
    this.confirmed.block = head.number;
    this.confirmed.hash = head.hash;
    this.confirmed.timestamp = head.timestamp;
    this.revision++;
    if (this.waiters.some((w) => w.block <= head.number)) {
      const ready = this.waiters.filter((w) => w.block <= head.number);
      this.waiters = this.waiters.filter((w) => w.block > head.number);
      for (const w of ready) w.resolve();
    }
    this.options.onCommit?.({
      block: head.number,
      state: this.confirmed,
      changes,
      events,
      trades,
      rebuilt: reset !== undefined,
    });
  }

  /** Details the ledger resolves right after `batch` applied to `s`. */
  private detail(s: S, batch: E[], into: Map<string, D>) {
    const details = this.ledger.details;
    if (!details) return;
    for (const e of batch) {
      const d = details(s, e);
      if (d !== undefined) into.set(tradeKey(e), d);
    }
  }

  /** Rebuilds the tip from the base, re-applying the still-valid unfinalized blocks. */
  private rebuildTip(keep: PendingBlock<C, E>[], head: Tip, changes = this.ledger.touched()) {
    for (const p of this.pending) this.ledger.merge(changes, p.changes);
    this.confirmed = this.ledger.clone(this.base);
    this.pending = [];
    this.commit(
      keep.map((p) => ({ block: p, events: p.events })),
      head,
      changes,
    );
  }

  private async finalizedHead(latest: Header): Promise<Tip> {
    const { finalityDepth } = this.options;
    if (finalityDepth === undefined)
      return header(await this.client.getBlock({ blockTag: "finalized" }));
    const number = latest.number - finalityDepth;
    return header(await this.client.getBlock({ blockNumber: number > 0n ? number : 0n }));
  }

  /** Returns whether the finalized head advanced. */
  private async advanceFinality(latest: Header) {
    const finalized = await this.finalizedHead(latest);
    if (finalized.number <= this.base.block) return false;
    // Past the finalized block, the tip has already applied the range: compare what it saw.
    const covered = this.head.number > finalized.number;
    const seen: E[] = [];
    const changes = this.ledger.touched();
    const stamps = new Map(this.pending.map((p) => [p.hash, p.timestamp]));
    for await (const chunk of this.chunks(this.base.block, finalized.number)) {
      const events = (await this.blocksOf(chunk.logs, stamps)).flatMap((b) => b.events);
      if (covered) seen.push(...events);
      this.finalize(
        events,
        chunk.to === finalized.number
          ? finalized
          : { number: chunk.to, hash: "0x", timestamp: this.base.timestamp },
        changes,
      );
      // Long catch-ups must not starve request handling.
      await new Promise((resolve) => setImmediate(resolve));
    }
    const final = this.pending.filter((p) => p.number <= finalized.number);
    const keep = this.pending.filter((p) => p.number > finalized.number);
    if (covered && fingerprint(seen) === fingerprint(final.flatMap((p) => p.events))) {
      this.pending = keep;
      return true;
    }
    // The tip missed or misread events: stop trusting empty blooms from here on.
    if (covered) this.emptyBloom = "revoked";
    this.rebuildTip(keep, covered ? this.head : finalized, changes);
    return true;
  }

  private finalize(events: E[], tip: Tip, changes: C) {
    const ledger = this.ledger;
    const trades = new Map<string, D>();
    const own = ledger.touched();
    for (const batch of byTransaction(events)) {
      ledger.apply(this.base, batch, own);
      // Orders stay in the replica until evicted below, so both parties resolve.
      this.detail(this.base, batch, trades);
    }
    ledger.merge(changes, own);
    this.base.block = tip.number;
    this.base.hash = tip.hash;
    this.base.timestamp = tip.timestamp;
    const closed = ledger.evict?.(this.base, this.confirmed, own, tip.number) ?? [];
    if (closed.length) this.revision++;
    this.options.onFinalized?.({
      block: tip.number,
      hash: tip.hash,
      base: this.base,
      events,
      trades,
      closed,
    });
  }

  /** Ranged eth_getLogs over (from, to]: several chunks in flight, yielded in chain order. */
  private async *chunks(from: bigint, to: bigint) {
    const inflight: Promise<{ to: bigint; logs: Log[] }>[] = [];
    let next = from + 1n;
    while (next <= to || inflight.length) {
      while (inflight.length < LOG_CONCURRENCY && next <= to) {
        const start = next;
        const end = start + this.range - 1n < to ? start + this.range - 1n : to;
        next = end + 1n;
        const request = this.logs(start, end).then((logs) => ({ to: end, logs }));
        request.catch(() => {}); // Surfaced when awaited below.
        inflight.push(request);
      }
      yield await inflight.shift()!;
    }
  }

  /** One ranged request, split when the provider rejects its span. Sparse results widen later
   * requests, up to any limit the provider stated and below any span it refused. */
  private async logs(from: bigint, to: bigint): Promise<Log[]> {
    const span = to - from + 1n;
    try {
      const logs = await this.client.getLogs({
        address: this.filter,
        fromBlock: from,
        toBlock: to,
      });
      if (span >= this.range && logs.length < 1_000) {
        // Below a known limit, halfway to it, so the range settles there in a few requests.
        const wider =
          this.maxRange < MAX_LOG_RANGE
            ? this.range + (this.maxRange - this.range + 1n) / 2n
            : this.range + this.range / 2n;
        this.range = wider < this.maxRange ? wider : this.maxRange;
      }
      return logs;
    } catch (error) {
      const limit = logRangeLimit(error, span);
      if (limit === undefined || span <= 1n) throw error;
      const size = limit.blocks > 0n && limit.blocks < span ? limit.blocks : span / 2n;
      // A stated limit caps every later request; an unstated one rules out this span.
      const cap = limit.stated ? size : span - 1n;
      if (cap < this.maxRange) this.maxRange = cap;
      if (size < this.range) this.range = size;
      // The parts follow the range as other requests refine it, never exceeding `size`.
      const parts: Log[] = [];
      for (let start = from; start <= to; ) {
        const step = this.range < size ? this.range : size;
        const end = start + step - 1n < to ? start + step - 1n : to;
        parts.push(...(await this.logs(start, end)));
        start = end + 1n;
      }
      return parts;
    }
  }

  /** Decoded protocol events grouped by block, in chain order. Timestamps come from the logs
   * when the node includes them, then from known headers, then from one header per block. */
  private async blocksOf(logs: Log[], stamps: Map<Hex, bigint>): Promise<BlockEvents<E>[]> {
    const live = logs.filter((log) => !log.removed);
    // Some nodes (Robinhood Chain's) send `blockTimestamp: "0x0"` in logs: zero means unknown.
    const stamped = (log: Log) => {
      const stamp = (log as Log & { blockTimestamp?: Hex | bigint }).blockTimestamp;
      return stamp === undefined || BigInt(stamp) === 0n ? undefined : stamp;
    };
    const missing = [
      ...new Set(
        live
          .filter((log) => stamped(log) === undefined && !stamps.has(log.blockHash!))
          .map((log) => log.blockHash!),
      ),
    ];
    for (const block of await mapLimit(missing, HEADER_CONCURRENCY, (blockHash) =>
      this.client.getBlock({ blockHash }),
    ))
      stamps.set(block.hash, block.timestamp);
    live.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex! - b.logIndex!
        : a.blockNumber! < b.blockNumber!
          ? -1
          : 1,
    );
    const blocks: BlockEvents<E>[] = [];
    for (const log of live) {
      let last = blocks.at(-1);
      if (
        last &&
        last.block.number === log.blockNumber &&
        last.events.at(-1)!.logIndex === log.logIndex
      )
        continue; // Duplicate log.
      const stamp = stamped(log);
      const timestamp = stamp === undefined ? stamps.get(log.blockHash!)! : BigInt(stamp);
      if (!last || last.block.number !== log.blockNumber) {
        last = { block: { number: log.blockNumber!, hash: log.blockHash!, timestamp }, events: [] };
        blocks.push(last);
      }
      last.events.push(this.ledger.decode(log, timestamp));
    }
    return blocks;
  }
}
