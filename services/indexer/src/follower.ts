/** Live chain index over JSON-RPC.
 *
 * Two in-memory replicas of the exchange ledger (`@conditional-stocks/evm-client/ledger`):
 * - confirmed: the chain tip. Trading reads (markets, books, orders, streams, order planning) and
 *   wallet views use it.
 * - base: the finalized block. Its events and closed orders are persisted, and a periodic
 *   checkpoint of it makes restarts replay only recent events.
 *
 * Tip: each poll is one header request. A head linked to the tip by parentHash needs no reorg
 * check, its logsBloom decides whether eth_getLogs is needed at all, and logs are read by block
 * hash so they belong to exactly that block. Gaps of up to 50 blocks are filled by header and
 * checked for linkage; larger gaps (downtime) use ranged eth_getLogs. A head behind the tip (a
 * lagging endpoint) is ignored; a broken link rebuilds the tip from the base.
 *
 * Finality: finalized ranges are read again with ranged eth_getLogs, in parallel chunks sized to
 * what the provider accepts, so persisted history never depends on what the tip saw. When the
 * two differ, the tip is rebuilt. */
import type { Database, StoredEvent } from "@conditional-stocks/db";
import {
  applyTransaction,
  type ChainState,
  cloneState,
  type DecodedEvent,
  decodeLog,
  deserializeState,
  emptyState,
  type OrderState,
  serializeState,
  type Touched,
  type TradeDetails,
  touched,
  tradeDetails,
  transactions,
} from "@conditional-stocks/evm-client/ledger";
import { type Address, getAddress, type Hex, type Log, type PublicClient } from "viem";
import { logRangeLimit, mapLimit, mayContain } from "./rpc.ts";

export interface CommitNotice {
  block: bigint;
  state: ChainState;
  changes: Touched;
  events: DecodedEvent[];
  trades: Map<string, TradeDetails>;
  /** The tip was rebuilt from the base: events after the base block were replaced. */
  rebuilt: boolean;
}
export interface FinalizedNotice {
  block: bigint;
  hash: Hex;
  base: ChainState;
  events: DecodedEvent[];
  /** Execution details of each Trade (resolved while replaying), by `${block}:${logIndex}`. */
  trades: Map<string, TradeDetails>;
  /** Orders closed at or before `block`: final, already evicted from both replicas. */
  closed: OrderState[];
}
export interface FollowerOptions {
  client: PublicClient;
  exchange: Address;
  quote: Address;
  deploymentBlock: bigint;
  domain: string;
  db?: Pick<Database, "checkpoint" | "eventsAfter" | "lastEventBlock">;
  /** Head polling interval (default 1 s). */
  pollMs?: number;
  /** Interval between reads of the finalized block (default 15 s). */
  finalityMs?: number;
  /** Initial eth_getLogs block span; it adapts to what the provider accepts. */
  logRange?: bigint;
  /** Blocks behind the head treated as final, for an RPC without the `finalized` tag. */
  finalityDepth?: bigint;
  onCommit?(notice: CommitNotice): void;
  /** Called in order and synchronously: persistence must not hold up the follower. */
  onFinalized?(notice: FinalizedNotice): void;
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
interface PendingBlock extends Tip {
  events: DecodedEvent[];
  changes: Touched;
}
interface BlockEvents {
  block: Tip;
  events: DecodedEvent[];
}

/** Largest gap filled header by header; beyond it the tip catches up with ranged eth_getLogs. */
const MAX_GAP = 50n;
const LOG_CONCURRENCY = 4;
const HEADER_CONCURRENCY = 32;
const MAX_LOG_RANGE = 100_000n;

const tradeKey = (e: DecodedEvent) => `${e.block}:${e.logIndex}`;
const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const fingerprint = (events: DecodedEvent[]) =>
  events.map((e) => `${tradeKey(e)}:${e.transactionHash}:${e.name}:${json(e.args)}`).join("|");
const merge = (into: Touched, from: Touched) => {
  for (const key of ["markets", "owners", "orders"] as const)
    for (const value of from[key]) (into[key] as Set<unknown>).add(value);
};
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

export class ChainFollower {
  base: ChainState;
  confirmed: ChainState;
  ready = false;
  /** Unfinalized blocks with protocol events, applied to the confirmed replica. */
  private pending: PendingBlock[] = [];
  private head: Tip;
  private range: bigint;
  /** Span limit a provider stated in an error. */
  private maxRange = MAX_LOG_RANGE;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private running: Promise<void> = Promise.resolve();
  private lastSuccess = 0;
  private finalityDue = 0;

  constructor(readonly options: FollowerOptions) {
    this.base = emptyState(options.quote);
    this.base.block = options.deploymentBlock - 1n;
    this.confirmed = this.base;
    this.head = this.baseTip();
    this.range = options.logRange ?? 2_000n;
  }

  health() {
    const age = this.lastSuccess ? Date.now() - this.lastSuccess : Number.POSITIVE_INFINITY;
    return {
      healthy: this.ready && age < Math.max(15_000, (this.options.pollMs ?? 1_000) * 10),
      confirmedBlock: this.confirmed.block,
      finalizedBlock: this.base.block,
      lagMs: age,
    };
  }

  async start() {
    const { db, domain } = this.options;
    const checkpoint = await db?.checkpoint(domain);
    if (checkpoint) {
      const restored = deserializeState(checkpoint.state);
      if (getAddress(restored.quote) !== getAddress(this.options.quote))
        throw new Error("Checkpoint belongs to another deployment");
      this.base = restored;
    }
    // Finalized events persisted after the checkpoint replay from the database, not the RPC.
    if (db) {
      const last = await db.lastEventBlock(domain);
      if (last !== null && last > this.base.block) {
        for (const batch of transactions(
          (await db.eventsAfter(domain, this.base.block, last)).map(storedEvent),
        ))
          applyTransaction(this.base, batch);
        this.base.block = last;
      }
    }
    this.confirmed = cloneState(this.base);
    this.head = this.baseTip();
    await this.tick();
    this.ready = true;
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Waits for an in-flight poll (shutdown). */
  drain() {
    return this.running;
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .catch((error) => this.options.onError?.(error))
        .finally(() => this.schedule());
    }, this.options.pollMs ?? 1_000);
  }

  private baseTip(): Tip {
    return { number: this.base.block, hash: this.base.hash, timestamp: this.base.timestamp };
  }

  async tick() {
    const latest = header(await this.options.client.getBlock());
    if (Date.now() >= this.finalityDue || latest.number - this.head.number > MAX_GAP) {
      this.finalityDue = Date.now() + (this.options.finalityMs ?? 15_000);
      const before = this.base.block;
      try {
        await this.advanceFinality(latest);
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
    await this.advanceTip(latest);
    this.lastSuccess = Date.now();
  }

  private async advanceTip(latest: Header): Promise<void> {
    const { client, exchange } = this.options;
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
    if (gap > MAX_GAP) {
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
      events:
        h.transactions.length && mayContain(h.logsBloom, exchange) ? await this.blockEvents(h) : [],
    }));
    this.commit(blocks, latest);
  }

  /** Protocol events of one block, read by its hash. */
  private async blockEvents(block: Header) {
    const logs = await this.options.client.getLogs({
      address: this.options.exchange,
      blockHash: block.hash,
    });
    if (logs.some((log) => log.blockHash !== block.hash || log.blockNumber !== block.number))
      throw new Error("Logs do not belong to the requested block");
    return (await this.blocksOf(logs, new Map([[block.hash, block.timestamp]])))[0]?.events ?? [];
  }

  /** Applies blocks of events to the confirmed replica and moves the tip to `head`. */
  private commit(blocks: BlockEvents[], head: Tip, reset?: Touched) {
    const changes = reset ?? touched();
    const events: DecodedEvent[] = [];
    const trades = new Map<string, TradeDetails>();
    for (const { block, events: list } of blocks) {
      if (!list.length || block.number <= this.base.block) continue;
      const own = touched();
      for (const batch of transactions(list)) {
        applyTransaction(this.confirmed, batch, own);
        for (const e of batch)
          if (e.name === "Trade") trades.set(tradeKey(e), tradeDetails(this.confirmed, e));
      }
      merge(changes, own);
      this.pending.push({ ...block, events: list, changes: own });
      events.push(...list);
    }
    this.head = { number: head.number, hash: head.hash, timestamp: head.timestamp };
    this.confirmed.block = head.number;
    this.confirmed.hash = head.hash;
    this.confirmed.timestamp = head.timestamp;
    this.options.onCommit?.({
      block: head.number,
      state: this.confirmed,
      changes,
      events,
      trades,
      rebuilt: reset !== undefined,
    });
  }

  /** Rebuilds the tip from the base, re-applying the still-valid unfinalized blocks. */
  private rebuildTip(keep: PendingBlock[], head: Tip, changes = touched()) {
    for (const p of this.pending) merge(changes, p.changes);
    this.confirmed = cloneState(this.base);
    this.pending = [];
    this.commit(
      keep.map((p) => ({ block: p, events: p.events })),
      head,
      changes,
    );
  }

  private async finalizedHead(latest: Header): Promise<Tip> {
    const { client, finalityDepth } = this.options;
    if (finalityDepth === undefined)
      return header(await client.getBlock({ blockTag: "finalized" }));
    const number = latest.number - finalityDepth;
    return header(await client.getBlock({ blockNumber: number > 0n ? number : 0n }));
  }

  private async advanceFinality(latest: Header) {
    const finalized = await this.finalizedHead(latest);
    if (finalized.number <= this.base.block) return;
    // Past the finalized block, the tip has already applied the range: compare what it saw.
    const covered = this.head.number > finalized.number;
    const seen: DecodedEvent[] = [];
    const changes = touched();
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
      return;
    }
    this.rebuildTip(keep, covered ? this.head : finalized, changes);
  }

  private finalize(events: DecodedEvent[], tip: Tip, changes: Touched) {
    const trades = new Map<string, TradeDetails>();
    for (const batch of transactions(events)) {
      applyTransaction(this.base, batch, changes);
      // Orders stay in the replica until evicted below, so both parties resolve.
      for (const e of batch)
        if (e.name === "Trade") trades.set(tradeKey(e), tradeDetails(this.base, e));
    }
    this.base.block = tip.number;
    this.base.hash = tip.hash;
    this.base.timestamp = tip.timestamp;
    // Closed orders are final: they move to persisted history and leave both replicas.
    const closed: OrderState[] = [];
    for (const [key, order] of this.base.orders)
      if (order.status !== "open" && order.updatedBlock <= tip.number) {
        closed.push(order);
        this.base.orders.delete(key);
        this.confirmed.orders.delete(key);
      }
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
   * requests, up to any limit the provider stated. */
  private async logs(from: bigint, to: bigint): Promise<Log[]> {
    const span = to - from + 1n;
    try {
      const logs = await this.options.client.getLogs({
        address: this.options.exchange,
        fromBlock: from,
        toBlock: to,
      });
      if (span >= this.range && logs.length < 1_000) {
        const wider = this.range + this.range / 2n;
        this.range = wider < this.maxRange ? wider : this.maxRange;
      }
      return logs;
    } catch (error) {
      const limit = logRangeLimit(error, span);
      if (limit === undefined || span <= 1n) throw error;
      const size = limit.blocks > 0n && limit.blocks < span ? limit.blocks : span / 2n;
      if (limit.stated && size < this.maxRange) this.maxRange = size;
      if (size < this.range) this.range = size;
      const parts: Log[] = [];
      for (let start = from; start <= to; start += size)
        parts.push(...(await this.logs(start, start + size - 1n < to ? start + size - 1n : to)));
      return parts;
    }
  }

  /** Decoded protocol events grouped by block, in chain order. Timestamps come from the logs
   * when the node includes them, then from known headers, then from one header per block. */
  private async blocksOf(logs: Log[], stamps: Map<Hex, bigint>): Promise<BlockEvents[]> {
    const live = logs.filter((log) => !log.removed);
    const stamped = (log: Log) => (log as Log & { blockTimestamp?: Hex | bigint }).blockTimestamp;
    const missing = [
      ...new Set(
        live
          .filter((log) => stamped(log) === undefined && !stamps.has(log.blockHash!))
          .map((log) => log.blockHash!),
      ),
    ];
    for (const block of await mapLimit(missing, HEADER_CONCURRENCY, (blockHash) =>
      this.options.client.getBlock({ blockHash }),
    ))
      stamps.set(block.hash, block.timestamp);
    live.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex! - b.logIndex!
        : a.blockNumber! < b.blockNumber!
          ? -1
          : 1,
    );
    const blocks: BlockEvents[] = [];
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
      last.events.push(decodeLog(log, timestamp));
    }
    return blocks;
  }
}

/** Persisted form of an event. Integer fields are decimal strings; addresses stay checksummed. */
export function storedFromDecoded(e: DecodedEvent, trade?: TradeDetails): StoredEvent {
  const args = e.args;
  const owner = trade
    ? trade.taker
    : typeof args.owner === "string"
      ? args.owner
      : typeof args.from === "string"
        ? args.from
        : null;
  return {
    block: e.block.toString(),
    log_index: e.logIndex,
    tx: e.transactionHash,
    block_time: e.timestamp.toString(),
    name: e.name,
    market: args.market === undefined ? null : Number(args.market),
    owner: owner || null,
    counterparty: trade?.maker ?? null,
    data: trade
      ? { ...(JSON.parse(json(args)) as Record<string, unknown>), trade }
      : JSON.parse(json(args)),
  };
}

/** Rebuilds a decoded event from its stored JSON (the replica parses decimal strings). */
export function storedEvent(row: StoredEvent): DecodedEvent {
  return {
    name: row.name,
    args: row.data,
    block: BigInt(row.block),
    timestamp: BigInt(row.block_time),
    logIndex: row.log_index,
    transactionHash: row.tx as Hex,
  };
}

export { serializeState };
