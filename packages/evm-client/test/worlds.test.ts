import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type Address,
  getAddress,
  type Hex,
  keccak256,
  recoverTypedDataAddress,
  stringToBytes,
  zeroAddress,
} from "viem";
import { eventOracleAbi, worldBooksAbi, worldVaultAbi } from "../src/abi.ts";
import {
  applyWorldTransaction,
  atomsOf,
  bookStateAt,
  decodeWorldLog,
  emptyWorldState,
  encodeWorldCheckpoint,
  restoreWorldState,
  type WorldEvent,
  type WorldState,
  worldCreditOf,
  worldGrantKey,
  worldLedgerIssues,
  worldTransactions,
} from "../src/world-ledger.ts";
import { vaultHookProblem } from "../src/world-risk.ts";
import {
  atomCount,
  BOOK_STATE,
  bookDefHash,
  bookDefProblem,
  bucketOf,
  bundleProblem,
  compactSignature,
  EVENT_STATE,
  eventResolutionHash,
  fixHash,
  holdingLayers,
  maskOutcome,
  outcomeMask,
  packMakerData,
  parseProductKey,
  payRange,
  productKey,
  productOf,
  standardProducts,
  unpackMakerData,
  WORLD_BUY,
  WORLD_QUOTE_TYPES,
  WORLD_SELL,
  type WorldOutcome,
  type WorldQuote,
  worldFee,
  worldGrantProblem,
  worldQuoteDigest,
  worldQuoteDomain,
  worldQuoteMessage,
} from "../src/worlds.ts";
import { type Anvil, accounts, send, startAnvil } from "./anvil.ts";
import {
  deployWorlds,
  eventDef,
  KEYS,
  pricedDef,
  priceFeedAbi,
  resolveEvent,
  URI,
  vaultQuote,
  type Worlds,
  walletQuote,
  warp,
} from "./worlds-anvil.ts";

describe("bundles and products", () => {
  test("outcome masks name contiguous atoms and parse back", () => {
    const count = 7; // five strikes
    const outcomes: WorldOutcome[] = [
      { kind: "world" },
      ...[1, 2, 3, 4, 5].flatMap((strike) => [
        { kind: "above" as const, strike },
        { kind: "below" as const, strike },
      ]),
      { kind: "range", from: 1, to: 3 },
      { kind: "range", from: 2, to: 5 },
    ];
    for (const outcome of outcomes) {
      const mask = outcomeMask(outcome, count);
      expect(mask & 1).toBe(0);
      expect(mask >> count).toBe(0);
      // "below 5" is every bucket but the top: a range from the bottom is "below".
      expect(maskOutcome(mask, count)).toEqual(outcome);
    }
    expect(outcomeMask({ kind: "above", strike: 3 }, count)).toBe(0b1110000); // atoms 4-6
    expect(outcomeMask({ kind: "below", strike: 3 }, count)).toBe(0b0001110); // atoms 1-3
    expect(outcomeMask({ kind: "world" }, 2)).toBe(0b10);
    expect(maskOutcome(0b1010, count)).toBeNull(); // not contiguous
    expect(() => outcomeMask({ kind: "above", strike: 6 }, count)).toThrow();
    expect(() => outcomeMask({ kind: "range", from: 3, to: 3 }, count)).toThrow();
  });

  test("product keys round trip and every standard product has a mask", () => {
    const def = {
      feed: "0x0000000000000000000000000000000000000001" as Address,
      strikes: STRIKES3,
    };
    const products = standardProducts(def);
    expect(products.length).toBe(1 + 3 * 4);
    for (const p of products) {
      expect(parseProductKey(p.key)).toEqual({ kind: p.kind, outcome: p.outcome });
      expect(productKey(p.kind, p.outcome)).toBe(p.key);
    }
    expect(standardProducts({ feed: zeroAddress, strikes: [] }).map((p) => p.key)).toEqual([
      "bet:world",
    ]);
    for (const bad of ["bet:above:0", "bet:range:3:2", "cond:above", "x:world", "bet:above:9"])
      expect(parseProductKey(bad)).toBeNull();
  });

  test("pay ranges, bundle checks and fees match the contract's rules", () => {
    const bundle = { mask: 0b1110000, units: 250n, refund: 100n };
    expect(payRange(bundle, 7)).toEqual({ minPay: 0n, maxPay: 250n });
    expect(payRange({ mask: 0b1111110, units: 10n, refund: 10n }, 7)).toEqual({
      minPay: 10n,
      maxPay: 10n,
    });
    expect(bundleProblem(bundle, 7, 100n)).toBeNull();
    expect(bundleProblem(bundle, 7, 251n)).not.toBeNull();
    expect(bundleProblem({ mask: 1, units: 1n, refund: 0n }, 7)).not.toBeNull();
    expect(bundleProblem({ mask: 0b10000000, units: 1n, refund: 0n }, 7)).not.toBeNull();
    expect(bundleProblem({ mask: 0, units: 0n, refund: 0n }, 7)).not.toBeNull();
    expect(bundleProblem({ mask: 0b10, units: 0n, refund: 0n }, 7)).not.toBeNull();
    expect(worldFee(1n, 100)).toBe(1n); // rounds up
    expect(worldFee(20_000_000n, 100)).toBe(200_000n);
    expect(worldFee(0n, 100)).toBe(0n);
    expect(productOf(bundle, 7).kind).toBe("conditional");
    expect(productOf({ ...bundle, refund: 0n }, 7).kind).toBe("world-bet");
    expect(productOf({ mask: 0, units: 0n, refund: 5n }, 7).kind).toBe("refund");
    expect(bucketOf(STRIKES3, 99n)).toBe(1);
    expect(bucketOf(STRIKES3, 100n)).toBe(2);
    expect(bucketOf(STRIKES3, 1_000n)).toBe(4);
  });

  test("holdings layer into full sets, a refund and nested bets that add back exactly", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let trial = 0; trial < 500; trial++) {
      const count = 2 + (rand() % 9);
      const balances = Array.from(
        { length: count },
        () => BigInt(rand() % 5) * BigInt(rand() % 1000),
      );
      const { sets, refund, layers } = holdingLayers(balances);
      const rebuilt = new Array<bigint>(count).fill(sets);
      rebuilt[0]! += refund;
      for (const layer of layers)
        for (let atom = 1; atom < count; atom++)
          if ((layer.mask >> atom) & 1) rebuilt[atom]! += layer.units;
      expect(rebuilt).toEqual(balances);
      for (const layer of layers) expect(layer.units > 0n).toBe(true);
    }
  });

  test("maker data, compact signatures and grant rules", () => {
    const data = packMakerData(5n, 1_800_000_123n);
    expect(unpackMakerData(data)).toEqual({ epoch: 5n, signedAt: 1_800_000_123n });
    expect(packMakerData(0x1000005n, 1n) & 0xffffffn).toBe(5n);
    const now = 1_800_000_000n;
    const grant = {
      expiresAt: now + 86_400n,
      maxBuy: 10n,
      totalBuy: 100n,
      maxSell: 0n,
      totalSell: 0n,
      maxFeeBps: 100,
      permissions: WORLD_BUY,
    };
    expect(worldGrantProblem(grant, now)).toBeNull();
    expect(
      worldGrantProblem({ ...grant, permissions: WORLD_BUY | WORLD_SELL }, now),
    ).not.toBeNull();
    expect(worldGrantProblem({ ...grant, totalBuy: 5n }, now)).not.toBeNull();
    expect(worldGrantProblem({ ...grant, expiresAt: now + 91n * 86_400n }, now)).not.toBeNull();
  });
});

const STRIKES3 = [100n, 200n, 300n];

// ------------------------------------------------------------------ against the contracts

let node: Anvil;
let worlds: Worlds;
const [admin, alice, bob, walletMaker, , , delegate] = accounts.map((a) => a.address) as Address[];
const owners = () => [admin!, alice!, bob!, walletMaker!, delegate!, worlds.vault];

const now = async () => Number((await node.client.getBlock()).timestamp);
const read = <T>(address: Address, abi: unknown, functionName: string, args: unknown[] = []) =>
  node.client.readContract({ address, abi, functionName, args } as never) as Promise<T>;
const books = <T>(fn: string, args: unknown[] = []) =>
  read<T>(worlds.books, worldBooksAbi, fn, args);
const vault = <T>(fn: string, args: unknown[] = []) =>
  read<T>(worlds.vault, worldVaultAbi, fn, args);

/** The replica rebuilt from every log of the deployment. */
async function replay(): Promise<WorldState> {
  const deployment = {
    chainId: node.chain.id,
    books: worlds.books,
    oracle: worlds.oracle,
    quote: worlds.usdg,
    vaults: [worlds.vault],
  };
  const s = emptyWorldState(deployment);
  const logs = await node.publicClient.getLogs({
    address: [worlds.books, worlds.oracle, worlds.vault],
    fromBlock: worlds.deploymentBlock,
    toBlock: "latest",
  });
  const stamps = new Map<Hex, bigint>();
  const events: WorldEvent[] = [];
  for (const log of logs) {
    if (!stamps.has(log.blockHash!))
      stamps.set(
        log.blockHash!,
        (await node.publicClient.getBlock({ blockHash: log.blockHash! })).timestamp,
      );
    events.push(decodeWorldLog(s.deployment, log, stamps.get(log.blockHash!)!));
  }
  for (const batch of worldTransactions(events)) applyWorldTransaction(s, batch);
  const head = await node.client.getBlock();
  s.block = head.number;
  s.hash = head.hash;
  s.timestamp = head.timestamp;
  return s;
}

/** Every field the replica keeps, against the contracts' views. */
async function expectMatchesChain(s: WorldState) {
  expect(worldLedgerIssues(s)).toEqual([]);
  expect(await books<bigint>("liability")).toBe(s.liability);
  expect(await books<bigint>("fees")).toBe(s.fees);
  expect(await books<boolean>("paused")).toBe(s.config.paused);
  for (const owner of owners()) {
    expect(await books<bigint>("credit", [owner])).toBe(worldCreditOf(s, owner));
    expect(await books<bigint>("delegationEpoch", [owner])).toBe(
      s.delegationEpochs.get(owner) ?? 0n,
    );
  }
  const head = BigInt(await now());
  for (const b of s.books.values()) {
    expect(await books<bigint>("backing", [b.id])).toBe(b.backing);
    const view = await books<Record<string, unknown>>("book", [b.id]);
    expect([view.status, view.winner, view.frozen, view.held, view.atomCount]).toEqual([
      b.status,
      b.winner,
      b.frozen,
      b.held,
      b.atoms,
    ]);
    expect(await books<number>("state", [b.id])).toBe(bookStateAt(s, b, head));
    for (const owner of owners())
      expect(await books<bigint[]>("atoms", [b.id, owner])).toEqual(atomsOf(s, b.id, owner));
    const fix = await books<Record<string, bigint>>("fix", [b.id]);
    expect(BigInt(fix.proposedAt!)).toBe(b.fix?.proposedAt ?? 0n);
    expect(BigInt(fix.price!)).toBe(b.fix?.price ?? 0n);
  }
  for (const key of KEYS) {
    const [state, resolvedAt] = await read<[number, number]>(
      worlds.oracle,
      eventOracleAbi,
      "outcome",
      [key],
    );
    const e = s.events.get(key);
    expect(state).toBe(e?.state ?? EVENT_STATE.unknown);
    expect(BigInt(resolvedAt)).toBe(e?.resolvedAt ?? 0n);
  }
  const grant = await books<[Record<string, unknown>, Record<string, bigint>]>("grant", [
    alice,
    delegate,
  ]);
  const g = s.grants.get(worldGrantKey(alice!, delegate!));
  expect(BigInt(grant[1].remainingBuy!)).toBe(g?.remainingBuy ?? 0n);
  expect(BigInt(grant[1].remainingSell!)).toBe(g?.remainingSell ?? 0n);
  expect(Boolean(grant[0].revoked)).toBe(g?.revoked ?? false);
  const v = s.vaults.get(worlds.vault)!;
  const totals = await vault<bigint[]>("totals");
  expect([totals[0], totals[1], totals[2]]).toEqual([
    worldCreditOf(s, v.address),
    v.sumLo,
    v.sumHi,
  ]);
  for (const b of s.books.values()) {
    const p = await vault<Record<string, bigint>>("position", [b.id]);
    const r = v.positions.get(b.id) ?? { lo: 0n, hi: 0n, cost: 0n };
    expect([BigInt(p.lo!), BigInt(p.hi!), BigInt(p.cost!)]).toEqual([r.lo, r.hi, r.cost]);
  }
  for (const key of KEYS)
    expect(await vault<bigint>("legRisk", [key])).toBe(v.legRisk.get(key) ?? 0n);
  const day = await vault<Record<string, bigint>>("day");
  expect([BigInt(day.day!), BigInt(day.used!)]).toEqual([v.day.day, v.day.used]);
  expect(await vault<bigint>("refNav")).toBe(v.refNav);
  expect(await vault<bigint>("lastNavPerShare")).toBe(v.lastNavPerShare);
  expect(await vault<bigint>("quoteEpoch")).toBe(v.quoteEpoch);
  expect(await vault<bigint>("totalSupply")).toBe(v.totalSupply);
  expect(await vault<boolean>("paused")).toBe(v.paused);
  const [open, closed] = await vault<[bigint, bigint]>("batches");
  expect([Number(open), Number(closed)]).toEqual([v.batchId, v.closedBatch]);
  for (const bt of v.batches.values()) {
    const onchain = await vault<Record<string, unknown>>("batch", [bt.id]);
    expect([
      onchain.depositAssets,
      onchain.redeemShares,
      onchain.guaranteed,
      onchain.best,
      onchain.supply,
      onchain.nav,
      onchain.minted,
      onchain.filled,
      onchain.paid,
      BigInt(onchain.openedAt as number),
      Number(onchain.status),
      onchain.refunded,
    ]).toEqual([
      bt.depositAssets,
      bt.redeemShares,
      bt.guaranteed,
      bt.best,
      bt.supply,
      bt.nav,
      bt.minted,
      bt.filled,
      bt.paid,
      bt.openedAt,
      bt.status,
      bt.refunded,
    ]);
    for (const owner of owners()) {
      const [assets, shares] = await vault<[bigint, bigint]>("requests", [bt.id, owner]);
      const r = v.requests.get(`${bt.id}:${owner}`);
      expect([assets, shares]).toEqual([r?.assets ?? 0n, r?.shares ?? 0n]);
    }
  }
  const held = await vault<bigint[]>("held");
  expect([...held]).toEqual([v.pendingAssets, v.owedAssets, v.escrowShares]);
  for (const owner of [...owners(), getAddress("0x000000000000000000000000000000000000dEaD")])
    expect(await vault<bigint>("balanceOf", [owner])).toBe(v.shares.get(owner) ?? 0n);
  expect(await vault<Record<string, unknown>>("limits")).toEqual(v.limits as never);
  expect(await vault<boolean>("feedAllowed", [worlds.feed])).toBe(v.feeds.includes(worlds.feed));
  // The checkpoint round trip is exact.
  expect(encodeWorldCheckpoint(restoreWorldState(encodeWorldCheckpoint(s)))).toBe(
    encodeWorldCheckpoint(s),
  );
}

beforeAll(async () => {
  node = await startAnvil();
  worlds = await deployWorlds(node, await now());
}, 120_000);
afterAll(() => node?.stop());

describe("the world contracts", () => {
  let priced: ReturnType<typeof pricedDef>;
  let eventOnly: ReturnType<typeof eventDef>;

  test("book hashes, quote digests and commitments match the contracts' own", async () => {
    const t = await now();
    priced = pricedDef(worlds, t);
    eventOnly = eventDef(t);
    expect(bookDefProblem(priced, t, URI)).toBeNull();
    expect(bookDefProblem(eventOnly, t, URI)).toBeNull();
    expect(
      bookDefProblem({ ...priced, metadataHash: keccak256(stringToBytes("x")) }, t, URI),
    ).not.toBeNull();
    expect(
      bookDefProblem({ ...priced, strikes: [...priced.strikes].reverse() }, t, URI),
    ).not.toBeNull();
    await send(node, 0, worlds.w.createBook(priced, URI));
    await send(node, 0, worlds.w.createBook(eventOnly, URI));
    expect(await books<bigint>("bookOf", [bookDefHash(priced)])).toBe(1n);
    expect(await books<bigint>("bookOf", [bookDefHash(eventOnly)])).toBe(2n);
    expect(atomCount(priced)).toBe(7);
    const { quote } = await walletQuote(node, worlds, 3, {
      taker: alice!,
      book: 1n,
      mask: 0b1110000,
      units: 5n,
      refund: 3n,
      sell: false,
      price: 4n,
      expiry: BigInt(t + 100),
    });
    expect(await books<Hex>("quoteDigest", [{ ...quote, expiry: Number(quote.expiry) }])).toBe(
      worldQuoteDigest(node.chain.id, worlds.books, quote),
    );
    const evidence = keccak256(stringToBytes("e"));
    expect(
      await read<Hex>(worlds.oracle, eventOracleAbi, "resolutionHash", [KEYS[0], 4, evidence, "u"]),
    ).toBe(eventResolutionHash(node.chain.id, worlds.oracle, KEYS[0]!, 4, evidence, "u"));
    expect(await books<Hex>("fixHash", [1n, 123n, evidence, "u"])).toBe(
      fixHash(node.chain.id, worlds.books, 1n, 123n, evidence, "u"),
    );
    // A signature's compact form recovers on chain only with a low s.
    const { signature } = await walletQuote(node, worlds, 3, { ...quote });
    expect(compactSignature(signature).lowS).toBe(true);
  }, 60_000);

  test("the hook mirror refuses exactly the quotes the vault refuses", async () => {
    const s = await replay();
    const v = s.vaults.get(worlds.vault)!;
    const t = await now();
    const base = {
      taker: bob!,
      book: 1n,
      mask: outcomeMask({ kind: "above", strike: 3 }, 7),
      units: 250_000_000n,
      refund: 100_000_000n,
      sell: false,
      price: 100_000_000n,
      expiry: BigInt(t + 200),
    };
    const cases: [string, Promise<{ quote: WorldQuote; signature: Hex }>, string | null][] = [
      ["valid", vaultQuote(node, worlds, base, BigInt(t)), null],
      [
        "too long",
        vaultQuote(node, worlds, { ...base, expiry: BigInt(t + 400) }, BigInt(t)),
        "QuoteExpiry",
      ],
      ["signed later", vaultQuote(node, worlds, base, BigInt(t + 60)), "QuoteExpiry"],
      [
        "inside the margin",
        vaultQuote(node, worlds, { ...base, refund: 0n, price: 200_000n }, BigInt(t)),
        "QuotePrice",
      ],
      [
        "over the size cap",
        vaultQuote(node, worlds, { ...base, units: 200_000_000_000n }, BigInt(t)),
        "QuoteSize",
      ],
      ["stale epoch", vaultQuote(node, worlds, base, BigInt(t), 7n), "QuoteEpoch"],
    ];
    for (const [name, made, expected] of cases) {
      const { quote, signature } = await made;
      const signer = await recoverTypedDataAddress({
        domain: worldQuoteDomain(node.chain.id, worlds.books),
        types: WORLD_QUOTE_TYPES,
        primaryType: "WorldQuote",
        message: worldQuoteMessage(quote),
        signature,
      });
      const problem = vaultHookProblem(s, v, quote, signer, BigInt(await now()) + 1n);
      const call = worlds.w.fillQuote(quote, signature);
      const reverted = await node.publicClient
        .call({ account: bob!, to: call.to, data: call.data })
        .then(
          () => false,
          () => true,
        );
      expect([name, problem?.split(":")[0] ?? null]).toEqual([name, expected]);
      expect([name, reverted]).toEqual([name, expected !== null]);
    }
    // A wallet's signature on a vault nonce is not a keeper's.
    const forged = await walletQuote(node, worlds, 3, base);
    const quote = {
      ...forged.quote,
      nonce: (BigInt(worlds.vault) << 96n) | 999n,
      makerData: packMakerData(0n, BigInt(t)),
    };
    expect(vaultHookProblem(s, v, quote, walletMaker!, BigInt(t))?.startsWith("QuoteSigner")).toBe(
      true,
    );
  }, 60_000);

  test("fills, positions, delegation, vault batches, resolution and fixing replay exactly", async () => {
    // Alice buys Maya's world bet from a wallet maker, which splits the sets it sells.
    let t = await now();
    const bet = await walletQuote(node, worlds, 3, {
      taker: alice!,
      book: 1n,
      mask: outcomeMask({ kind: "above", strike: 3 }, 7),
      units: 1_538_000_000n,
      refund: 0n,
      sell: false,
      price: 20_000_000n,
      expiry: BigInt(t + 120),
    });
    await send(node, 1, worlds.w.fillQuote(bet.quote, bet.signature));
    // Bob buys a conditional payout from the vault: 250 units above $240, $100 refund.
    t = await now();
    const cond = await vaultQuote(
      node,
      worlds,
      {
        taker: bob!,
        book: 1n,
        mask: outcomeMask({ kind: "above", strike: 3 }, 7),
        units: 250_000_000n,
        refund: 100_000_000n,
        sell: false,
        price: 100_000_000n,
        expiry: BigInt(t + 200),
      },
      BigInt(t),
    );
    await send(node, 2, worlds.w.fillQuote(cond.quote, cond.signature));
    // Alice's delegate buys the rate-cut world for her from the vault.
    await send(
      node,
      1,
      worlds.w.approveDelegate(delegate!, {
        expiresAt: BigInt(t + 30 * 86_400),
        maxBuy: 1_000_000_000n,
        totalBuy: 5_000_000_000n,
        maxSell: 2_000_000_000n,
        totalSell: 2_000_000_000n,
        maxFeeBps: 200,
        permissions: 3,
      }),
    );
    t = await now();
    const delegated = await vaultQuote(
      node,
      worlds,
      {
        taker: alice!,
        book: 2n,
        mask: 0b10,
        units: 100_000_000n,
        refund: 0n,
        sell: false,
        price: 40_000_000n,
        expiry: BigInt(t + 200),
      },
      BigInt(t),
    );
    await send(node, 6, worlds.w.fillQuoteFor(delegated.quote, delegated.signature));
    // Alice cashes out part of her bet to the vault, which merges the sets that completes.
    t = await now();
    const cashout = await vaultQuote(
      node,
      worlds,
      {
        taker: alice!,
        book: 1n,
        mask: outcomeMask({ kind: "above", strike: 3 }, 7),
        units: 500_000_000n,
        refund: 0n,
        sell: true,
        price: 2_000_000n,
        expiry: BigInt(t + 200),
      },
      BigInt(t),
    );
    await send(node, 1, worlds.w.fillQuote(cashout.quote, cashout.signature));
    // Positions move outside fills too.
    await send(node, 2, worlds.w.split(2n, 10_000_000n));
    await send(node, 2, worlds.w.merge(2n, 4_000_000n));
    await send(node, 2, worlds.w.transferAtoms(2n, 1, alice!, 3_000_000n));
    await send(node, 3, worlds.w.invalidateNonces(0n, 1n << 200n));
    await send(node, 0, worlds.w.pause(true, `0x${"01".repeat(32)}`));
    await send(node, 0, worlds.w.pause(false, `0x${"02".repeat(32)}`));
    await send(node, 4, worlds.v.advanceQuoteEpoch());
    let s = await replay();
    await expectMatchesChain(s);
    expect(s.books.get(1)!.fills).toBe(3);
    expect(s.vaults.get(worlds.vault)!.quoteEpoch).toBe(1n);

    // A batch: Bob deposits, the admin redeems; the marker marks at the guaranteed value.
    await send(node, 2, worlds.v.requestDeposit(1_000_000_000n));
    await send(node, 0, worlds.v.requestRedeem(10n ** 19n));
    await warp(node, (await now()) + 86_401);
    await send(node, 1, worlds.v.closeBatch());
    const batch = await vault<Record<string, bigint>>("batch", [1n]);
    await send(node, 5, worlds.v.mark(1n, batch.guaranteed!));
    await send(node, 2, worlds.v.claim(1n, bob!));
    await send(node, 2, worlds.v.claim(1n, admin!));
    s = await replay();
    await expectMatchesChain(s);

    // The rate cut happens: the event-only book passes and its holders redeem.
    await resolveEvent(node, worlds, KEYS[3]!, EVENT_STATE.yes);
    await send(node, 1, worlds.w.redeem(2n));
    await send(node, 2, worlds.w.redeem(2n));
    await send(node, 0, worlds.v.settle([2n]));
    await send(node, 1, worlds.w.revokeDelegate(delegate!));
    s = await replay();
    await expectMatchesChain(s);
    expect(s.books.get(2)!.status).toBe(3);

    // Every leg of Maya's world happens; NVDA fixes at $245, so atom 4 pays.
    for (const key of KEYS.slice(0, 3)) await resolveEvent(node, worlds, key, EVENT_STATE.yes);
    const fixing = priced.fixingTime;
    await warp(node, fixing);
    await node.wallet(0).writeContract({
      address: worlds.feed,
      abi: priceFeedAbi,
      functionName: "update",
      args: [2n, 245n * 10n ** 8n, BigInt(fixing)],
    });
    s = await replay();
    expect(bookStateAt(s, s.books.get(1)!, BigInt(await now()))).toBe(BOOK_STATE.awaitingFix);
    await send(node, 1, worlds.w.proposeFix(1n, 2n));
    s = await replay();
    await expectMatchesChain(s);
    await warp(node, (await now()) + 3_601);
    await send(node, 1, worlds.w.finalizeFix(1n));
    for (const i of [1, 2, 3]) await send(node, i, worlds.w.redeem(1n));
    await send(node, 0, worlds.v.settle([1n]));
    s = await replay();
    await expectMatchesChain(s);
    const book = s.books.get(1)!;
    expect([book.status, book.winner, book.fixedPrice]).toEqual([4, 4, 245n * 10n ** 8n]);
    // Every winning atom redeemed: nothing backs the book any more.
    expect(book.backing).toBe(0n);
    expect(s.vaults.get(worlds.vault)!.positions.size).toBe(0);
  }, 120_000);
});
