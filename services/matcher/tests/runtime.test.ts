import { expect, test } from "bun:test";
import { Branch, Side, WAD } from "@conditional-stocks/domain";
import {
  CursorReorg,
  InMemoryMatcherStore,
  MatcherCoordinator,
  MatcherRuntime,
} from "../src/index.ts";
import { ChainEvents, hash, order } from "./helpers.ts";

function fixture() {
  const events = new ChainEvents();
  const input = [
    ...events.configure(),
    events.open(hash(1), order(1, Side.Buy, 6n * WAD)),
    events.open(hash(2), order(2, Side.Sell, 5n * WAD)),
  ];
  const coordinator = new MatcherCoordinator(new InMemoryMatcherStore(), { ownerId: "runtime" });
  const delivered: string[] = [];
  let blocked = false;
  let failDelivery = false;
  let reorg = false;
  let status: string | null = null;
  const runtime = new MatcherRuntime(
    coordinator,
    {
      page: async (cursor) => {
        if (reorg) {
          reorg = false;
          throw new CursorReorg(0n);
        }
        return {
          schemaVersion: 2,
          events: cursor ? [] : input,
          confirmedThrough: 10000n,
          hasMore: false,
        };
      },
    },
    {
      enqueue: async (proposal) => {
        if (failDelivery) throw new Error("worker offline");
        delivered.push(proposal.proposalId);
        status = "queued";
      },
      status: async () => status,
    },
    {
      assertCanTrade: async () => {
        if (blocked) throw new Error("freeze");
      },
    },
  );
  return {
    runtime,
    coordinator,
    delivered,
    block: (value: boolean) => {
      blocked = value;
    },
    fail: (value: boolean) => {
      failDelivery = value;
    },
    reorg: () => {
      reorg = true;
    },
    terminal: () => {
      status = "quarantined";
    },
  };
}
test("standalone runtime drains history, then submits durable matching proposals once", async () => {
  const f = fixture();
  await f.runtime.tick();
  await f.runtime.tick();
  expect(f.runtime.healthy).toBe(true);
  expect(f.delivered).toHaveLength(1);
  expect(
    f.coordinator.checkpoint.books.find((b) => b.branch === Branch.Yes)?.pendingProposal,
  ).not.toBeNull();
});
test("freeze blocks delivery, unfreezing resumes without another chain event", async () => {
  const f = fixture();
  f.block(true);
  await f.runtime.tick();
  expect(f.delivered).toHaveLength(0);
  f.block(false);
  await f.runtime.tick();
  expect(f.delivered).toHaveLength(1);
});
test("delivery outage preserves the proposal for retry; terminal status releases it", async () => {
  const f = fixture();
  f.fail(true);
  await f.runtime.tick();
  expect(await f.coordinator.activeProposals()).toHaveLength(1);
  f.fail(false);
  await f.runtime.tick();
  expect(f.delivered).toHaveLength(1);
  f.terminal();
  await f.runtime.tick();
  expect(await f.coordinator.activeProposals()).toHaveLength(0);
});
test("cursor conflicts rewind instead of continuing orphaned state", async () => {
  const f = fixture();
  await f.runtime.tick();
  f.reorg();
  await f.runtime.tick();
  expect(f.runtime.healthy).toBe(false);
  expect(f.coordinator.checkpoint.cursor).toBeNull();
});
