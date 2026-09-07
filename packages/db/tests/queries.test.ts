import { expect, test } from "bun:test";
import { testDatabase } from "@conditional-stocks/db/testing";
import { createEvidenceQueries } from "../src/evidence/queries.ts";
import { createGatewayQueries } from "../src/gateway/queries.ts";
import { createMatcherQueries } from "../src/matcher/queries.ts";
import { createPolymarketQueries } from "../src/polymarket/queries.ts";
import { createReconciliationQueries } from "../src/reconciliation/queries.ts";
import { createSettlementQueries } from "../src/settlement/queries.ts";

test("query factories expose named functions, not raw connections, and support destructuring", async () => {
  for (const create of [
    createGatewayQueries,
    createEvidenceQueries,
    createMatcherQueries,
    createSettlementQueries,
    createReconciliationQueries,
    createPolymarketQueries,
  ]) {
    const queries = create((await testDatabase()).database);
    try {
      expect(Object.values(queries).every((value) => typeof value === "function")).toBe(true);
      for (const name of ["db", "database", "query", "exec", "run", "transaction", "migrate"])
        expect(queries).not.toHaveProperty(name);
    } finally {
      const { close } = queries;
      await close();
    }
  }
  const { saveChallenge, consumeChallenge, close } = createGatewayQueries(
    (await testDatabase()).database,
  );
  try {
    const maker = "0x1000000000000000000000000000000000000001";
    await saveChallenge("one", maker, "test challenge", 2000n);
    expect(await consumeChallenge("one", maker, 1000n)).toBe("test challenge");
    expect(await consumeChallenge("one", maker, 1000n)).toBeNull();
  } finally {
    await close();
  }
});

test("settlement query transactions roll back a partial nonce allocation when a later leg fails", async () => {
  const queries = createSettlementQueries((await testDatabase()).database);
  const maker = "0x1000000000000000000000000000000000000001";
  const batchId = `0x${"11".repeat(32)}` as const;
  try {
    const attempt = {
      attempt: 0,
      batchId,
      callIndex: 0,
      createdAtMs: 1n,
      updatedAtMs: 1n,
      gas: 100n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      nonce: 7n,
      rawTransaction: "0x1234" as const,
      replaces: null,
      status: "prepared" as const,
      transactionHash: `0x${"22".repeat(32)}` as const,
    };
    // Missing parent batch makes the outbox insert fail after allocateNonce inside the transaction.
    await expect(
      (async () => await queries.persistPreparedBatch(maker, 7n, [attempt]))(),
    ).rejects.toThrow();
    expect(await queries.peekNonce(maker, 7n)).toBe(7n);
    expect(await queries.attempts(batchId)).toEqual([]);
  } finally {
    await queries.close();
  }
});
