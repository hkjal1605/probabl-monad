import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { testDatabase } from "@conditional-stocks/db/testing";
import { Branch, Side, WAD } from "@conditional-stocks/domain";
import {
  type MatchPreview,
  MatchSkipReason,
  makeBookKey,
  SlowReferenceMatcher,
} from "@conditional-stocks/orderbook";

import {
  createMatcherQueries,
  FencingError,
  InMemoryMatcherStore,
  MatcherCoordinator,
  MatcherRunner,
  ProposalStatus,
  ShadowDivergenceError,
} from "../src/index.ts";
import { ChainEvents, hash, MARKET, order } from "./helpers.ts";

const BOOK = makeBookKey(MARKET, Branch.Yes);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const configure = async (coordinator: MatcherCoordinator, events: ChainEvents): Promise<void> => {
  for (const event of events.configure()) await coordinator.ingest(event);
};

describe("matcher coordinator", () => {
  test("PostgreSQL rollback after engine mutation recovers before replaying the event", async () => {
    const fixture = await testDatabase();
    const store = createMatcherQueries(fixture.database);
    let crash = false;
    const coordinator = new MatcherCoordinator(store, {
      ownerId: "postgres-owner",
      hooks: {
        afterProposalPersisted: () => {
          if (crash) throw Object.assign(new Error("rollback after proposal"), { code: "40001" });
        },
      },
    });
    const events = new ChainEvents();
    await configure(coordinator, events);
    await coordinator.ingest(events.open(hash(710), order(710, Side.Buy, 6n * WAD)));
    const head = await store.getLatestEventIndex();
    const envelope = events.open(hash(711), order(711, Side.Sell, 5n * WAD));
    crash = true;
    await expect(coordinator.ingest(envelope)).rejects.toThrow("rollback after proposal");
    const observer = createMatcherQueries(fixture.connect());
    expect(await observer.getLatestEventIndex()).toBe(head);
    expect(await observer.listActiveProposals()).toEqual([]);
    crash = false;
    const result = await coordinator.ingest(envelope);
    expect(result.proposals).toHaveLength(1);
    expect(await observer.listActiveProposals()).toHaveLength(1);
    expect(await observer.eventsAfter(head)).toHaveLength(1);
    await coordinator.ingest(envelope);
    expect(await observer.listActiveProposals()).toHaveLength(1);
  });
  test("persists, submits, mines, and canonically confirms a proposal", async () => {
    const store = new InMemoryMatcherStore();
    let now = 1_000n;
    const coordinator = new MatcherCoordinator(store, {
      checkpointEveryEvents: 2n,
      now: () => now,
      ownerId: "matcher-a",
    });
    const events = new ChainEvents();
    await configure(coordinator, events);
    await coordinator.ingest(events.open(hash(1), order(1, Side.Buy, 6n * WAD)));
    const opened = await coordinator.ingest(events.open(hash(2), order(2, Side.Sell, 5n * WAD)));
    const proposal = opened.proposals[0];
    if (!proposal) throw new Error("proposal missing");
    const fill = proposal.fills[0];
    if (!fill) throw new Error("proposal fill missing");

    await coordinator.recordSimulation(proposal.proposalId, {
      atBlockNumber: 5n,
      gasEstimate: 250_000n,
      ok: true,
      reason: null,
    });
    await coordinator.markSubmitted(proposal.proposalId, hash(500));
    now += 1n;
    await coordinator.recordReceipt(proposal.proposalId, {
      blockHash: hash(6),
      blockNumber: 6n,
      gasUsed: 210_000n,
      success: true,
      transactionHash: hash(500),
    });
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Mined);

    await coordinator.ingest(events.fill(fill));
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Confirmed);
    expect(coordinator.checkpoint.books[0]?.pendingProposal).toBeNull();
    expect(
      (await store.listDecisions()).some(
        (decision) => decision.preview.proposal?.proposalId === proposal.proposalId,
      ),
    ).toBe(true);
  });

  test("recovers a crash after proposal persistence but before in-memory reservation", async () => {
    const store = new InMemoryMatcherStore();
    let crash = false;
    const first = new MatcherCoordinator(store, {
      hooks: {
        afterProposalPersisted: () => {
          if (crash) throw new Error("injected crash");
        },
      },
      now: () => 1_000n,
      ownerId: "matcher-a",
    });
    const events = new ChainEvents();
    await configure(first, events);
    await first.ingest(events.open(hash(10), order(10, Side.Buy, 6n * WAD)));
    crash = true;
    await expect(
      (async () => await first.ingest(events.open(hash(11), order(11, Side.Sell, 5n * WAD))))(),
    ).rejects.toThrow("injected crash");
    const persisted = (await store.listActiveProposals())[0];
    if (!persisted) throw new Error("persisted proposal missing");
    const fill = persisted.proposal.fills[0];
    if (!fill) throw new Error("persisted fill missing");

    const recovered = new MatcherCoordinator(store, {
      now: () => 1_001n,
      ownerId: "matcher-a",
    });
    await recovered.recover();
    expect(recovered.checkpoint.books[0]?.pendingProposal?.proposal.proposalId).toBe(
      persisted.proposal.proposalId,
    );
    await recovered.ingest(events.fill(fill));
    expect((await store.getProposal(persisted.proposal.proposalId))?.status).toBe(
      ProposalStatus.Confirmed,
    );
  });

  test("replays an event journaled immediately before a crash", async () => {
    const store = new InMemoryMatcherStore();
    let crashOnNext = false;
    const first = new MatcherCoordinator(store, {
      hooks: {
        afterEventPersisted: () => {
          if (crashOnNext) throw new Error("injected event crash");
        },
      },
      now: () => 1_000n,
      ownerId: "matcher-a",
    });
    const events = new ChainEvents();
    await configure(first, events);
    await first.ingest(events.open(hash(20), order(20, Side.Buy, 6n * WAD)));
    crashOnNext = true;
    await expect(
      (async () => await first.ingest(events.open(hash(21), order(21, Side.Sell, 5n * WAD))))(),
    ).rejects.toThrow();

    const recovered = new MatcherCoordinator(store, {
      now: () => 1_001n,
      ownerId: "matcher-a",
    });
    await recovered.recover();
    expect((await recovered.processBook(BOOK))?.fills).toHaveLength(1);
  });

  test("preflights semantic input before appending it to the durable journal", async () => {
    const store = new InMemoryMatcherStore();
    const coordinator = new MatcherCoordinator(store, {
      now: () => 1_000n,
      ownerId: "matcher-a",
    });
    const events = new ChainEvents();
    await configure(coordinator, events);
    const journalHead = await store.getLatestEventIndex();
    await expect(
      (async () =>
        await coordinator.ingest(
          events.open(hash(25), order(25, Side.Buy, 6n * WAD, 10n * WAD, { expiry: 104n })),
        ))(),
    ).rejects.toThrow("OrderOpened is not valid");
    expect(await store.getLatestEventIndex()).toBe(journalHead);
  });

  test("accepts exact out-of-order redelivery and rejects a cursor conflict", async () => {
    const store = new InMemoryMatcherStore();
    const coordinator = new MatcherCoordinator(store, {
      now: () => 1_000n,
      ownerId: "matcher-a",
    });
    const events = new ChainEvents();
    const configuration = events.configure();
    for (const event of configuration) await coordinator.ingest(event);
    await coordinator.ingest(events.open(hash(26), order(26, Side.Buy, 6n * WAD)));
    const journalHead = await store.getLatestEventIndex();
    const first = configuration[0];
    if (!first) throw new Error("configuration event missing");
    const duplicate = await coordinator.ingest(first);
    expect(duplicate.applyResult.duplicate).toBe(true);
    expect(duplicate.event.duplicateDelivery).toBe(true);
    expect(await store.getLatestEventIndex()).toBe(journalHead);

    const conflict = structuredClone(first);
    if (conflict.event.type !== "market-terms-configured") throw new Error("wrong event type");
    conflict.event.baseStep = 2n * WAD;
    await expect((async () => await coordinator.ingest(conflict))()).rejects.toThrow(
      "conflicting canonical events",
    );
  });

  test("fencing rejects a stale owner and permits takeover only after expiry", async () => {
    const store = new InMemoryMatcherStore();
    const first = await store.acquireLease(BOOK, "a", 100n, 50n);
    if (!first) throw new Error("first lease missing");
    expect(await store.acquireLease(BOOK, "b", 120n, 50n)).toBeNull();
    const second = await store.acquireLease(BOOK, "b", 151n, 50n);
    expect(second?.fencingToken).toBe(first.fencingToken + 1n);

    const events = new ChainEvents();
    const coordinator = new MatcherCoordinator(store, { now: () => 151n, ownerId: "b" });
    await configure(coordinator, events);
    await coordinator.ingest(events.open(hash(30), order(30, Side.Buy, 6n * WAD)));
    const result = await coordinator.ingest(events.open(hash(31), order(31, Side.Sell, 5n * WAD)));
    const proposal = result.proposals[0];
    if (!proposal) throw new Error("proposal missing");
    expect(() =>
      store.transitionProposal(proposal.proposalId, ProposalStatus.Submitted, first, 152n),
    ).toThrow(FencingError);
  });

  test("rewinds an orphaned fill and deterministically reproposes the same batch", async () => {
    const store = new InMemoryMatcherStore();
    const coordinator = new MatcherCoordinator(store, {
      checkpointEveryEvents: 2n,
      now: () => 1_000n,
      ownerId: "matcher-a",
    });
    const events = new ChainEvents();
    await configure(coordinator, events);
    await coordinator.ingest(events.open(hash(40), order(40, Side.Buy, 6n * WAD)));
    const proposal = (
      await coordinator.ingest(events.open(hash(41), order(41, Side.Sell, 5n * WAD)))
    ).proposals[0];
    if (!proposal) throw new Error("proposal missing");
    const fill = proposal.fills[0];
    if (!fill) throw new Error("proposal fill missing");
    await coordinator.ingest(events.fill(fill));
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Confirmed);

    await coordinator.rewindToBlock(5n);
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Reorged);
    expect((await coordinator.processBook(BOOK))?.proposalId).toBe(proposal.proposalId);
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Persisted);
  });

  test("recovers partial batch settlement and preserves unconfirmed reservations", async () => {
    const store = new InMemoryMatcherStore();
    const first = new MatcherCoordinator(store, { now: () => 1_000n, ownerId: "matcher-a" });
    const events = new ChainEvents();
    await configure(first, events);
    await first.ingest(events.open(hash(70), order(70, Side.Sell, 5n * WAD, 4n * WAD)));
    await first.ingest(events.open(hash(71), order(71, Side.Sell, 5n * WAD, 6n * WAD)));
    const proposal = (await first.ingest(events.open(hash(72), order(72, Side.Buy, 6n * WAD))))
      .proposals[0];
    if (proposal?.fills.length !== 2) throw new Error("two-fill proposal missing");
    const firstFill = proposal.fills[0];
    const secondFill = proposal.fills[1];
    if (!firstFill || !secondFill) throw new Error("batch fills missing");
    await first.ingest(events.fill(firstFill));
    const durable = await store.getProposal(proposal.proposalId);
    expect(durable?.status).toBe(ProposalStatus.Persisted);
    expect(durable?.remainingFills.map((fill) => fill.remainingQuantity)).toEqual([0n, 6n * WAD]);

    const recovered = new MatcherCoordinator(store, {
      now: () => 1_001n,
      ownerId: "matcher-a",
    });
    await recovered.recover();
    expect(
      recovered.checkpoint.books[0]?.pendingProposal?.fills.map((fill) => fill.remainingQuantity),
    ).toEqual([0n, 6n * WAD]);
    await recovered.ingest(events.fill(secondFill));
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Confirmed);
  });

  test("expires and freezes orders while settlement is pending without reusing quantity", async () => {
    const expiryStore = new InMemoryMatcherStore();
    const expiryCoordinator = new MatcherCoordinator(expiryStore, {
      now: () => 1_000n,
      ownerId: "matcher-expiry",
    });
    const expiryEvents = new ChainEvents();
    await configure(expiryCoordinator, expiryEvents);
    await expiryCoordinator.ingest(
      expiryEvents.open(hash(80), order(80, Side.Buy, 6n * WAD, 10n * WAD, { expiry: 106n })),
    );
    const expiring = (
      await expiryCoordinator.ingest(expiryEvents.open(hash(81), order(81, Side.Sell, 5n * WAD)))
    ).proposals[0];
    if (!expiring) throw new Error("expiring proposal missing");
    const expiryResult = await expiryCoordinator.ingest(
      expiryEvents.event({
        type: "emergency-pause-changed",
        paused: true,
        reasonHash: hash(8_000),
      }),
    );
    expect(expiryResult.applyResult.invalidatedProposalIds).toEqual([expiring.proposalId]);
    expect((await expiryStore.getProposal(expiring.proposalId))?.status).toBe(
      ProposalStatus.Invalidated,
    );

    const freezeStore = new InMemoryMatcherStore();
    const freezeCoordinator = new MatcherCoordinator(freezeStore, {
      now: () => 1_000n,
      ownerId: "matcher-freeze",
    });
    const freezeEvents = new ChainEvents();
    await configure(freezeCoordinator, freezeEvents);
    await freezeCoordinator.ingest(freezeEvents.open(hash(82), order(82, Side.Buy, 6n * WAD)));
    const freezing = (
      await freezeCoordinator.ingest(freezeEvents.open(hash(83), order(83, Side.Sell, 5n * WAD)))
    ).proposals[0];
    if (!freezing) throw new Error("freezing proposal missing");
    const freezeResult = await freezeCoordinator.ingest(
      freezeEvents.event({
        type: "market-state-changed",
        marketId: MARKET,
        newState: 3,
        previousState: 2,
        reasonHash: hash(8_001),
      }),
    );
    expect(freezeResult.applyResult.invalidatedProposalIds).toEqual([freezing.proposalId]);
    expect((await freezeStore.getProposal(freezing.proposalId))?.status).toBe(
      ProposalStatus.Invalidated,
    );
  });

  test("recovers submitted and mined boundaries, and safely reproposes after a revert", async () => {
    const store = new InMemoryMatcherStore();
    const first = new MatcherCoordinator(store, { now: () => 1_000n, ownerId: "matcher-a" });
    const events = new ChainEvents();
    await configure(first, events);
    await first.ingest(events.open(hash(90), order(90, Side.Buy, 6n * WAD)));
    const proposal = (await first.ingest(events.open(hash(91), order(91, Side.Sell, 5n * WAD))))
      .proposals[0];
    if (!proposal) throw new Error("proposal missing");
    await first.markSubmitted(proposal.proposalId, hash(9_000));
    expect((await first.markSubmitted(proposal.proposalId, hash(9_000))).status).toBe(
      ProposalStatus.Submitted,
    );
    await expect(
      (async () => await first.markSubmitted(proposal.proposalId, hash(9_999)))(),
    ).rejects.toThrow("different transaction hash");

    const afterSubmit = new MatcherCoordinator(store, {
      now: () => 1_001n,
      ownerId: "matcher-a",
    });
    await afterSubmit.recover();
    expect(afterSubmit.checkpoint.books[0]?.pendingProposal?.proposal.proposalId).toBe(
      proposal.proposalId,
    );
    const successfulReceipt = {
      blockHash: hash(99),
      blockNumber: 99n,
      gasUsed: 200_000n,
      success: true,
      transactionHash: hash(9_000),
    } as const;
    await afterSubmit.recordReceipt(proposal.proposalId, successfulReceipt);
    expect((await afterSubmit.recordReceipt(proposal.proposalId, successfulReceipt)).status).toBe(
      ProposalStatus.Mined,
    );

    const afterReceipt = new MatcherCoordinator(store, {
      now: () => 1_002n,
      ownerId: "matcher-a",
    });
    await afterReceipt.recover();
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Mined);
    const confirmedFill = proposal.fills[0];
    if (!confirmedFill) throw new Error("confirmed fill missing");
    await afterReceipt.ingest(events.fill(confirmedFill));
    expect((await store.getProposal(proposal.proposalId))?.status).toBe(ProposalStatus.Confirmed);

    const revertStore = new InMemoryMatcherStore();
    const revertCoordinator = new MatcherCoordinator(revertStore, {
      now: () => 2_000n,
      ownerId: "matcher-revert",
    });
    const revertEvents = new ChainEvents();
    await configure(revertCoordinator, revertEvents);
    await revertCoordinator.ingest(revertEvents.open(hash(92), order(92, Side.Buy, 6n * WAD)));
    const revertedProposal = (
      await revertCoordinator.ingest(revertEvents.open(hash(93), order(93, Side.Sell, 5n * WAD)))
    ).proposals[0];
    if (!revertedProposal) throw new Error("reverted proposal missing");
    await revertCoordinator.markSubmitted(revertedProposal.proposalId, hash(9_001));
    await expect(
      (async () =>
        await revertCoordinator.recordReceipt(revertedProposal.proposalId, {
          blockHash: hash(100),
          blockNumber: 100n,
          gasUsed: 180_000n,
          success: false,
          transactionHash: hash(9_002),
        }))(),
    ).rejects.toThrow("does not match");
    const failed = await revertCoordinator.recordReceipt(revertedProposal.proposalId, {
      blockHash: hash(100),
      blockNumber: 100n,
      gasUsed: 180_000n,
      success: false,
      transactionHash: hash(9_001),
    });
    expect(failed.status).toBe(ProposalStatus.Failed);
    expect((await revertCoordinator.processBook(BOOK))?.proposalId).toBe(
      revertedProposal.proposalId,
    );
  });
});

describe("durable PostgreSQL store", () => {
  test("survives process-style close/reopen and restores pending reservations", async () => {
    const fixture = await testDatabase();
    const events = new ChainEvents();
    const firstStore = createMatcherQueries(fixture.database);
    const first = new MatcherCoordinator(firstStore, {
      checkpointEveryEvents: 2n,
      now: () => 1_000n,
      ownerId: "matcher-a",
    });
    await configure(first, events);
    await first.ingest(events.open(hash(50), order(50, Side.Buy, 6n * WAD)));
    const proposal = (await first.ingest(events.open(hash(51), order(51, Side.Sell, 5n * WAD))))
      .proposals[0];
    if (!proposal) throw new Error("proposal missing");
    const fill = proposal.fills[0];
    if (!fill) throw new Error("proposal fill missing");
    await first.close();

    const secondStore = createMatcherQueries(fixture.connect());
    const second = new MatcherCoordinator(secondStore, {
      now: () => 1_001n,
      ownerId: "matcher-a",
    });
    await second.recover();
    expect(second.checkpoint.books[0]?.pendingProposal?.proposal.proposalId).toBe(
      proposal.proposalId,
    );
    await second.ingest(events.fill(fill));
    expect((await secondStore.getProposal(proposal.proposalId))?.status).toBe(
      ProposalStatus.Confirmed,
    );
    await second.close();
  });

  test("fences two live PostgreSQL connections on the same book", async () => {
    const fixture = await testDatabase();
    const first = createMatcherQueries(fixture.database);
    const second = createMatcherQueries(fixture.connect());
    const lease = await first.acquireLease(BOOK, "first", 100n, 15_000n);
    expect(lease?.fencingToken).toBe(1n);
    // A fast client clock must not steal the server-clock lease.
    expect(await second.acquireLease(BOOK, "second", 1n << 100n, 50n)).toBeNull();
    await fixture.expireMatcherLease(BOOK);
    expect((await second.acquireLease(BOOK, "second", 151n, 50n))?.fencingToken).toBe(2n);
    await first.close();
    await second.close();
  });

  test("indexes canonical cursors for idempotent PostgreSQL redelivery", async () => {
    const store = createMatcherQueries((await testDatabase()).database);
    const events = new ChainEvents();
    const configuration = events.configure();
    const first = configuration[0];
    const second = configuration[1];
    if (!first || !second) throw new Error("configuration events missing");
    const firstRecord = await store.appendEvent(first);
    await store.appendEvent(second);
    const duplicate = await store.appendEvent(first);
    expect(duplicate.index).toBe(firstRecord.index);
    expect(duplicate.duplicateDelivery).toBe(true);
    expect(await store.getLatestEventIndex()).toBe(2n);
    await store.close();
  });
});

describe("event runner", () => {
  test("streams canonical inputs and hands durable proposals to the next milestone", async () => {
    const store = new InMemoryMatcherStore();
    const coordinator = new MatcherCoordinator(store, {
      now: () => 1_000n,
      ownerId: "matcher-runner",
    });
    const events = new ChainEvents();
    const sourceEvents = [
      ...events.configure(),
      events.open(hash(55), order(55, Side.Buy, 6n * WAD)),
      events.open(hash(56), order(56, Side.Sell, 5n * WAD)),
    ];
    const proposals: Array<`0x${string}`> = [];
    const source = {
      async *[Symbol.asyncIterator]() {
        for (const event of sourceEvents) yield event;
      },
    };
    await new MatcherRunner(coordinator).run(source, {
      onProposal: (proposal) => {
        proposals.push(proposal.proposalId);
      },
    });
    expect(proposals).toHaveLength(1);
    expect((await store.listActiveProposals())[0]?.proposal.proposalId).toBe(proposals[0]);
  });
});

describe("shadow divergence alarm", () => {
  test("halts matching and emits an alert when the independent result is injected wrong", async () => {
    class DivergentShadow extends SlowReferenceMatcher {
      override preview(bookKey: string): MatchPreview {
        const preview = super.preview(bookKey);
        if (!preview.proposal) return preview;
        return {
          proposal: null,
          skip: { bookKey, cursor: preview.proposal.cursor, reason: MatchSkipReason.NoCross },
        };
      }
    }

    const alerts: string[] = [];
    const store = new InMemoryMatcherStore();
    const coordinator = new MatcherCoordinator(store, {
      now: () => 1_000n,
      onAlert: (alert) => alerts.push(alert.type),
      ownerId: "matcher-a",
      shadow: new DivergentShadow(),
    });
    const events = new ChainEvents();
    await configure(coordinator, events);
    await coordinator.ingest(events.open(hash(60), order(60, Side.Buy, 6n * WAD)));
    await expect(
      (async () =>
        await coordinator.ingest(events.open(hash(61), order(61, Side.Sell, 5n * WAD))))(),
    ).rejects.toThrow(ShadowDivergenceError);
    expect(alerts).toContain("shadow-divergence");
    expect(await store.listActiveProposals()).toHaveLength(0);
  });
});
