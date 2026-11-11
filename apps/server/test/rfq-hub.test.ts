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

// ---------------------------------------------------------------- standing requests

/** A standing request and what it reported, for the tests below. */
function standing(hub: RfqHub, id: string, exclude?: MakerIdentity) {
  const stood: string[] = [];
  const left: string[] = [];
  const request = hub.open<MakerQuote>({
    id,
    kind: "market",
    request: (replay) => ({ type: "rfq", id, replay }),
    ...(exclude ? { exclude: exclude.wallet } : {}),
    validate: accept,
    onQuote: (q, replaced) =>
      void stood.push(
        `${q.maker.label}@${q.terms.price}${replaced ? ` over ${replaced.terms.price}` : ""}`,
      ),
    onWithdrawn: (q, why) => void left.push(`${q.maker.label} ${why}`),
  });
  return { request, stood, left };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a standing request outlives its first round: quotes arrive, replace and withdraw until it closes", async () => {
  let hub!: RfqHub;
  hub = newHub(60_000);
  const [one, two] = [0, 1].map((n) => session(() => hub, maker(n)));
  one!.answer = (r) => quote(String(r.id), "100");
  two!.answer = (r) => ({ type: "decline", rfqId: r.id });
  hub.attach(one!);
  hub.attach(two!);
  const started = performance.now();
  const { request, stood, left } = standing(hub, rfqId(20));
  await request.firstRound;
  // Both makers answered, so the 60 s window did not run out; the request is still open.
  expect(performance.now() - started).toBeLessThan(100);
  expect(ofType(one!, "rfq")[0]).toMatchObject({ id: rfqId(20), replay: false });
  expect(request.quotes().map((q) => q.terms.price)).toEqual([100n]);
  // The maker that declined quotes after all, long after the first round.
  hub.receive(two!, JSON.stringify(quote(rfqId(20), "98")));
  hub.receive(one!, JSON.stringify(quote(rfqId(20), "97")));
  expect(stood).toEqual(["maker 0@100", "maker 1@98", "maker 0@97 over 100"]);
  expect(request.quotes().map((q) => `${q.maker.label}@${q.terms.price}`)).toEqual([
    "maker 1@98",
    "maker 0@97",
  ]);
  // Declining after a quote withdraws it; declining again reports nothing.
  hub.receive(two!, JSON.stringify({ type: "decline", rfqId: rfqId(20) }));
  hub.receive(two!, JSON.stringify({ type: "decline", rfqId: rfqId(20) }));
  expect(left).toEqual(["maker 1 withdrawn"]);
  expect(request.quotes()).toHaveLength(1);
  request.close();
  hub.receive(one!, JSON.stringify(quote(rfqId(20), "96")));
  expect(ofType(one!, "quote.rejected").at(-1)).toMatchObject({
    reason: "The request is closed or was not sent to this maker",
  });
  expect(stood).toHaveLength(3);
});

test("a silent maker holds only a standing request's first round, for the window", async () => {
  let hub!: RfqHub;
  hub = newHub(80);
  const [fast, slow] = [0, 1].map((n) => session(() => hub, maker(n)));
  fast!.answer = (r) => quote(String(r.id), "100");
  hub.attach(fast!);
  hub.attach(slow!);
  const started = performance.now();
  const { request, stood } = standing(hub, rfqId(21));
  await request.firstRound;
  expect(performance.now() - started).toBeGreaterThanOrEqual(75);
  // Unlike an auction, the slow maker's quote still stands after the window.
  hub.receive(slow!, JSON.stringify(quote(rfqId(21), "99")));
  expect(stood).toEqual(["maker 0@100", "maker 1@99"]);
  request.close();
});

test("a maker that connects later receives the standing requests it may quote, never its own", async () => {
  let hub!: RfqHub;
  hub = newHub(60_000);
  const started = performance.now();
  const mine = standing(hub, rfqId(22), maker(0));
  const other = standing(hub, rfqId(23));
  // With no maker online the first round waits for nobody.
  await Promise.all([mine.request.firstRound, other.request.firstRound]);
  expect(performance.now() - started).toBeLessThan(20);
  const late = session(() => hub, maker(0));
  late.answer = (r) => quote(String(r.id), "100");
  hub.attach(late);
  await tick();
  // Its own request is not sent to it; the other is, marked as sent again.
  expect(ofType(late, "rfq")).toEqual([{ type: "rfq", id: rfqId(23), replay: true }]);
  expect(other.stood).toEqual(["maker 0@100"]);
  expect(mine.stood).toEqual([]);
  // A quote on its own request is refused.
  hub.receive(late, JSON.stringify(quote(rfqId(22), "1")));
  expect(ofType(late, "quote.rejected")).toHaveLength(1);
  // A second connection of the maker is not asked again for what it already quotes.
  const second = session(() => hub, maker(0));
  hub.attach(second);
  await tick();
  expect(ofType(second, "rfq")).toHaveLength(0);
  mine.request.close();
  other.request.close();
});

test("a maker's standing quotes leave with its last connection", async () => {
  let hub!: RfqHub;
  hub = newHub(60_000);
  const [first, second] = [0, 0].map((n) => session(() => hub, maker(n)));
  first!.answer = (r) => quote(String(r.id), "100");
  hub.attach(first!);
  hub.attach(second!);
  const { request, left } = standing(hub, rfqId(24));
  await request.firstRound;
  expect(request.quotes()).toHaveLength(1);
  hub.detach(first!);
  expect(left).toEqual([]);
  expect(request.quotes()).toHaveLength(1);
  hub.detach(second!);
  expect(left).toEqual(["maker 0 offline"]);
  expect(request.quotes()).toHaveLength(0);
  request.close();
});

test("asking again goes to the makers without a standing quote, and to one whose quote was dropped", async () => {
  let hub!: RfqHub;
  hub = newHub(60_000);
  const [one, two] = [0, 1].map((n) => session(() => hub, maker(n)));
  let price = 100;
  one!.answer = (r) => quote(String(r.id), String(price--));
  two!.answer = (r) => (r.replay ? quote(String(r.id), "90") : { type: "decline", rfqId: r.id });
  hub.attach(one!);
  hub.attach(two!);
  const { request, stood } = standing(hub, rfqId(25));
  await request.firstRound;
  await request.ask();
  // Only the maker that held no quote was asked again.
  expect(ofType(one!, "rfq")).toHaveLength(1);
  expect(ofType(two!, "rfq").map((m) => m.replay)).toEqual([false, true]);
  expect(stood).toEqual(["maker 0@100", "maker 1@90"]);
  // A quote that ran out is forgotten, and its maker asked again.
  request.drop(maker(0).id);
  expect(request.quotes().map((q) => q.maker.label)).toEqual(["maker 1"]);
  await request.ask();
  expect(ofType(one!, "rfq")).toHaveLength(2);
  expect(stood.at(-1)).toBe("maker 0@99");
  // With every maker quoting, asking again sends nothing and settles at once.
  const started = performance.now();
  await request.ask();
  expect(performance.now() - started).toBeLessThan(20);
  expect(ofType(one!, "rfq")).toHaveLength(2);
  request.close();
});

test("a connecting maker receives a long list of standing requests in bursts", async () => {
  let hub!: RfqHub;
  hub = newHub(60_000);
  const open = Array.from({ length: 60 }, (_, i) => standing(hub, rfqId(100 + i)));
  const late = session(() => hub, maker(0));
  hub.attach(late);
  expect(ofType(late, "rfq")).toHaveLength(25);
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(ofType(late, "rfq").map((m) => m.id)).toEqual(
    Array.from({ length: 60 }, (_, i) => rfqId(100 + i)),
  );
  // A request closed meanwhile is not sent, and a maker gone stops the rest.
  for (const o of open) o.request.close();
  const next = session(() => hub, maker(1));
  hub.attach(next);
  expect(ofType(next, "rfq")).toHaveLength(0);
});

test("a standing request takes many quotes from one maker, up to its own limit", async () => {
  let hub!: RfqHub;
  hub = newHub(60_000);
  const one = session(() => hub, maker(0));
  hub.attach(one);
  const { request, stood } = standing(hub, rfqId(26));
  for (let i = 0; i < 257; i++) hub.receive(one, JSON.stringify(quote(rfqId(26), String(900 - i))));
  expect(stood).toHaveLength(256);
  expect(ofType(one, "quote.rejected").at(-1)).toMatchObject({
    reason: "At most 256 quotes per request",
  });
  request.close();
});
