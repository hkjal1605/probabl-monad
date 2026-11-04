/** The world books' side of automation (docs/version-2-plan.md §10.4), on the API's world
 * evidence flow: every transaction the API previews is rebuilt locally from the approved packet
 * and the live chain, and signed only when both agree, as the exchange's are.
 *
 * - Curated books from `AUTOMATION_WORLDS_PATH`: each entry's next fixing and strikes around
 *   spot, created once.
 * - Event results: freeze when the venue settles (or its market closes), commit the venue's
 *   result as the market admin, resolve as the resolution admin.
 * - Fixings: propose the provably last feed round at or before each due fixing, finalize it
 *   after the window, and report a fixing that needs the two-key fallback. */
import {
  eventOracleAbi,
  eventOracleCalls,
  FIX_WINDOW,
  reasonOf,
  worldBooksAbi,
  worldBooksCalls,
} from "@conditional-stocks/evm-client";
import type { AdminTransaction } from "@conditional-stocks/evm-client/admin";
import {
  type WorldAdminDeployment,
  worldEvidenceTransaction,
  worldMetadataUri,
} from "@conditional-stocks/evm-client/world-admin";
import type { WorldEvidenceEnvelope } from "@conditional-stocks/market-data";
import { type Address, getAddress, type Hex, type PublicClient, parseAbi } from "viem";
import type { Admin, Snapshot } from "./admin.ts";

/** World review checklists (apps/server/src/worlds/admin.ts). */
const CHECKS = {
  "book-creation": [
    "legs-and-orientation",
    "rules-and-dates",
    "feed-and-strikes",
    "fee",
    "sources",
  ],
  "event-resolution": ["event-key", "orientation", "final-status", "polygon-reference", "outcome"],
  "book-fixing": ["held-or-overdue", "feed-rounds", "price", "sources"],
} as const;
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
]);

/** A book as the API's `/v2/books` lists it (the fields automation reads). */
export interface WorldBookView {
  id: number;
  defHash: Hex;
  title: string | null;
  state: string;
  feed: Address | null;
  feedDecimals: number | null;
  underlying: string | null;
  fixingTime: string | null;
  maxStaleness: number;
  cutoff: string;
  legs: {
    eventKey: Hex;
    wantYes: boolean;
    state: string;
    venue: {
      source: "polymarket" | "kalshi";
      marketId: string;
      conditionId: Hex;
      yesIndex: number;
      noIndex: number;
      endTime: string;
    } | null;
  }[];
  fixing: {
    proposal: { proposedAt: string; roundId: string } | null;
    held: boolean;
    fallbackAt: string | null;
  };
}
export interface WorldEvidence {
  envelope: WorldEvidenceEnvelope;
  status: "prepared" | "approved" | "rejected";
  observations: { action?: string }[];
}

export class WorldAdmin {
  constructor(
    readonly options: {
      admin: Admin;
      client: PublicClient;
      books: Address;
      /** The API's world metadata base (`WORLD_METADATA_BASE_URL`), to rebuild book URIs. */
      metadataBase: string;
      /** The market admin's address (it signs freezes, proposals and finalizations). */
      sender: Address;
    },
  ) {}

  private request<T>(path: string, body?: unknown) {
    return this.options.admin.request<T>(path, body);
  }
  async books() {
    return (await this.request<{ books: WorldBookView[] }>("/v2/books")).books;
  }
  evidence() {
    return this.request<{ packets: WorldEvidence[] }>("/v2/admin/evidence").then((r) => r.packets);
  }
  prepareBook(body: Record<string, unknown>) {
    return this.request<
      WorldEvidence & { defHash: Hex; metadataUri: string; existing: number | null }
    >("/v2/admin/books/prepare", body);
  }
  prepareResolution(key: Hex, body: Record<string, unknown>) {
    return this.request<WorldEvidence>(`/v2/admin/events/${key}/resolution/prepare`, body);
  }
  /** The ingestor's latest snapshot of an event's venue market. */
  snapshot(key: Hex) {
    return this.request<Snapshot>(`/v2/admin/events/${key}/snapshot`);
  }
  fetchMetadata(source: "polymarket" | "kalshi", marketId: string) {
    return this.options.admin.fetchMetadata(source, marketId);
  }
  approve(evidence: WorldEvidence, notes: string) {
    const checks = CHECKS[evidence.envelope.packet.kind];
    return this.request<WorldEvidence>(
      `/v2/admin/evidence/${evidence.envelope.packetHash}/review`,
      {
        decision: "approve",
        checklist: Object.fromEntries(checks.map((key) => [key, true])),
        notes,
      },
    );
  }

  /** The world deployment's roles, read from the chain. */
  async deployment(): Promise<WorldAdminDeployment> {
    const { client, books } = this.options;
    const [roles, oracle] = await Promise.all([
      client.readContract({ address: books, abi: worldBooksAbi, functionName: "roles" }),
      client.readContract({ address: books, abi: worldBooksAbi, functionName: "oracle" }),
    ]);
    const oracleRoles = await client.readContract({
      address: oracle,
      abi: eventOracleAbi,
      functionName: "roles",
    });
    return {
      chainId: client.chain!.id,
      books,
      oracle,
      bookAdmin: roles[0],
      booksResolutionAdmin: roles[2],
      marketAdmin: oracleRoles[0],
      oracleResolutionAdmin: oracleRoles[2],
      metadataBase: this.options.metadataBase,
    };
  }

  /** Executes the next action an approved packet authorizes, after rebuilding it locally, and
   * reconciles it with the API. */
  async execute(evidence: WorldEvidence) {
    const hash = evidence.envelope.packetHash;
    const preview = await this.request<
      AdminTransaction & { action: Parameters<typeof worldEvidenceTransaction>[1] }
    >(`/v2/admin/evidence/${hash}/transaction`, {});
    const local = worldEvidenceTransaction(
      evidence.envelope,
      preview.action,
      await this.deployment(),
    );
    if (
      getAddress(local.to) !== getAddress(preview.to) ||
      local.data.toLowerCase() !== preview.data.toLowerCase() ||
      getAddress(local.from) !== getAddress(preview.from)
    )
      throw new Error("The API preview differs from the locally built transaction");
    const transactionHash = await this.options.admin.send(local);
    for (let attempt = 1; ; attempt++) {
      try {
        await this.request(`/v2/admin/evidence/${hash}/reconcile`, {
          action: preview.action,
          transactionHash,
        });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await Bun.sleep(2_000 * attempt);
      }
    }
    return { action: preview.action, transactionHash };
  }

  /** A transaction the market admin sends directly (freezes, fixing proposals). */
  private async direct(to: { to: Address; data: Hex }) {
    return this.options.admin.send({
      to: to.to,
      data: to.data,
      value: "0",
      from: this.options.sender,
      chainId: this.options.client.chain!.id,
    });
  }
  async freeze(key: Hex, reason: string) {
    const oracle = (await this.deployment()).oracle;
    return this.direct(eventOracleCalls(oracle).freeze(key, reasonOf(reason)));
  }
  proposeFix(book: number, roundId: bigint) {
    return this.direct(worldBooksCalls(this.options.books).proposeFix(BigInt(book), roundId));
  }
  finalizeFix(book: number) {
    return this.direct(worldBooksCalls(this.options.books).finalizeFix(BigInt(book)));
  }

  /** The provably last round of `feed` at or before `fixingTime` within `maxStaleness`, as
   * `proposeFix` requires (the latest round, or one whose successor is later), or null. Round
   * ids are searched by bisection; a gap in the ids makes the round unprovable. */
  async fixingRound(feed: Address, fixingTime: number, maxStaleness: number) {
    const { client } = this.options;
    const round = async (id: bigint) => {
      try {
        const r = (await client.readContract({
          address: feed,
          abi: feedAbi,
          functionName: "getRoundData",
          args: [id],
        })) as readonly bigint[];
        return { id, answer: r[1]!, updatedAt: Number(r[3]!) };
      } catch {
        return null;
      }
    };
    const latest = (await client.readContract({
      address: feed,
      abi: feedAbi,
      functionName: "latestRoundData",
    })) as readonly bigint[];
    let candidate: { id: bigint; answer: bigint; updatedAt: number } | null = null;
    if (Number(latest[3]!) <= fixingTime)
      candidate = { id: latest[0]!, answer: latest[1]!, updatedAt: Number(latest[3]!) };
    else {
      let lo = latest[0]! > 1000n ? latest[0]! - 1000n : 1n,
        hi = latest[0]!;
      while (lo < hi) {
        const mid = (lo + hi + 1n) / 2n;
        const r = await round(mid);
        if (r && r.updatedAt <= fixingTime) lo = mid;
        else hi = mid - 1n;
      }
      const r = await round(lo);
      const next = await round(lo + 1n);
      if (r && r.updatedAt <= fixingTime && next && next.updatedAt > fixingTime) candidate = r;
    }
    if (!candidate || candidate.answer <= 0n || candidate.updatedAt + maxStaleness < fixingTime)
      return null;
    return candidate;
  }
}

/** A curated world: its legs, and the rule that sets each new book's fixing and strikes. */
export interface CuratedWorld {
  title: string;
  legs: {
    source: "polymarket" | "kalshi";
    marketId: string;
    wantYes?: boolean;
    themes?: string[];
  }[];
  /** e.g. "US:NVDA" with its feed; omitted for an event-only world. */
  underlying?: string;
  feed?: Address;
  /** The next fixing: a weekday's time in a time zone (e.g. Friday 16:00 New York), or an
   * absolute time. */
  fixing?: { weekday?: number; time?: string; timeZone?: string; at?: string };
  /** Strikes at these percentages around spot, rounded to `tick` (feed units). */
  strikes?: { percents: number[]; tick: string };
  /** The cutoff this long before the fixing (default one hour), or an event-only book's. */
  cutoffBefore?: number;
  cutoffAt?: string;
  maxStaleness?: number;
  feeBps: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The next time `weekday` (0 Sunday) at `time` (HH:MM) in `timeZone` after `now` (seconds).
 * Every zone's offset is a whole number of quarter hours, so the candidates are the UTC times
 * with `time`'s minute modulo 15, checked against the zone's clock. */
export function nextWeekly(now: number, weekday: number, time: string, timeZone: string) {
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = now + 15 * 86_400;
  for (let t = Math.floor(now / 900) * 900 + (mm % 15) * 60; t < end; t += 900) {
    if (t <= now) continue;
    const p = Object.fromEntries(
      clock.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]),
    );
    if (
      WEEKDAYS.indexOf(p.weekday!) === weekday &&
      Number(p.hour) === hh &&
      Number(p.minute) === mm
    )
      return t;
  }
  throw new Error("No such weekly time in the next two weeks");
}

/** The prepare request of a curated world's next book, from the feed's current price. */
export async function curatedBook(world: CuratedWorld, client: PublicClient, nowS: number) {
  const book: Record<string, unknown> = { feeBps: String(world.feeBps) };
  if (world.feed) {
    if (!world.underlying || !world.strikes || !world.fixing)
      throw new Error(`${world.title}: a priced world needs underlying, strikes and fixing`);
    // The first weekly fixing whose cutoff is still ahead: past a book's cutoff, the next one.
    const fixing = world.fixing.at
      ? Math.floor(Date.parse(world.fixing.at) / 1000)
      : nextWeekly(
          nowS + (world.cutoffBefore ?? 3_600),
          world.fixing.weekday ?? 5,
          world.fixing.time ?? "16:00",
          world.fixing.timeZone ?? "America/New_York",
        );
    const latest = (await client.readContract({
      address: world.feed,
      abi: feedAbi,
      functionName: "latestRoundData",
    })) as readonly bigint[];
    const spot = latest[1]!,
      tick = BigInt(world.strikes.tick);
    const strikes = [
      ...new Set(
        world.strikes.percents.map((p) => {
          const raw = (spot * BigInt(Math.round((100 + p) * 100))) / 10_000n;
          return ((raw + tick / 2n) / tick) * tick;
        }),
      ),
    ]
      .filter((k) => k > 0n)
      .sort((a, b) => (a < b ? -1 : 1));
    Object.assign(book, {
      underlying: world.underlying,
      fixingTime: String(fixing),
      maxStaleness: String(world.maxStaleness ?? 3_600),
      strikes: strikes.map(String),
      cutoff: String(fixing - (world.cutoffBefore ?? 3_600)),
      fixingRule: `${world.underlying} at ${new Date(fixing * 1000).toISOString()}`,
    });
  } else {
    if (!world.cutoffAt) throw new Error(`${world.title}: an event-only world needs cutoffAt`);
    book.cutoff = String(Math.floor(Date.parse(world.cutoffAt) / 1000));
  }
  return {
    title: world.title,
    feed: world.feed ?? "0x0000000000000000000000000000000000000000",
    legs: world.legs.map((l) => ({
      source: l.source,
      marketId: l.marketId,
      wantYes: l.wantYes !== false,
      themes: l.themes ?? [],
    })),
    book,
  };
}

export { FIX_WINDOW, worldMetadataUri };
