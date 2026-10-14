/** Delegated market orders with RFQ, against a simulated chain that counts every call: no maker
 * online costs nothing, and quotes cost one database read and no RPC call: they settle in the
 * order's own transaction. */
import { expect, test } from "bun:test";
import type { Database } from "@conditional-stocks/db";
import {
  conditionalStocksAbi,
  contractQuoteNonce,
  type OrderWire,
  QUOTE_TYPES,
  quoteDomain,
  unpackOrder,
} from "@conditional-stocks/evm-client";
import type { ChainState } from "@conditional-stocks/evm-client/ledger";
import {
  type Address,
  decodeFunctionData,
  type Hex,
  keccak256,
  type Log,
  type PublicClient,
  parseTransaction,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { quoteTerms } from "../src/rfq/auction.ts";
import { RfqHub, type RfqSession } from "../src/rfq/hub.ts";
import type { MakerIdentity } from "../src/rfq/protocol.ts";
import { DelegatedTrading } from "../src/trading/delegated.ts";
import { createOrderPlan } from "../src/trading/plan.ts";
import {
  ALICE,
  BOB,
  chain,
  DOLLAR,
  EXCHANGE,
  exchangeLog,
  fakeIndexer,
  fundedMaker,
  marketOrder,
  NOW,
  rest,
  SHARE,
} from "./rfq-fixtures.ts";

const signer = privateKeyToAccount(generatePrivateKey());
const makerKey = privateKeyToAccount(generatePrivateKey());
const MAKER = makerKey.address;
const cents = (n: bigint) => (n * DOLLAR) / 100n;
const QUOTE_SEQ = 2n ** 32n - 1n;

/** The exchange as the delegate sees it: a placement fills its quotes, then its makers. */
/** A maker contract's ERC-1271 answer (a Δ-vault vouching for its keeper's signatures). */
let vouchFor: ((signature: Hex) => boolean) | null = null;
function simulate() {
  const s: ChainState = chain();
  rest(s, BOB, 1, 2n * SHARE, 101n * DOLLAR, 3n);
  fundedMaker(s, MAKER);
  // Alice's 1-click grant to the delegate.
  fundedMaker(s, ALICE, 0n, undefined, signer.address);
  const calls: Record<string, number> = {};
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const receipts = new Map<Hex, { status: "success"; logs: Log[]; transactionHash: Hex }>();
  const sent: { fn: string; makers: bigint[]; fills: bigint[] }[] = [];
  const client = {
    chain: { id: 31337 },
    async call() {
      count("call");
    },
    async prepareTransactionRequest(request: Record<string, unknown>) {
      count("prepareTransactionRequest");
      return {
        to: request.to,
        data: request.data,
        gas: 300_000n,
        nonce: 9,
        chainId: 31337,
        type: "eip1559",
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
      };
    },
    async sendRawTransaction({ serializedTransaction }: { serializedTransaction: Hex }) {
      count("sendRawTransaction");
      const hash = keccak256(serializedTransaction);
      const call = decodeFunctionData({
        abi: conditionalStocksAbi,
        data: parseTransaction(serializedTransaction).data!,
      });
      const [owner, word, , makerWord, list] = call.args as unknown as [
        Address,
        bigint,
        bigint,
        bigint,
        { terms: bigint; fill: bigint }[] | undefined,
      ];
      const order = unpackOrder(word);
      const makers = [0, 1, 2, 3, 4, 5, 6, 7]
        .map((i) => (makerWord >> BigInt(32 * i)) & 0xffff_ffffn)
        .filter((e) => e > 0n)
        .map((e) => e - 1n);
      const quotes = call.functionName === "placeWithQuotes" ? (list ?? []) : [];
      sent.push({ fn: call.functionName, makers, fills: quotes.map((q) => q.fill) });
      const m = s.markets.get(1)!;
      const seq = m.seq[0];
      const logs: Log[] = [
        exchangeLog("OrderPlaced", {
          market: 1,
          owner,
          order: word,
          seq,
          delegate: signer.address,
        }),
      ];
      // Quotes first, each up to its fill; then the makers greedily.
      let remaining = order.quantity;
      for (const q of quotes) {
        const fill = q.fill < remaining ? q.fill : remaining;
        remaining -= fill;
        const ticks = (q.terms >> 96n) & (2n ** 64n - 1n);
        logs.push(
          exchangeLog("QuoteFilled", {
            market: 1,
            maker: MAKER,
            fill: fill | (QUOTE_SEQ << 96n) | (seq << 128n) | (ticks << 176n),
            amounts: 0n,
            fees: 0n,
          }),
        );
      }
      for (const makerSeq of makers) {
        const resting = [...s.orders.values()].find((o) => o.seq === makerSeq)!;
        const fill = remaining < resting.remaining ? remaining : resting.remaining;
        remaining -= fill;
        logs.push(
          exchangeLog("Trade", {
            market: 1,
            fill: fill | (makerSeq << 96n) | (seq << 128n),
            amounts: 0n,
            fees: 0n,
          }),
        );
      }
      m.seq[0] = seq + 1n;
      receipts.set(hash, { status: "success", logs, transactionHash: hash });
      return hash;
    },
    async readContract({ functionName, args }: { functionName: string; args: [Hex, Hex] }) {
      count("readContract");
      if (functionName !== "isValidSignature" || !vouchFor) throw new Error("unexpected read");
      return vouchFor(args[1]) ? "0x1626ba7e" : "0xffffffff";
    },
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      count("getTransactionReceipt");
      const r = receipts.get(hash);
      if (!r) throw new Error("not found");
      return r;
    },
  } as unknown as PublicClient;
  const indexer = fakeIndexer(() => s);
  // The journal, by client id.
  const journal = new Map<string, unknown[]>();
  const entry = (clientId: string) => {
    const j = journal.get(clientId);
    return j
      ? {
          order_terms_hash: j[3] as string,
          delegate: j[4] as string,
          tx_hash: j[5] as string,
          raw: j[6] as string,
        }
      : undefined;
  };
  const queries = {
    async delegatedSubmission(_domain: string, _owner: string, clientId: string) {
      count("db.lockedRead");
      return entry(clientId);
    },
    async delegatedSubmissionCount() {
      count("db.count");
      return 0;
    },
    async recordDelegatedSubmission(...args: unknown[]) {
      count("db.record");
      journal.set(args[2] as string, args);
    },
  };
  const db = {
    async delegatedSubmission(_domain: string, _owner: string, clientId: string) {
      count("db.preRead");
      return entry(clientId);
    },
    locked: async (_lock: string, work: (q: typeof queries) => unknown) => work(queries),
  } as unknown as Database;
  const hub = new RfqHub({ windowMs: 300, maxSessionsPerMaker: 2, welcome: () => ({}) });
  const trading = new DelegatedTrading({
    indexer,
    db,
    domain: "test",
    client,
    signer,
    prepare: createOrderPlan(indexer),
    rfq: { hub, chainId: 31337, minQuoteSeconds: 3 },
  });
  return { s, calls, sent, hub, trading };
}

const identity: MakerIdentity = {
  id: "aaaaaaaa-0000-4000-8000-000000000000",
  label: "A",
  wallet: MAKER,
};
/** A maker connection answering every request with a quote signed by `key`. */
function makerSession(
  hub: RfqHub,
  s: ChainState,
  price: bigint,
  shares: bigint,
  key = makerKey,
  nonce = 1n,
) {
  const received: Record<string, unknown>[] = [];
  const session: RfqSession = {
    maker: identity,
    send(message) {
      const m = message as Record<string, unknown>;
      received.push(m);
      if (m.type !== "rfq") return true;
      const order = m.order as { taker: Address; side: 0 | 1 };
      const q = {
        price,
        quantity: shares * SHARE,
        fundingKind: 0,
        expiry: NOW + 30n,
        nonce,
        signature: "0x" as Hex,
      };
      const terms = quoteTerms(s.markets.get(1)!, marketOrder(order.taker, order.side, 0n, 0n), q);
      void key
        .signTypedData({
          domain: quoteDomain(31337, EXCHANGE),
          types: QUOTE_TYPES,
          primaryType: "Quote",
          message: { taker: order.taker, terms, nonce },
        })
        .then((signature) =>
          hub.receive(
            session,
            JSON.stringify({
              type: "quote",
              rfqId: m.id,
              price: price.toString(),
              quantity: q.quantity.toString(),
              expiry: q.expiry.toString(),
              nonce: nonce.toString(),
              signature,
            }),
          ),
        );
      return true;
    },
    close() {},
  };
  hub.attach(session);
  return received;
}
const buy = (shares: bigint, extra: Partial<OrderWire> = {}) =>
  marketOrder(ALICE, 0, shares * SHARE, 102n * DOLLAR, { delegate: signer.address, ...extra });
const of = (received: Record<string, unknown>[], type: string) =>
  received.filter((m) => m.type === type);

test("with no maker online a market order costs exactly what it did before RFQ", async () => {
  const { calls, sent, trading } = simulate();
  const started = performance.now();
  const result = await trading.submit(ALICE, buy(1n), "client-0001");
  expect(performance.now() - started).toBeLessThan(200);
  expect(result.rfq).toBeUndefined();
  // One read, count and journal entry; one simulation, preparation, broadcast and receipt.
  expect(calls).toEqual({
    "db.lockedRead": 1,
    "db.count": 1,
    "db.record": 1,
    call: 1,
    prepareTransactionRequest: 1,
    sendRawTransaction: 1,
    getTransactionReceipt: 1,
  });
  expect(sent).toEqual([{ fn: "placeFor", makers: [3n], fills: [] }]);
});

test("limit orders and journaled retries never go out for quotes", async () => {
  const { s, calls, trading, hub } = simulate();
  const received = makerSession(hub, s, cents(10050n), 1n);
  await trading.submit(ALICE, buy(1n, { tif: 0 }), "client-0002");
  expect(of(received, "rfq")).toHaveLength(0);
  expect(calls["db.preRead"]).toBeUndefined();
  // A market order retried under a journaled client id reads the journal once and asks nobody.
  const order = buy(1n);
  await trading.submit(ALICE, order, "client-0003");
  const asked = of(received, "rfq").length;
  await trading.submit(ALICE, order, "client-0003");
  expect(of(received, "rfq").length).toBe(asked);
});

test("a quote better than the book fills in the order's own transaction, ahead of the book", async () => {
  const { calls, sent, trading, hub, s } = simulate();
  const received = makerSession(hub, s, cents(10050n), 3n);
  const result = await trading.submit(ALICE, buy(4n), "client-0004");
  // The maker heard the whole order and how to sign for it.
  expect(of(received, "rfq")[0]).toMatchObject({
    order: {
      taker: ALICE,
      branch: 0,
      side: 0,
      quantity: (4n * SHARE).toString(),
      limitPriceRawX18: (102n * DOLLAR).toString(),
      tif: 1,
    },
    quoteSide: 1,
    market: { id: "1", tick: "10000", makerFeeBps: 20, takerFeeBps: 50 },
    book: { bestBid: null, bestAsk: (101n * DOLLAR).toString() },
    signing: { primaryType: "Quote", taker: ALICE, minQuoteSeconds: 3 },
  });
  expect(of(received, "quote.accepted")).toHaveLength(1);
  // One transaction: the three quoted shares at $100.50 first, then one of Bob's at $101.
  expect(sent).toEqual([{ fn: "placeWithQuotes", makers: [3n], fills: [3n * SHARE] }]);
  expect(result.rfq).toEqual({
    id: expect.any(String),
    quotes: 1,
    awards: [{ price: cents(10050n).toString(), quantity: (3n * SHARE).toString() }],
  });
  // RFQ added one journal read; not one RPC call (the quote was checked against the replica,
  // its signature locally) and no transaction: the window closed once the only maker answered.
  expect(calls).toEqual({
    "db.preRead": 1,
    "db.lockedRead": 1,
    "db.count": 1,
    "db.record": 1,
    call: 1,
    prepareTransactionRequest: 1,
    sendRawTransaction: 1,
    getTransactionReceipt: 1,
  });
  expect(of(received, "rfq.result")[0]).toMatchObject({
    outcome: "filled",
    awarded: (3n * SHARE).toString(),
    filled: (3n * SHARE).toString(),
  });
});

test("a quote signed by another wallet than the maker's is refused", async () => {
  const { s, sent, trading, hub } = simulate();
  const received = makerSession(
    hub,
    s,
    cents(10050n),
    1n,
    privateKeyToAccount(generatePrivateKey()),
  );
  await trading.submit(ALICE, buy(2n), "client-0005");
  expect(of(received, "quote.rejected")[0]).toMatchObject({
    reason: "The quote is not signed by the maker's wallet",
  });
  expect(sent).toEqual([{ fn: "placeFor", makers: [3n], fills: [] }]);
});

test("a quote the book beats is told it lost; a filled nonce is refused next time", async () => {
  const { s, sent, trading, hub } = simulate();
  const received = makerSession(hub, s, cents(10150n), 1n);
  await trading.submit(ALICE, buy(2n), "client-0006");
  expect(sent[0]!.fn).toBe("placeFor");
  expect(of(received, "rfq.result")[0]).toMatchObject({ outcome: "lost", awarded: "0" });

  const again = simulate();
  const answers = makerSession(again.hub, again.s, cents(10050n), 1n);
  await again.trading.submit(ALICE, buy(1n), "client-0007");
  expect(of(answers, "rfq.result")[0]).toMatchObject({ outcome: "filled" });
  await again.trading.submit(ALICE, buy(1n), "client-0008");
  expect(of(answers, "quote.rejected")[0]).toMatchObject({
    reason: "This nonce has already filled",
  });
});

test("a maker contract's quotes are signed by a key it vouches for (asked once, then cached)", async () => {
  const keeper = privateKeyToAccount(generatePrivateKey());
  const { calls, sent, trading, hub, s } = simulate();
  // The vault (the maker wallet here) vouches only for its keeper's signatures.
  vouchFor = () => true;
  const nonce = contractQuoteNonce(MAKER, 5n);
  const received = makerSession(hub, s, cents(10050n), 1n, keeper, nonce);
  await trading.submit(ALICE, buy(1n), "client-0101");
  expect(of(received, "quote.accepted")).toHaveLength(1);
  expect(sent.at(-1)).toMatchObject({ fn: "placeWithQuotes", fills: [SHARE] });
  // The next quote of the same keeper needs no read.
  const again = makerSession(hub, s, cents(10050n), 1n, keeper, nonce + 1n);
  await trading.submit(ALICE, buy(1n), "client-0102");
  expect(of(again, "quote.accepted")).toHaveLength(1);
  expect(calls.readContract).toBe(1);
  vouchFor = null;
});

test("a maker contract refuses unknown signers, and a nonce naming another contract is refused", async () => {
  const { sent, trading, hub, s } = simulate();
  vouchFor = () => false;
  const refused = makerSession(
    hub,
    s,
    cents(10050n),
    1n,
    privateKeyToAccount(generatePrivateKey()),
    contractQuoteNonce(MAKER, 9n),
  );
  await trading.submit(ALICE, buy(1n), "client-0103");
  expect(of(refused, "quote.rejected")[0]).toMatchObject({
    reason: "The maker contract does not accept this signer",
  });
  const elsewhere = simulate();
  const named = makerSession(
    elsewhere.hub,
    elsewhere.s,
    cents(10050n),
    1n,
    makerKey,
    contractQuoteNonce(BOB, 9n),
  );
  await elsewhere.trading.submit(ALICE, buy(1n), "client-0104");
  expect(of(named, "quote.rejected")[0]).toMatchObject({ reason: "The nonce names another maker" });
  expect(sent.every((t) => t.fn === "placeFor")).toBe(true);
  vouchFor = null;
});
