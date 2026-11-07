/** World books' automation: users' worlds created from their approved packets, and on anvil every
 * transaction an approved world packet authorizes, rebuilt locally from the packet and accepted
 * on chain (book creation, an event's freeze, commitment and resolution, a feed fixing proposed
 * from the provably last round and finalized, and the two-key fallback of a held fixing). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  eventOracleAbi,
  FIX_WINDOW,
  underlyingId,
  worldBooksAbi,
} from "@conditional-stocks/evm-client";
import {
  type WorldAdminAction,
  worldEvidenceTransaction,
} from "@conditional-stocks/evm-client/world-admin";
import {
  buildBookCreationEvidence,
  buildBookFixingEvidence,
  buildEventResolutionEvidence,
  hashCanonical,
  legEvidence,
  normalizeGammaMarket,
  type WorldEvidenceEnvelope,
} from "@conditional-stocks/market-data";
import { Logger } from "@conditional-stocks/shared";
import { type Address, decodeEventLog, type Hex, type PublicClient } from "viem";
import { type Anvil, accounts, send, startAnvil } from "../../../packages/evm-client/test/anvil.ts";
import {
  CONDITIONS,
  deployWorlds,
  KEYS,
  priceFeedAbi,
  type Worlds,
  warp,
} from "../../../packages/evm-client/test/worlds-anvil.ts";
import type { Admin } from "../src/admin.ts";
import { fixBooks } from "../src/jobs/fix-books.ts";
import { openUserBooks } from "../src/jobs/open-user-books.ts";
import { resolveEvents } from "../src/jobs/resolve-events.ts";
import { WorldAdmin, type WorldBookView, type WorldEvidence } from "../src/worlds.ts";

let node: Anvil;
let worlds: Worlds;
let admin: WorldAdmin;
const sent: { from: Address; to: Address; hash: Hex }[] = [];
const reconciled: { hash: Hex; action: string; transactionHash: Hex }[] = [];
/** The actions the API would preview next for each packet, in order. */
const queued = new Map<Hex, WorldAdminAction[]>();
let tamper = false;
const preparer = accounts[0]!.address;

beforeAll(async () => {
  node = await startAnvil(Math.floor(Date.now() / 1000));
  const now = Number((await node.client.getBlock()).timestamp);
  worlds = await deployWorlds(node, now);
  const fake = {
    async request(path: string, body?: { action: string; transactionHash: Hex }) {
      const m = path.match(/^\/v2\/admin\/evidence\/(0x[0-9a-f]{64})\/(transaction|reconcile)$/);
      if (!m) throw new Error(`Unexpected request ${path}`);
      const hash = m[1] as Hex;
      if (m[2] === "reconcile") {
        reconciled.push({ hash, ...body! });
        return {};
      }
      // The API's preview, built independently from the stored packet.
      const action = queued.get(hash)!.shift()!;
      const envelope = packets.get(hash)!;
      const preview = worldEvidenceTransaction(envelope, action, await admin.deployment());
      return { ...preview, data: tamper ? `${preview.data}00` : preview.data, action };
    },
    async send(tx: { from: Address; to: Address; data: Hex }) {
      const index = accounts.findIndex((a) => a.address === tx.from);
      const hash = await node.wallet(index).sendTransaction({
        account: accounts[index]!,
        chain: node.chain,
        to: tx.to,
        data: tx.data,
      });
      const receipt = await node.client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
      sent.push({ from: tx.from, to: tx.to, hash });
      return hash;
    },
  };
  admin = new WorldAdmin({
    admin: fake as unknown as Admin,
    client: node.publicClient as PublicClient,
    books: worlds.books,
    metadataBase: "http://127.0.0.1:4000",
    sender: worlds.admin,
  });
}, 120_000);
afterAll(() => node?.stop());

const packets = new Map<Hex, WorldEvidenceEnvelope>();
const approved = (envelope: WorldEvidenceEnvelope, actions: WorldAdminAction[]): WorldEvidence => {
  packets.set(envelope.packetHash, envelope);
  queued.set(envelope.packetHash, actions);
  return { envelope, status: "approved", observations: [] };
};
const deployment = () => ({
  chainId: String(node.chain.id),
  books: worlds.books,
  oracle: worlds.oracle,
});
const leg = (i: number) => {
  const raw = {
    active: true,
    closed: false,
    clobTokenIds: JSON.stringify(["111", "222"]),
    conditionId: CONDITIONS[i],
    description: "Resolves Yes if it happens.",
    endDate: "2027-01-01T00:00:00Z",
    id: `gamma-${i}`,
    negRisk: false,
    outcomes: JSON.stringify(["Yes", "No"]),
    question: `Event ${i}?`,
    resolutionSource: "Official",
    slug: `event-${i}`,
    umaResolutionStatus: "unresolved",
  };
  return legEvidence({
    metadata: normalizeGammaMarket(raw),
    metadataSnapshotId: `snapshot-${i}`,
    metadataRawHash: hashCanonical(raw),
    eventKey: KEYS[i]!,
    wantYes: true,
  });
};
const bookCreated = async (hash: Hex) => {
  const receipt = await node.client.getTransactionReceipt({ hash });
  for (const log of receipt.logs)
    try {
      const e = decodeEventLog({ abi: worldBooksAbi, ...log });
      if (e.eventName === "BookCreated") return (e.args as { book: bigint }).book;
    } catch {}
  throw new Error("No BookCreated");
};
const bookOf = (id: bigint) =>
  node.client.readContract({
    address: worlds.books,
    abi: worldBooksAbi,
    functionName: "book",
    args: [id],
  }) as Promise<{ status: number; winner: number; fixingTime: number }>;
async function createBook(legs: number[], fixingIn: number) {
  const now = Number((await node.client.getBlock()).timestamp);
  const envelope = buildBookCreationEvidence({
    deployment: deployment(),
    title: `World ${legs.join("+")}`,
    legs: legs.map(leg),
    book: {
      feed: worlds.feed,
      underlying: "US:NVDA",
      feedDecimals: 8,
      fixingTime: String(now + fixingIn),
      maxStaleness: "3600",
      strikes: ["22000000000", "24000000000"],
      cutoff: String(now + fixingIn - 600),
      feeBps: "100",
      fixingRule: "NVDA at the fixing",
    },
    attachments: [],
    preparedAt: new Date().toISOString(),
    preparer,
  });
  const result = await admin.execute(approved(envelope, ["create-book"]));
  expect(result.action).toBe("create-book");
  return { id: await bookCreated(result.transactionHash), fixingTime: now + fixingIn };
}
async function resolve(i: number, payout: { yes: string; no: string; denominator: string }) {
  const envelope = buildEventResolutionEvidence({
    deployment: deployment(),
    event: {
      eventKey: KEYS[i]!,
      source: "polymarket",
      marketId: `gamma-${i}`,
      conditionId: CONDITIONS[i]!,
      yesIndex: "1",
      noIndex: "2",
    },
    metadataRawHash: `0x${"ef".repeat(32)}`,
    metadataSnapshotId: "final",
    officialStatus: "resolved",
    officialUrl: "https://polymarket.com/event/x",
    payout,
    polygon: {
      chainId: "137",
      conditionalTokensAddress: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
      blockNumber: "1",
    },
    sourceObservations: [
      {
        observedAt: new Date().toISOString(),
        payout,
        status: "resolved",
        url: "https://gamma-api.polymarket.com/markets/x",
      },
    ],
    sourceReference: "https://gamma-api.polymarket.com/markets/x",
    attachments: [],
    preparedAt: new Date().toISOString(),
    preparer,
  });
  await admin.freeze(KEYS[i]!, "venue settled");
  const evidence = approved(envelope, ["commit-event", "resolve-event"]);
  expect((await admin.execute(evidence)).action).toBe("commit-event");
  expect((await admin.execute(evidence)).action).toBe("resolve-event");
}
const outcome = async (i: number) =>
  (
    (await node.client.readContract({
      address: worlds.oracle,
      abi: eventOracleAbi,
      functionName: "outcome",
      args: [KEYS[i]!],
    })) as readonly [number, number]
  )[0];
const round = (id: bigint, answer: bigint, at: number) =>
  node.wallet(0).writeContract({
    account: accounts[0]!,
    chain: node.chain,
    address: worlds.feed,
    abi: priceFeedAbi,
    functionName: "update",
    args: [id, answer, BigInt(at)],
  });

describe("world administration on chain", () => {
  test("the deployment's roles are read from the chain", async () => {
    expect(await admin.deployment()).toMatchObject({
      chainId: node.chain.id,
      books: worlds.books,
      oracle: worlds.oracle,
      bookAdmin: worlds.admin,
      marketAdmin: worlds.admin,
    });
  });

  test("an approved book packet creates the book its packet describes", async () => {
    const { id } = await createBook([0, 1], 7_200);
    const b = await bookOf(id);
    expect(b).toMatchObject({ legCount: 2, strikeCount: 2, atomCount: 4, feeBps: 100 });
    expect(
      (await node.client.readContract({
        address: worlds.books,
        abi: worldBooksAbi,
        functionName: "book",
        args: [id],
      })) as { underlying: Hex },
    ).toMatchObject({ underlying: underlyingId("US:NVDA") });
    expect(reconciled.at(-1)).toMatchObject({ action: "create-book" });
  });

  test("a preview that differs from the local rebuild is never signed", async () => {
    const before = sent.length;
    tamper = true;
    try {
      await expect(createBook([2], 7_200)).rejects.toThrow("differs from the locally built");
    } finally {
      tamper = false;
    }
    expect(sent.length).toBe(before);
  });

  test("an event freezes, then commits and resolves from its packet; a voided one is INVALID", async () => {
    await resolve(0, { yes: "1", no: "0", denominator: "1" });
    await resolve(1, { yes: "1", no: "0", denominator: "1" });
    expect([await outcome(0), await outcome(1)]).toEqual([3, 3]);
    await resolve(3, { yes: "1", no: "1", denominator: "2" });
    expect(await outcome(3)).toBe(5);
  });

  test("a fixing proposes the provably last round at or before it, then finalizes", async () => {
    // The book on events 0 and 1 (both YES) awaits its fixing once the time passes.
    const id = 1n;
    const { fixingTime } = await bookOf(id);
    await warp(node, Number(fixingTime) + 120);
    await round(2n, 21_000_000_000n, Number(fixingTime) - 300);
    await round(3n, 23_000_000_000n, Number(fixingTime) - 30);
    await round(4n, 25_000_000_000n, Number(fixingTime) + 60);
    const proven = await admin.fixingRound(worlds.feed, Number(fixingTime), 3_600);
    expect(proven).toEqual({ id: 3n, answer: 23_000_000_000n, updatedAt: Number(fixingTime) - 30 });
    // Too stale for a tighter window; nothing before the first round.
    expect(await admin.fixingRound(worlds.feed, Number(fixingTime), 10)).toBeNull();
    await admin.proposeFix(Number(id), proven!.id);
    await warp(node, Number(fixingTime) + 120 + FIX_WINDOW);
    await admin.finalizeFix(Number(id));
    // $230 is between the strikes: atom 2 wins.
    expect(await bookOf(id)).toMatchObject({ winner: 2 });
  });

  test("a held fixing goes to the two-key fallback, at the packet's price", async () => {
    // A book on a fresh event, which then passes.
    const { id, fixingTime } = await createBook([2], 3_600);
    await resolve(2, { yes: "1", no: "0", denominator: "1" });
    await warp(node, fixingTime + 60);
    await send(node, 0, {
      to: worlds.books,
      data: (await import("viem")).encodeFunctionData({
        abi: worldBooksAbi,
        functionName: "holdFix",
        args: [id],
      }),
    });
    const envelope = buildBookFixingEvidence({
      deployment: deployment(),
      book: {
        id: String(id),
        feed: worlds.feed,
        fixingTime: String(fixingTime),
        maxStaleness: "3600",
      },
      price: "24500000000",
      reason: "The proposed round was wrong",
      rounds: [],
      sourceObservations: [
        {
          observedAt: new Date().toISOString(),
          price: "24500000000",
          status: "official close",
          url: "https://www.nasdaq.com/market-activity/stocks/nvda",
        },
      ],
      sourceReference: "https://www.nasdaq.com/market-activity/stocks/nvda",
      attachments: [],
      preparedAt: new Date().toISOString(),
      preparer,
    });
    const evidence = approved(envelope, ["commit-fix", "resolve-fix"]);
    expect((await admin.execute(evidence)).action).toBe("commit-fix");
    expect((await admin.execute(evidence)).action).toBe("resolve-fix");
    // $245 is above both strikes: the top atom.
    expect(await bookOf(id)).toMatchObject({ winner: 3 });
  });
});

/** A world admin whose calls are recorded and answered from `overrides`. */
function fakeWorlds(overrides: Record<string, unknown>) {
  const calls: [string, ...unknown[]][] = [];
  const target = Object.fromEntries(
    Object.entries({
      books: [],
      evidence: [],
      execute: { action: "create-book", transactionHash: "0x1" },
      approve: (e: WorldEvidence) => ({ ...e, status: "approved" }),
      ...overrides,
    }).map(([name, value]) => [
      name,
      async (...args: unknown[]) => {
        calls.push([name, ...args]);
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown)(...args)
          : value;
      },
    ]),
  );
  return { worlds: target as unknown as WorldAdmin, names: () => calls.map(([n]) => n), calls };
}
const quiet = new Logger({ service: "test", level: "silent" });
const context = (worlds: WorldAdmin, extra: Record<string, unknown> = {}) =>
  ({ worlds, execute: true, logger: quiet, polygon: {} as PublicClient, ...extra }) as never;
const view = (over: Partial<WorldBookView> = {}): WorldBookView => ({
  id: 4,
  defHash: `0x${"44".repeat(32)}`,
  title: "World",
  state: "trading",
  feed: "0x00000000000000000000000000000000000000fe",
  feedDecimals: 8,
  underlying: "US:NVDA",
  fixingTime: String(Math.floor(Date.now() / 1000) - 600),
  maxStaleness: 3_600,
  cutoff: "0",
  legs: [],
  fixing: { proposal: null, held: false, fallbackAt: null },
  ...over,
});

describe("world jobs", () => {
  test("fix-books proposes the proven round, finalizes after the window, and leaves a held one", async () => {
    const round = { id: 9n, answer: 1n, updatedAt: 1 };
    const due = fakeWorlds({
      books: [view({ state: "awaitingFix" }), view({ id: 5, state: "trading" })],
      fixingRound: round,
      proposeFix: "0xp",
    });
    await fixBooks.run(context(due.worlds));
    expect(due.calls.filter(([n]) => n !== "books")).toEqual([
      ["fixingRound", view().feed, Number(view().fixingTime), 3_600],
      ["proposeFix", 4, 9n],
    ]);
    const proposedAt = String(Math.floor(Date.now() / 1000) - FIX_WINDOW - 1);
    const standing = fakeWorlds({
      books: [
        view({
          state: "awaitingFix",
          fixing: { proposal: { proposedAt, roundId: "9" }, held: false, fallbackAt: null },
        }),
        view({
          id: 6,
          state: "awaitingFix",
          fixing: { proposal: null, held: true, fallbackAt: null },
        }),
      ],
      finalizeFix: "0xf",
    });
    await fixBooks.run(context(standing.worlds));
    expect(standing.names()).toEqual(["books", "finalizeFix"]);
    // A dry run changes nothing.
    const dry = fakeWorlds({ books: [view({ state: "awaitingFix" })], fixingRound: round });
    await fixBooks.run(context(dry.worlds, { execute: false }));
    expect(dry.names()).toEqual(["books", "fixingRound"]);
  });

  test("resolve-events freezes a settled Kalshi leg, then commits and resolves its result", async () => {
    const key = `0x${"aa".repeat(32)}` as Hex;
    const settled = {
      snapshotId: "k1",
      rawHash: `0x${"ef".repeat(32)}`,
      normalized: {
        source: "kalshi",
        ticker: "KXFED-26DEC-H25",
        canonicalUrl: "https://kalshi.com/markets/kxfed",
        conditionId: `0x${"cd".repeat(32)}`,
        endTime: new Date(Date.now() + 86_400_000).toISOString(),
        status: "finalized",
        result: "yes",
        closed: true,
      },
    };
    const leg = (state: string) => ({
      eventKey: key,
      wantYes: true,
      state,
      venue: {
        source: "kalshi" as const,
        marketId: "KXFED-26DEC-H25",
        conditionId: `0x${"cd".repeat(32)}` as Hex,
        yesIndex: 1,
        noIndex: 2,
        endTime: settled.normalized.endTime,
      },
    });
    const open = fakeWorlds({
      books: [view({ legs: [leg("open")] })],
      snapshot: settled,
      freeze: "0x1",
    });
    await resolveEvents.run(context(open.worlds));
    expect(open.names()).toEqual(["books", "snapshot", "freeze"]);
    const prepared = {
      envelope: { packetHash: "0xr", packet: {} },
      status: "prepared",
      observations: [],
    };
    const frozen = fakeWorlds({
      books: [view({ legs: [leg("frozen")] })],
      snapshot: settled,
      fetchMetadata: settled,
      prepareResolution: prepared,
      execute: { action: "commit-event", transactionHash: "0x2" },
    });
    await resolveEvents.run(context(frozen.worlds));
    expect(frozen.names()).toEqual([
      "books",
      "snapshot",
      "evidence",
      "fetchMetadata",
      "prepareResolution",
      "approve",
      "execute",
    ]);
    expect(frozen.calls.find(([n]) => n === "prepareResolution")![2]).toMatchObject({
      metadataSnapshotId: "k1",
      payout: { yes: "1", no: "0", denominator: "1" },
      polygon: null,
    });
    // Decided books are left alone.
    const decided = fakeWorlds({ books: [view({ state: "passed", legs: [leg("yes")] })] });
    await resolveEvents.run(context(decided.worlds));
    expect(decided.names()).toEqual(["books"]);
  });

  test("open-user-books creates each approved user world once, and keeps going past a failure", async () => {
    const packet = (hash: string) => ({
      status: "approved",
      observations: [],
      envelope: { packetHash: hash, packet: { kind: "book-creation", title: "A world" } },
    });
    let first = true;
    const fake = fakeWorlds({
      userBooks: [packet("0xa"), packet("0xb")],
      execute: () => {
        if (first) {
          first = false;
          throw new Error("reverted");
        }
        return { action: "create-book", transactionHash: "0x2" };
      },
    });
    await openUserBooks.run(context(fake.worlds));
    expect(fake.names()).toEqual(["userBooks", "execute", "execute"]);
    expect(
      fake.calls
        .filter(([n]) => n === "execute")
        .map(([, p]) => (p as { envelope: { packetHash: string } }).envelope.packetHash),
    ).toEqual(["0xa", "0xb"]);
    // Nothing pending: one read, no transaction.
    const idle = fakeWorlds({ userBooks: [] });
    await openUserBooks.run(context(idle.worlds));
    expect(idle.names()).toEqual(["userBooks"]);
    // A dry run lists what is due and signs nothing.
    const dry = fakeWorlds({ userBooks: [packet("0xc")] });
    await openUserBooks.run({ ...(context(dry.worlds) as object), execute: false } as never);
    expect(dry.names()).toEqual(["userBooks"]);
  });
});
