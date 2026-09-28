/** Live chain index over JSON-RPC.
 *
 * Two in-memory replicas of the exchange ledger (`@conditional-stocks/evm-client/ledger`):
 * - confirmed: the latest head, updated as soon as a new block with protocol logs is seen.
 *   Trading reads (markets, books, orders, streams, order planning) and wallet views use it.
 * - base (finalized): the finalized block. Its events and closed orders are persisted, and a
 *   periodic checkpoint of it makes restarts replay only recent events.
 * A reorg of the unfinalized range rebuilds the confirmed view from the base. Polling uses one
 * batched RPC round trip per interval; logs are requested only when the head advanced. */
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

export interface CommitNotice {
  block: bigint;
  state: ChainState;
  changes: Touched;
  events: DecodedEvent[];
  trades: Map<string, TradeDetails>;
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
  pollMs?: number;
  /** Maximum eth_getLogs block span; halved automatically when a provider rejects it. */
  logRange?: bigint;
  /** Blocks behind the head treated as final when the node has no `finalized` tag. */
  finalityDepth?: bigint;
  onCommit?(notice: CommitNotice): void;
  onFinalized?(notice: FinalizedNotice): Promise<void>;
  onError?(error: unknown): void;
}

interface PendingBlock {
  block: bigint;
  events: DecodedEvent[];
}

export class ChainFollower {
  base: ChainState;
  confirmed: ChainState;
  private pending: PendingBlock[] = [];
  private head = { number: 0n, hash: "0x" as Hex };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private lastSuccess = 0;
  private range: bigint;
  private finalizing: Promise<void> = Promise.resolve();
  ready = false;

  constructor(readonly options: FollowerOptions) {
    this.base = emptyState(options.quote);
    this.base.block = options.deploymentBlock - 1n;
    this.confirmed = this.base;
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
    const finalized = await this.finalizedHead();
    await this.catchUp(finalized);
    this.confirmed = cloneState(this.base);
    await this.poll();
    this.ready = true;
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Waits for in-flight finalized persistence (shutdown). */
  drain() {
    return this.finalizing;
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        await this.poll();
      } catch (error) {
        this.options.onError?.(error);
      }
      this.schedule();
    }, this.options.pollMs ?? 1_000);
  }

  private async finalizedHead() {
    const { client } = this.options;
    try {
      const block = await client.getBlock({ blockTag: "finalized" });
      return { number: block.number, hash: block.hash };
    } catch {
      const latest = await client.getBlockNumber();
      const number = latest - (this.options.finalityDepth ?? 64n);
      const block = await client.getBlock({ blockNumber: number > 0n ? number : 0n });
      return { number: block.number, hash: block.hash };
    }
  }

  /** Decoded protocol events of (from, to], in chain order. */
  private async events(from: bigint, to: bigint): Promise<DecodedEvent[]> {
    const { client, exchange } = this.options;
    const logs: Log[] = [];
    let start = from + 1n;
    while (start <= to) {
      const end = start + this.range - 1n < to ? start + this.range - 1n : to;
      try {
        logs.push(...(await client.getLogs({ address: exchange, fromBlock: start, toBlock: end })));
        start = end + 1n;
      } catch (error) {
        if (this.range <= 1n) throw error;
        this.range /= 2n;
      }
    }
    const times = new Map<bigint, bigint>();
    for (const log of logs) {
      const stamped = (log as Log & { blockTimestamp?: Hex | bigint }).blockTimestamp;
      if (stamped !== undefined) times.set(log.blockNumber!, BigInt(stamped));
    }
    const missing = [...new Set(logs.map((log) => log.blockNumber!))].filter((n) => !times.has(n));
    const blocks = await Promise.all(
      missing.map((blockNumber) => client.getBlock({ blockNumber })),
    );
    for (const block of blocks) times.set(block.number, block.timestamp);
    return logs
      .filter((log) => !log.removed)
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? a.logIndex! - b.logIndex!
          : a.blockNumber! < b.blockNumber!
            ? -1
            : 1,
      )
      .map((log) => decodeLog(log, times.get(log.blockNumber!)!));
  }

  /** Brings the finalized base to `finalized`, persisting in bounded batches. */
  private async catchUp(finalized: { number: bigint; hash: Hex }) {
    const step = 50_000n;
    while (this.base.block < finalized.number) {
      const to =
        this.base.block + step < finalized.number ? this.base.block + step : finalized.number;
      const events = await this.events(this.base.block, to);
      await this.finalize(events, to, to === finalized.number ? finalized.hash : "0x");
    }
  }

  private async finalize(events: DecodedEvent[], block: bigint, hash: Hex) {
    const trades = new Map<string, TradeDetails>();
    for (const batch of transactions(events)) {
      applyTransaction(this.base, batch);
      // Orders stay in the replica until evicted below, so both parties resolve.
      for (const e of batch)
        if (e.name === "Trade") trades.set(`${e.block}:${e.logIndex}`, tradeDetails(this.base, e));
    }
    this.base.block = block;
    this.base.hash = hash;
    // Closed orders are final: they move to persisted history and leave both replicas.
    const closed: OrderState[] = [];
    for (const [key, order] of this.base.orders)
      if (order.status !== "open" && order.updatedBlock <= block) {
        closed.push(order);
        this.base.orders.delete(key);
        this.confirmed.orders.delete(key);
      }
    const notice = { block, hash, base: this.base, events, trades, closed };
    const run = this.finalizing.then(() => this.options.onFinalized?.(notice));
    this.finalizing = run.catch(() => {});
    await run;
  }

  async poll() {
    const { client } = this.options;
    const [latest, previous] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      this.head.number > 0n
        ? client.getBlock({ blockNumber: this.head.number })
        : Promise.resolve(null),
    ]);
    this.lastSuccess = Date.now();
    if (previous && previous.hash !== this.head.hash) {
      // Reorg below the head: rebuild the unfinalized view from the finalized base.
      this.pending = [];
      this.confirmed = cloneState(this.base);
      this.head = { number: this.base.block, hash: this.base.hash };
    }
    const from = this.head.number > this.confirmed.block ? this.head.number : this.confirmed.block;
    if (latest.number > from) {
      const events = await this.events(from, latest.number);
      const changes = touched();
      const trades = new Map<string, TradeDetails>();
      for (const batch of transactions(events)) {
        applyTransaction(this.confirmed, batch, changes);
        for (const e of batch)
          if (e.name === "Trade")
            trades.set(`${e.block}:${e.logIndex}`, tradeDetails(this.confirmed, e));
      }
      const byBlock = new Map<bigint, DecodedEvent[]>();
      for (const e of events) byBlock.set(e.block, [...(byBlock.get(e.block) ?? []), e]);
      for (const [block, list] of byBlock) this.pending.push({ block, events: list });
      this.confirmed.block = latest.number;
      this.confirmed.hash = latest.hash;
      this.confirmed.timestamp = latest.timestamp;
      this.head = { number: latest.number, hash: latest.hash };
      this.options.onCommit?.({
        block: latest.number,
        state: this.confirmed,
        changes,
        events,
        trades,
      });
    } else if (latest.number === this.head.number && latest.hash !== this.head.hash) {
      this.head = { number: 0n, hash: "0x" };
    }
    await this.advanceFinality();
  }

  private lastFinalityCheck = 0;
  private async advanceFinality() {
    if (Date.now() - this.lastFinalityCheck < 4_000) return;
    this.lastFinalityCheck = Date.now();
    const finalized = await this.finalizedHead();
    if (finalized.number <= this.base.block) return;
    if (finalized.number > this.confirmed.block) {
      await this.catchUp(finalized);
      this.confirmed = cloneState(this.base);
      this.pending = [];
      return;
    }
    const final = this.pending.filter((p) => p.block <= finalized.number);
    this.pending = this.pending.filter((p) => p.block > finalized.number);
    await this.finalize(
      final.flatMap((p) => p.events),
      finalized.number,
      finalized.hash,
    );
  }
}

const jsonArgs = (args: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Record<
    string,
    unknown
  >;

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
    data: trade ? { ...jsonArgs(args), trade } : jsonArgs(args),
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
