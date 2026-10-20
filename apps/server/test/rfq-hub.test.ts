/** The RFQ hub: who receives a request, how long it stays open, and what makers hear back. */
import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { CLOSE_LIMIT, CLOSE_REVOKED, RfqHub, type RfqSession } from "../src/rfq/hub.ts";
import { MAX_MAKER_FRAME, type MakerIdentity, type MakerQuote } from "../src/rfq/protocol.ts";

const wallet = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const ids = ["a", "b", "c", "d"].map((c) => `${c.repeat(8)}-0000-4000-8000-000000000000`);
const maker = (n: number): MakerIdentity => ({
  id: ids[n]!,
  label: `maker ${n}`,
  wallet: wallet(n + 1),
});
const rfqId = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

interface FakeSession extends RfqSession {
  sent: Record<string, unknown>[];
  closed: { code: number; reason: string } | null;
  /** What the maker answers each request with (sent back through the hub). */
  answer?: (request: Record<string, unknown>) => object | null;
}
function session(hub: () => RfqHub, identity: MakerIdentity, deliver = true): FakeSession {
  const s: FakeSession = {
    maker: identity,
    sent: [],
    closed: null,
    send(message) {
      if (!deliver) return false;
      const m = message as Record<string, unknown>;
      s.sent.push(m);
      if (m.type === "rfq" && s.answer) {
        const reply = s.answer(m);
        if (reply) queueMicrotask(() => hub().receive(s, JSON.stringify(reply)));
      }
      return true;
    },
    close(code, reason) {
      s.closed = { code, reason };
    },
  };
  return s;
}
const SIGNATURE = `0x${"11".repeat(65)}`;
const quote = (id: string, price: string, quantity = "1000") => ({
  type: "quote",
  rfqId: id,
  price,
  quantity,
  expiry: "1900000000",
  nonce: "7",
  signature: SIGNATURE,
});
const newHub = (windowMs = 500, maxSessionsPerMaker = 2) => {
  const hub = new RfqHub({
    windowMs,
    maxSessionsPerMaker,
    welcome: () => ({ chainId: 31337, delegate: wallet(0xde1e) }),
  });
  return hub;
};
const accept = () => null;
const ofType = (s: FakeSession, type: string) => s.sent.filter((m) => m.type === type);

test("with no maker online a request resolves at once, without waiting the window", async () => {
  const hub = newHub(60_000);
  const started = performance.now();
  expect(await hub.collect({ id: rfqId(1), request: { type: "rfq" }, validate: accept })).toEqual(
    [],
  );
  expect(performance.now() - started).toBeLessThan(20);
  expect(hub.makers()).toBe(0);
});

test("makers hear about each order except their own, and a fully answered request closes early", async () => {
  let hub!: RfqHub;
  hub = newHub(60_000);
  const [one, two, owner] = [0, 1, 2].map((n) => session(() => hub, maker(n)));
  one!.answer = (r) => quote(String(r.id), "100");
  two!.answer = (r) => ({ type: "decline", rfqId: r.id });
  for (const s of [one!, two!, owner!]) expect(hub.attach(s)).toBe(true);
  // Each connection is greeted with the stream's terms.
  expect(ofType(one!, "welcome")[0]).toMatchObject({
    version: 1,
    maker: maker(0),
    quoteWindowMs: 60_000,
    delegate: wallet(0xde1e),
  });
  expect(hub.makers()).toBe(3);
  expect(hub.makers(maker(2).wallet)).toBe(2);

  const started = performance.now();
  const quotes = await hub.collect({
    id: rfqId(2),
    request: { type: "rfq", id: rfqId(2) },
    exclude: maker(2).wallet,
    validate: accept,
  });
  // Both recipients answered, so the 60 s window did not run out.
  expect(performance.now() - started).toBeLessThan(100);
  expect(quotes).toHaveLength(1);
  expect(quotes[0]).toMatchObject({
    maker: maker(0),
    terms: { price: 100n, quantity: 1000n, fundingKind: 0, expiry: 1_900_000_000n, nonce: 7n },
  });
  expect(ofType(one!, "quote.accepted")).toEqual([{ type: "quote.accepted", rfqId: rfqId(2) }]);
  // The order's owner never sees its own request.
  expect(ofType(owner!, "rfq")).toHaveLength(0);
  expect(hub.status(maker(0).id)).toMatchObject({ connections: 1, requests: 1, quotes: 1 });
  expect(hub.status(maker(1).id)).toMatchObject({ requests: 1, declines: 1, quotes: 0 });
});

test("a silent maker holds the request for the window; quotes after it are refused", async () => {
  let hub!: RfqHub;
  hub = newHub(80);
  const [fast, slow] = [0, 1].map((n) => session(() => hub, maker(n)));
  fast!.answer = (r) => quote(String(r.id), "100");
  hub.attach(fast!);
  hub.attach(slow!);
  const started = performance.now();
  const quotes = await hub.collect({
    id: rfqId(3),
    request: { type: "rfq", id: rfqId(3) },
    validate: accept,
  });
  const elapsed = performance.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(75);
  expect(elapsed).toBeLessThan(400);
  expect(quotes.map((q) => q.maker.id)).toEqual([maker(0).id]);
  hub.receive(slow!, JSON.stringify(quote(rfqId(3), "99")));
  expect(ofType(slow!, "quote.rejected")).toEqual([
    {
      type: "quote.rejected",
      rfqId: rfqId(3),
      reason: "The request is closed or was not sent to this maker",
    },
  ]);
});

test("a refused quote can be corrected, a later quote replaces an earlier one, a decline withdraws", async () => {
  const hub = newHub(60);
  const s = session(() => hub, maker(0));
  const other = session(() => hub, maker(1));
  hub.attach(s);
  hub.attach(other);
  // A third maker stays silent, so the request stays open for the whole window.
  hub.attach(session(() => hub, maker(3)));
  const validate = (_m: MakerIdentity, t: MakerQuote) =>
    t.price % 10n ? "Price must be a multiple of the tick" : null;
  const collecting = hub.collect({ id: rfqId(4), request: { type: "rfq" }, validate });
  hub.receive(s, JSON.stringify(quote(rfqId(4), "105")));
  hub.receive(s, JSON.stringify(quote(rfqId(4), "110")));
  hub.receive(s, JSON.stringify(quote(rfqId(4), "100", "5000")));
  hub.receive(other, JSON.stringify(quote(rfqId(4), "90")));
  hub.receive(other, JSON.stringify({ type: "decline", rfqId: rfqId(4) }));
  const quotes = await collecting;
  expect(ofType(s, "quote.rejected")).toEqual([
    { type: "quote.rejected", rfqId: rfqId(4), reason: "Price must be a multiple of the tick" },
  ]);
  expect(quotes).toHaveLength(1);
  expect(quotes[0]!.terms).toMatchObject({ price: 100n, quantity: 5000n, fundingKind: 0 });
  expect(hub.status(maker(0).id)).toMatchObject({ quotes: 2, rejections: 1 });
});

test("a maker may send at most five quotes per request", async () => {
  const hub = newHub(50);
  const s = session(() => hub, maker(0));
  hub.attach(s);
  hub.attach(session(() => hub, maker(1)));
  const collecting = hub.collect({ id: rfqId(5), request: { type: "rfq" }, validate: accept });
  for (let i = 0; i < 6; i++) hub.receive(s, JSON.stringify(quote(rfqId(5), String(100 + i))));
  const quotes = await collecting;
  expect(quotes[0]!.terms.price).toBe(104n);
  expect(ofType(s, "quote.rejected").at(-1)).toMatchObject({
    reason: "At most 5 quotes per request",
  });
});

test("malformed frames are answered with an error, pings with a pong", () => {
  const hub = newHub();
  const s = session(() => hub, maker(0));
  hub.attach(s);
  for (const frame of [
    "not json",
    "[1]",
    JSON.stringify({ type: "subscribe" }),
    JSON.stringify({ type: "quote", rfqId: "x", price: "1", quantity: "1" }),
    JSON.stringify({ type: "quote", rfqId: rfqId(6), price: "-1", quantity: "1" }),
    JSON.stringify({ type: "quote", rfqId: rfqId(6), price: "1", quantity: "1", fundingKind: 2 }),
    JSON.stringify({ ...quote(rfqId(6), "1"), nonce: undefined }),
    JSON.stringify({ ...quote(rfqId(6), "1"), signature: "0x1234" }),
    "x".repeat(MAX_MAKER_FRAME + 1),
  ])
    hub.receive(s, frame);
  expect(ofType(s, "error").map((m) => m.message)).toEqual([
    "Messages are JSON objects",
    "Messages are JSON objects",
    "Unknown message type",
    "Invalid rfqId",
    "price, quantity, expiry and nonce are decimal strings",
    "fundingKind is 0 or 1",
    "price, quantity, expiry and nonce are decimal strings",
    "signature is a 65- or 64-byte hex string",
    "Message too large",
  ]);
  hub.receive(s, JSON.stringify({ type: "ping", id: "p1" }));
  expect(ofType(s, "pong")[0]).toMatchObject({ type: "pong", id: "p1" });
});

test("a maker that disconnects or cannot be reached is not waited for", async () => {
  const hub = newHub(60_000);
  const gone = session(() => hub, maker(0));
  const unreachable = session(() => hub, maker(1), false);
  hub.attach(gone);
  hub.attach(unreachable);
  const started = performance.now();
  const collecting = hub.collect({ id: rfqId(7), request: { type: "rfq" }, validate: accept });
  hub.detach(gone);
  expect(await collecting).toEqual([]);
  expect(performance.now() - started).toBeLessThan(100);
  expect(hub.makers()).toBe(1);
});

test("connections per key are capped; revoking a key or stopping closes its connections", () => {
  const hub = newHub(500, 2);
  const [a, b, c] = [0, 0, 0].map(() => session(() => hub, maker(0)));
  expect(hub.attach(a!)).toBe(true);
  expect(hub.attach(b!)).toBe(true);
  expect(hub.attach(c!)).toBe(false);
  expect(c!.closed?.code).toBe(CLOSE_LIMIT);
  expect(hub.status(maker(0).id).connections).toBe(2);
  // Two connections of one key count as one maker.
  expect(hub.makers()).toBe(1);
  hub.disconnect(maker(0).id);
  expect([a!.closed?.code, b!.closed?.code]).toEqual([CLOSE_REVOKED, CLOSE_REVOKED]);
  expect(hub.makers()).toBe(0);
  const d = session(() => hub, maker(1));
  hub.attach(d);
  hub.closeAll();
  expect(d.closed?.code).toBe(1001);
  expect(hub.makers()).toBe(0);
});

test("results reach every connection of the maker", () => {
  const hub = newHub();
  const [a, b] = [0, 0].map(() => session(() => hub, maker(0)));
  hub.attach(a!);
  hub.attach(b!);
  hub.notify(maker(0).id, { type: "rfq.result", outcome: "filled" });
  expect(ofType(a!, "rfq.result")).toHaveLength(1);
  expect(ofType(b!, "rfq.result")).toHaveLength(1);
});

test("a check that resolves later still decides, and a later quote of the same maker wins", async () => {
  const hub = newHub(60);
  const s = session(() => hub, maker(0));
  hub.attach(s);
  hub.attach(session(() => hub, maker(1)));
  // The first quote's check resolves after the second's: the second still stands.
  const validate = (_m: MakerIdentity, t: MakerQuote) =>
    new Promise<string | null>((resolve) =>
      setTimeout(() => resolve(t.price === 0n ? "zero" : null), t.price === 100n ? 20 : 1),
    );
  const collecting = hub.collect({ id: rfqId(8), request: { type: "rfq" }, validate });
  hub.receive(s, JSON.stringify(quote(rfqId(8), "100")));
  hub.receive(s, JSON.stringify(quote(rfqId(8), "101")));
  const quotes = await collecting;
  expect(quotes.map((q) => q.terms.price)).toEqual([101n]);
  expect(ofType(s, "quote.accepted")).toHaveLength(1);
});

test("makers' indications combine into the best bid and ask per branch, until they age or go offline", () => {
  let now = 1_000_000;
  const hub = new RfqHub({
    windowMs: 500,
    maxSessionsPerMaker: 2,
    welcome: () => ({}),
    now: () => now,
  });
  const a = session(() => hub, maker(0)),
    b = session(() => hub, maker(1));
  hub.attach(a);
  hub.attach(b);
  const post = (s: FakeSession, prices: unknown) =>
    hub.receive(s, JSON.stringify({ type: "indications", prices }));
  post(a, [
    { market: 1, branch: 0, bid: "100", ask: "110" },
    { market: 1, branch: 1, bid: "90", ask: null },
  ]);
  now += 5_000;
  post(b, [{ market: 1, branch: 0, bid: "102", ask: "112" }]);
  expect(hub.prices()).toEqual([
    { market: 1, branch: 0, bid: 102n, ask: 110n, at: 1_005_000 },
    { market: 1, branch: 1, bid: 90n, ask: null, at: 1_000_000 },
  ]);
  // A crossed or malformed frame is refused and changes nothing.
  post(b, [{ market: 1, branch: 0, bid: "120", ask: "110" }]);
  post(b, [{ market: 0, branch: 2, bid: "1", ask: "2" }]);
  expect(b.sent.filter((m) => m.type === "error")).toHaveLength(2);
  expect(hub.prices()[0]).toMatchObject({ bid: 102n, ask: 110n });
  // Maker a's prices age out; b's go with its connection.
  now += 26_000;
  expect(hub.prices()).toEqual([{ market: 1, branch: 0, bid: 102n, ask: 112n, at: 1_005_000 }]);
  hub.detach(b);
  expect(hub.prices()).toEqual([]);
});
