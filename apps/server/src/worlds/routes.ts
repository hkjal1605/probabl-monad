/** The `/v2` trading API of world books (docs/version-2-plan.md §10.2): firm quotes for the
 * wallet to fill, fills through the trading delegate, cash-outs, and every other transaction a
 * wallet signs itself, each built locally and simulated before it is returned. Reads of the
 * replica (books, positions, vaults, fixings, the stream) are mounted by `WorldIndexer`. */
import type { Database } from "@conditional-stocks/db";
import {
  address,
  approve,
  type Envelope,
  U128_MAX,
  unsigned,
  WORLD_BUY,
  WORLD_SELL,
  worldBooksCalls,
  worldErrorMessage,
  worldGrantProblem,
  worldVaultCalls,
} from "@conditional-stocks/evm-client";
import {
  atomsOf,
  hasVaultRole,
  winningAtom,
  worldCreditOf,
  worldGrantKey,
} from "@conditional-stocks/evm-client/world-ledger";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { type Address, getAddress, type PublicClient } from "viem";
import type { Auth } from "../auth/routes.ts";
import type { RfqHub } from "../rfq/hub.ts";
import { INDICATION_TTL_MS } from "../rfq/hub.ts";
import type { TradingSigner } from "../trading/delegated.ts";
import type { WorldDesk } from "./desk.ts";
import { auctionSummary, parseWorldOrder, type WorldTrading } from "./trading.ts";

const seconds = () => BigInt(Math.floor(Date.now() / 1000));
const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export function mountWorlds(
  app: Hono,
  options: {
    indexer: WorldIndexer;
    client: PublicClient;
    auth: Auth;
    db: Database;
    hub: RfqHub | null;
    desk: WorldDesk | null;
    trading: WorldTrading | null;
    signer: TradingSigner | null;
  },
) {
  const { indexer, client, auth, db, hub, desk, trading, signer } = options;
  const books = () => worldBooksCalls(indexer.deployment.books);
  /** Simulates the calls in order as `from` (each must succeed now), then returns them. */
  const prepared = async (from: Address, transactions: Envelope[], fallback: string) => {
    for (const t of transactions)
      try {
        await client.call({ account: from, to: t.to, data: t.data });
      } catch (error) {
        throw new HTTPException(409, { message: worldErrorMessage(error, fallback) });
      }
    return { transactions };
  };
  const amount = (value: unknown) => {
    try {
      const v = unsigned(value, U128_MAX);
      if (v === 0n) throw new Error();
      return v;
    } catch {
      throw new HTTPException(400, { message: "Give a positive amount in raw units" });
    }
  };

  app.get("/v2/worlds/status", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      available: Boolean(desk),
      makers: hub?.makers(undefined, "world") ?? 0,
      quoteWindowMs: hub?.options.windowMs ?? null,
      delegate: signer?.address ?? null,
    });
  });

  /** The wallet's grant to the API's trading delegate. */
  app.get("/v2/worlds/permission", async (c) => {
    const { owner } = await auth.member(c, c.req.query("owner") ?? null);
    const s = indexer.trading();
    const g = signer ? s.grants.get(worldGrantKey(owner, signer.address)) : undefined;
    const now = seconds();
    const active = Boolean(
      g && !g.revoked && g.epoch === (s.delegationEpochs.get(owner) ?? 0n) && now < g.expiresAt,
    );
    return c.text(
      json({
        available: Boolean(trading),
        delegate: signer?.address ?? null,
        owner,
        active,
        credit: worldCreditOf(s, owner),
        grant: g ?? null,
        block: s.block.toString(),
      }),
      200,
      { "content-type": "application/json" },
    );
  });

  /** A firm quote the wallet fills itself: the RFQ's winning quote, and its `fillQuote` call. */
  app.post("/v2/worlds/quote", async (c) => {
    const { owner } = await auth.trader(c);
    if (!desk) throw new HTTPException(503, { message: "World quotes are unavailable" });
    const order = parseWorldOrder((await c.req.json()).order, owner);
    const auction = await desk.run(order);
    if (!auction) throw new HTTPException(503, { message: "No world maker is online" });
    if (!auction.award) {
      desk.settle(auction, null);
      throw new HTTPException(409, {
        message: auction.quotes.length
          ? "No quote still fills this order. Try again."
          : "No maker quoted this order. Try a smaller size.",
      });
    }
    desk.watch(auction);
    const { quote, signature } = auction.award;
    return c.text(
      json({
        rfq: auctionSummary(auction),
        quote,
        signature,
        cost: desk.cost(auction),
        transaction: books().fillQuote(quote, signature),
      }),
      200,
      { "content-type": "application/json" },
    );
  });

  /** A buy (or a cash-out, `side: "sell"`) filled by the trading delegate within the wallet's
   * grant. */
  for (const path of ["/v2/worlds/submit", "/v2/worlds/cashout"])
    app.post(path, async (c) => {
      const { owner } = await auth.trader(c);
      if (!trading) throw new HTTPException(503, { message: "Delegated world trading is off" });
      const body = (await c.req.json()) as { order?: unknown; clientId?: unknown };
      const order = parseWorldOrder(body.order, owner);
      if (path.endsWith("cashout") !== (order.side === "sell"))
        throw new HTTPException(400, { message: "A cash-out sells; a submission buys" });
      return c.text(
        json(await trading.submit(address(owner), order, String(body.clientId ?? ""))),
        200,
        {
          "content-type": "application/json",
        },
      );
    });

  // ---------------------------------------------------------------- wallet transactions

  /** Credit for world trading: an allowance and a deposit to the books. */
  app.post("/v2/worlds/deposit/prepare", async (c) => {
    const { owner } = await auth.trader(c);
    const value = amount((await c.req.json()).amount);
    const d = indexer.deployment;
    const allowance = await client.readContract({
      address: d.quote,
      abi: [
        {
          type: "function",
          name: "allowance",
          stateMutability: "view",
          inputs: [{ type: "address" }, { type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ],
      functionName: "allowance",
      args: [owner, d.books],
    });
    const transactions =
      allowance >= value
        ? [books().deposit(value)]
        : [approve(d.quote, d.books, value), books().deposit(value)];
    // A deposit after a new allowance cannot be simulated before it: only the first call is.
    await prepared(owner, transactions.slice(0, 1), "The deposit cannot execute now");
    return c.json({ transactions });
  });
  /** Credit back to the wallet (never paused). */
  app.post("/v2/worlds/withdraw/prepare", async (c) => {
    const { owner } = await auth.session(c);
    const body = await c.req.json();
    const to = body.to ? address(body.to) : owner;
    return c.json(
      await prepared(
        owner,
        [books().withdraw(amount(body.amount), to)],
        "The withdrawal cannot execute",
      ),
    );
  });
  /** Redeems every decided book the wallet holds atoms of (or those given). */
  app.post("/v2/worlds/redeem/prepare", async (c) => {
    const { owner } = await auth.session(c);
    const body = (await c.req.json().catch(() => ({}))) as { books?: unknown };
    const s = indexer.trading(),
      now = seconds();
    const wanted = Array.isArray(body.books) ? new Set(body.books.map(Number)) : null;
    const ids = [...s.books.values()]
      .filter(
        (b) =>
          (!wanted || wanted.has(b.id)) &&
          winningAtom(s, b, now) !== null &&
          atomsOf(s, b.id, owner).some((v) => v > 0n),
      )
      .map((b) => BigInt(b.id));
    if (!ids.length) throw new HTTPException(409, { message: "Nothing to redeem" });
    return c.json(
      await prepared(owner, [books().redeemMany(ids)], "The redemption cannot execute"),
    );
  });
  /** One-click trading: a grant to the API's trading delegate. */
  app.post("/v2/worlds/delegate/prepare", async (c) => {
    const { owner } = await auth.trader(c);
    if (!signer) throw new HTTPException(503, { message: "Delegated world trading is off" });
    const b = (await c.req.json()) as Record<string, unknown>;
    const limits = {
      expiresAt: unsigned(b.expiresAt, (1n << 40n) - 1n),
      maxBuy: unsigned(b.maxBuy ?? "0", U128_MAX),
      totalBuy: unsigned(b.totalBuy ?? "0", U128_MAX),
      maxSell: unsigned(b.maxSell ?? "0", U128_MAX),
      totalSell: unsigned(b.totalSell ?? "0", U128_MAX),
      maxFeeBps: Number(b.maxFeeBps),
      permissions: Number(b.permissions ?? WORLD_BUY | WORLD_SELL),
    };
    const problem = worldGrantProblem(limits, seconds());
    if (problem) throw new HTTPException(400, { message: problem });
    return c.json(
      await prepared(
        owner,
        [books().approveDelegate(signer.address, limits)],
        "The grant cannot execute",
      ),
    );
  });
  app.post("/v2/worlds/delegate/revoke/prepare", async (c) => {
    const { owner } = await auth.session(c);
    if (!signer) throw new HTTPException(503, { message: "Delegated world trading is off" });
    return c.json(
      await prepared(owner, [books().revokeDelegate(signer.address)], "Nothing to revoke"),
    );
  });

  /** Vault deposits and redemptions go through batches: requests, cancellations, claims. */
  const vaultOf = (raw: string) => {
    const v = getAddress(raw);
    if (!indexer.trading().vaults.has(v))
      throw new HTTPException(404, { message: "Unknown vault" });
    return v;
  };
  app.post("/v2/vaults/:vault/deposit/prepare", async (c) => {
    const { owner } = await auth.trader(c);
    const vault = vaultOf(c.req.param("vault"));
    const value = amount((await c.req.json()).assets);
    // The vault's own checks, from the replica: who may deposit, the pause and the cap.
    const v = indexer.trading().vaults.get(vault)!;
    if (v.paused) throw new HTTPException(409, { message: "Deposits are paused" });
    if (!v.openDeposits && !hasVaultRole(v, "depositor", owner))
      throw new HTTPException(403, { message: "Deposits are open to approved depositors only" });
    if (v.refNav + v.pendingAssets + value > v.depositCap)
      throw new HTTPException(409, { message: "The deposit exceeds the vault's cap" });
    const transactions = [
      approve(indexer.deployment.quote, vault, value),
      worldVaultCalls(vault).requestDeposit(value),
    ];
    await prepared(owner, transactions.slice(0, 1), "The deposit cannot execute now");
    return c.json({ transactions });
  });
  for (const [action, call] of [
    ["redeem", (v: Address, x: bigint) => worldVaultCalls(v).requestRedeem(x)],
    ["cancel-deposit", (v: Address, x: bigint) => worldVaultCalls(v).cancelDeposit(x)],
    ["cancel-redeem", (v: Address, x: bigint) => worldVaultCalls(v).cancelRedeem(x)],
  ] as const)
    app.post(`/v2/vaults/:vault/${action}/prepare`, async (c) => {
      // Exits and cancellations need a session only: a wallet's own funds are never held back.
      const { owner } = await auth.session(c);
      const vault = vaultOf(c.req.param("vault"));
      const body = await c.req.json();
      return c.json(
        await prepared(
          owner,
          [call(vault, amount(body.shares ?? body.assets))],
          "The request cannot execute",
        ),
      );
    });
  app.post("/v2/vaults/:vault/claim/prepare", async (c) => {
    const { owner } = await auth.session(c);
    const vault = vaultOf(c.req.param("vault"));
    const v = indexer.trading().vaults.get(vault)!;
    const batches = [...v.requests.entries()]
      .filter(([key, r]) => key.endsWith(`:${owner}`) && (r.assets || r.shares))
      .map(([key]) => Number(key.split(":")[0]))
      .filter((id) => v.batches.get(id)?.status === 3);
    if (!batches.length) throw new HTTPException(409, { message: "Nothing to claim" });
    return c.json(
      await prepared(
        owner,
        batches.map((id) => worldVaultCalls(vault).claim(BigInt(id), owner)),
        "The claim cannot execute",
      ),
    );
  });

  // ---------------------------------------------------------------- prices

  const prices = () =>
    json({
      ttlMs: INDICATION_TTL_MS,
      books: [...(hub?.worldPrices() ?? new Map()).entries()].map(([book, p]) => ({
        book,
        marks: p.marks,
        at: p.at,
        products: [...p.products].map(([key, q]) => ({ key, bid: q.bid, ask: q.ask, at: q.at })),
      })),
    });
  app.get("/v2/worlds/prices", (c) => {
    c.header("Cache-Control", "no-store");
    return c.body(prices(), 200, { "content-type": "application/json" });
  });
  let streams = 0;
  app.get("/v2/worlds/prices/stream", (c) => {
    if (streams >= 2000) return c.json({ error: "Stream capacity reached" }, 503);
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      streams++;
      try {
        let sent = "",
          sentAt = 0;
        while (!stream.aborted) {
          const data = prices();
          if (data !== sent || Date.now() - sentAt >= 15_000) {
            await stream.writeSSE({ event: "prices", data });
            sent = data;
            sentAt = Date.now();
          }
          await stream.sleep(2_000);
        }
      } finally {
        streams--;
      }
    });
  });
  /** One product's price history (`world_prices`), the last in each bucket. */
  app.get("/v2/books/:book/prices", async (c) => {
    const book = Number(c.req.param("book"));
    const product = c.req.query("product") ?? "bet:world";
    const since = Number(c.req.query("since") ?? Math.floor(Date.now() / 60_000) - 7 * 1440);
    const bucket = Number(c.req.query("bucket") ?? 60);
    if (
      !Number.isSafeInteger(book) ||
      !Number.isSafeInteger(since) ||
      !Number.isSafeInteger(bucket)
    )
      throw new HTTPException(400, { message: "Invalid book, since or bucket" });
    return c.json({
      book,
      product,
      prices: await db.worldPriceHistory(indexer.domain, book, product, since, bucket),
    });
  });
}
