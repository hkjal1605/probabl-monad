/** The world books' evidence flow (docs/version-2-plan.md §10.4, §12), the exchange's flow for
 * world packets: prepare → review → transaction preview → execute (by the role key) →
 * reconcile. Packets are stored under the world deployment's domain.
 *
 * - A curated book: `POST /v2/admin/books/prepare` fetches each leg's venue event fresh, builds
 *   the `book-creation` packet and registers the book's metadata; the book admin creates it.
 * - An event's result: `POST /v2/admin/events/:key/resolution/prepare` builds the
 *   `event-resolution` packet from a fresh venue snapshot; the market admin commits it and the
 *   resolution admin resolves it in `EventOracle`.
 * - A fallback fixing: `POST /v2/admin/books/:book/fixing/prepare` builds the `book-fixing`
 *   packet; the book admin commits and the resolution admin resolves it in `WorldBooks`.
 * - Pricing inputs: the book and market admins state relations between events and set
 *   correlations, gaps and volatilities (`method: "admin"`, which the keeper's fits never
 *   replace); the keeper reloads them within ten minutes. */
import type { Database, LegRelationKind, WorldBookMetadata } from "@conditional-stocks/db";
import {
  BOOK_STATUS,
  bookDefHash,
  bookDefProblem,
  EVENT_STATE,
  eventKey,
  eventResolutionHash,
  fixHash,
  underlyingId,
} from "@conditional-stocks/evm-client";
import { preflightAdmin } from "@conditional-stocks/evm-client/admin";
import {
  bookDefOf,
  type WorldAdminAction,
  type WorldAdminDeployment,
  worldEvidenceTransaction,
  worldMetadataUri,
} from "@conditional-stocks/evm-client/world-admin";
import { eventOf, fixingWindow } from "@conditional-stocks/evm-client/world-ledger";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import {
  assertWorldEvidenceIntegrity,
  buildBookCreationEvidence,
  buildBookFixingEvidence,
  buildEventResolutionEvidence,
  isHex32,
  legEvidence,
  noOutcome,
  requiredString,
  type WorldEvidenceEnvelope,
  yesOutcome,
} from "@conditional-stocks/market-data";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Address, getAddress, type Hex, type PublicClient, parseAbi, zeroAddress } from "viem";
import type { EventMarketsClient } from "../integrations/event-markets.ts";

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
type Review = { decision: "approve" | "reject" };
type View = {
  envelope: WorldEvidenceEnvelope;
  status: "prepared" | "approved" | "rejected";
  reviews: Review[];
  previews: (Record<string, unknown> & { action: WorldAdminAction })[];
  observations: unknown[];
};
const invalid = (message: string, status: 400 | 403 | 404 | 409 | 503 = 400) =>
  new HTTPException(status, { message });
const feedAbi = parseAbi(["function decimals() view returns (uint8)"]);
/** A venue condition id, lowercase. */
const condition = (value: unknown, name: string) => {
  if (!isHex32(value)) throw invalid(`${name} must be a bytes32 condition id`);
  return value.toLowerCase() as Hex;
};
const underlying = (value: unknown) => {
  try {
    underlyingId(value as string);
  } catch {
    throw invalid("underlying is like US:NVDA");
  }
  return value as string;
};
const bounded = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== "number" || !(value >= min && value <= max))
    throw invalid(`${name} is a number from ${min} to ${max}`);
  return value;
};
/** A leg may resolve at most this long after its book's decision time. */
const MAX_LEG_LAG_S = 30 * 86_400;

export function mountWorldAdmin(
  app: Hono,
  options: {
    db: Database;
    indexer: WorldIndexer;
    client: PublicClient;
    authenticate: (header: string | undefined) => Promise<string>;
    events: () => EventMarketsClient;
    /** Where book packets are served (`WORLD_METADATA_BASE_URL`, the API's public origin). */
    metadataBase: string;
  },
) {
  const { db, indexer, client, authenticate, events, metadataBase } = options;
  const domain = indexer.domain;
  const deployment = (): WorldAdminDeployment => {
    const s = indexer.trading();
    const { bookAdmin, resolutionAdmin } = s.config,
      { marketAdmin, resolutionAdmin: oracleResolver } = s.oracle;
    if (!bookAdmin || !resolutionAdmin || !marketAdmin || !oracleResolver)
      throw invalid("World governance roles are not indexed yet", 503);
    return {
      chainId: s.deployment.chainId,
      books: s.deployment.books,
      oracle: s.deployment.oracle,
      bookAdmin,
      booksResolutionAdmin: resolutionAdmin,
      marketAdmin,
      oracleResolutionAdmin: oracleResolver,
      metadataBase,
    };
  };
  /** The book admin and the market admin prepare and review; the resolution admins execute. */
  const operator = async (header: string | undefined, reviewOnly = false) => {
    const owner = getAddress(await authenticate(header));
    const d = deployment();
    const preparers = [d.bookAdmin, d.marketAdmin];
    const executors = [...preparers, d.booksResolutionAdmin, d.oracleResolutionAdmin];
    if (!(reviewOnly ? preparers : executors).includes(owner))
      throw invalid("Required world governance role is not assigned to this wallet", 403);
    return owner;
  };
  const views = (
    envelope: WorldEvidenceEnvelope,
    actions: { kind: string; payload: unknown }[],
  ): View => {
    assertWorldEvidenceIntegrity(envelope);
    const select = <T>(kind: string) =>
      actions.filter((a) => a.kind === kind).map((a) => a.payload as T);
    const reviews = select<Review>("REVIEW");
    const last = reviews.at(-1)?.decision;
    return {
      envelope,
      status: last === "approve" ? "approved" : last === "reject" ? "rejected" : "prepared",
      reviews,
      previews: select("PREVIEW"),
      observations: select("RECONCILE"),
    };
  };
  const read = async (hash: string, q: Pick<Database, "evidence" | "evidenceActions"> = db) => {
    if (!isHex32(hash)) throw invalid("Invalid packet hash");
    const envelope = (await q.evidence(domain, hash)) as WorldEvidenceEnvelope | undefined;
    if (!envelope) throw invalid("Evidence packet not found", 404);
    return views(envelope, await q.evidenceActions(domain, hash));
  };
  const store = async (envelope: WorldEvidenceEnvelope, owner: Address, scope: string | null) => {
    assertWorldEvidenceIntegrity(envelope);
    await db.locked(`evidence:${domain}`, async (tx) => {
      if (!(await tx.evidence(domain, envelope.packetHash))) {
        await tx.putEvidence(domain, envelope.packetHash, scope, envelope, []);
        await tx.audit(domain, envelope.packetHash, "PREPARE", owner, {
          kind: envelope.packet.kind,
        });
      }
    });
    return read(envelope.packetHash);
  };
  const worldDeployment = () => {
    const d = deployment();
    return { chainId: String(d.chainId), books: d.books, oracle: d.oracle };
  };

  // ---------------------------------------------------------------- prepare

  app.post("/v2/admin/books/prepare", async (c) => {
    const owner = await operator(c.req.header("authorization"), true);
    const body = (await c.req.json()) as Record<string, unknown>;
    const s = indexer.trading();
    if (!Array.isArray(body.legs) || !body.legs.length || body.legs.length > 6)
      throw invalid("Give 1 to 6 legs");
    // Every leg from a fresh venue snapshot, with its oracle key, still unknown on chain.
    const legs = await Promise.all(
      body.legs.map(async (raw, i) => {
        const l = (raw ?? {}) as Record<string, unknown>;
        if (l.source !== "polymarket" && l.source !== "kalshi") throw invalid(`legs[${i}].source`);
        const snapshot = await events().fetchMetadata(
          l.source,
          requiredString(l.marketId, "marketId", 256),
        );
        const m = snapshot.normalized;
        const key = eventKey(
          m.conditionId,
          Number(yesOutcome(m).indexSet),
          Number(noOutcome(m).indexSet),
        );
        if (eventOf(s, key).state !== EVENT_STATE.unknown)
          throw invalid(`Leg ${i + 1}'s event is already frozen or resolved`, 409);
        return legEvidence({
          metadata: m,
          metadataSnapshotId: snapshot.snapshotId,
          metadataRawHash: snapshot.rawHash,
          eventKey: key,
          wantYes: l.wantYes !== false,
          themes: Array.isArray(l.themes) ? (l.themes as string[]) : [],
        });
      }),
    );
    const feed = typeof body.feed === "string" ? getAddress(body.feed) : zeroAddress;
    // The strikes are raw feed answers: their decimals come from the feed itself.
    const feedDecimals =
      feed === zeroAddress
        ? null
        : Number(
            await client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
          );
    const envelope = buildBookCreationEvidence({
      deployment: worldDeployment(),
      title: body.title,
      legs,
      book: { ...(body.book as object), feed, feedDecimals },
      attachments: [],
      preparedAt: new Date().toISOString(),
      preparer: owner,
    });
    const p = envelope.packet;
    const uri = worldMetadataUri(metadataBase, envelope.packetHash);
    const def = bookDefOf(p, uri);
    const now = Math.floor(Date.now() / 1000);
    const problem = bookDefProblem(def, now, uri);
    if (problem) throw invalid(problem);
    const decision = feed === zeroAddress ? def.cutoff : def.fixingTime;
    for (const leg of p.legs)
      if (Date.parse(leg.endTime) / 1000 > decision + MAX_LEG_LAG_S)
        throw invalid(`"${leg.question}" resolves long after the book decides`);
    const defHash = bookDefHash(def);
    const metadata: WorldBookMetadata = {
      legs: p.legs.map((l) => ({
        eventKey: l.eventKey,
        wantYes: l.wantYes,
        source: l.source,
        marketId: l.marketId,
        conditionId: l.conditionId,
        yesIndex: Number(l.yesIndex),
        noIndex: Number(l.noIndex),
        question: l.question,
        url: l.canonicalUrl,
        endTime: l.endTime,
        themes: l.themes,
        metadataSnapshotId: l.metadataSnapshotId,
      })),
      underlying: p.book.underlying,
      feedDecimals,
      fixing: p.book.fixingRule,
      metadataUri: uri,
      def: JSON.parse(JSON.stringify(def, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
    };
    const view = await store(envelope, owner, defHash);
    await db.registerWorldBook(domain, {
      defHash,
      title: p.title,
      kind: "curated",
      metadata,
      packetHash: envelope.packetHash,
    });
    await indexer.refreshMetadata();
    return c.json({ ...view, defHash, metadataUri: uri, existing: s.bookOf.get(defHash) ?? null });
  });

  app.post("/v2/admin/events/:key/resolution/prepare", async (c) => {
    const owner = await operator(c.req.header("authorization"), true);
    const key = c.req.param("key").toLowerCase() as Hex;
    if (!isHex32(key)) throw invalid("Invalid event key");
    const s = indexer.trading();
    const e = eventOf(s, key);
    if (e.state !== EVENT_STATE.frozen && e.state !== EVENT_STATE.committed)
      throw invalid("Resolution requires a frozen or committed event", 409);
    const body = (await c.req.json()) as Record<string, unknown>;
    const snapshot = await events().snapshot(
      requiredString(body.metadataSnapshotId, "metadataSnapshotId", 256),
    );
    const m = snapshot.normalized;
    if (
      eventKey(m.conditionId, Number(yesOutcome(m).indexSet), Number(noOutcome(m).indexSet)) !== key
    )
      throw invalid("The snapshot is of another event or orientation", 409);
    const envelope = buildEventResolutionEvidence({
      deployment: worldDeployment(),
      event: {
        eventKey: key,
        source: m.source,
        marketId: m.source === "kalshi" ? m.ticker : m.gammaMarketId,
        conditionId: m.conditionId,
        yesIndex: yesOutcome(m).indexSet,
        noIndex: noOutcome(m).indexSet,
      },
      metadataRawHash: snapshot.rawHash,
      metadataSnapshotId: snapshot.snapshotId,
      officialStatus: body.officialStatus,
      officialUrl: body.officialUrl,
      payout: body.payout,
      polygon: body.polygon,
      sourceObservations: body.sourceObservations,
      sourceReference: body.sourceReference,
      attachments: [],
      preparedAt: new Date().toISOString(),
      preparer: owner,
    });
    // No two live packets may declare different outcomes for one event.
    for (const row of await db.evidenceForMarket(domain, key)) {
      const prior = await read(row.hash);
      if (
        prior.status !== "rejected" &&
        prior.envelope.packet.kind === "event-resolution" &&
        prior.envelope.packet.outcome !== envelope.packet.outcome
      )
        throw invalid("An active evidence packet declares a conflicting outcome", 409);
    }
    return c.json(await store(envelope, owner, key));
  });

  app.post("/v2/admin/books/:book/fixing/prepare", async (c) => {
    const owner = await operator(c.req.header("authorization"), true);
    const id = Number(c.req.param("book"));
    const s = indexer.trading();
    const b = s.books.get(id);
    if (!b || b.def.feed === zeroAddress || b.status !== BOOK_STATUS.undecided)
      throw invalid("The book has no undecided fixing", 409);
    const window = fixingWindow(s, b, BigInt(Math.floor(Date.now() / 1000)));
    if (!window) throw invalid("The book does not await its fixing", 409);
    if (!b.held && (b.fix || BigInt(Math.floor(Date.now() / 1000)) < window.fallbackAt))
      throw invalid(
        "The fallback opens when the fixing is held, or a day passes without a proposal",
        409,
      );
    const body = (await c.req.json()) as Record<string, unknown>;
    const envelope = buildBookFixingEvidence({
      deployment: worldDeployment(),
      book: {
        id: String(id),
        feed: b.def.feed,
        fixingTime: String(b.def.fixingTime),
        maxStaleness: String(b.def.maxStaleness),
      },
      price: body.price,
      reason: body.reason,
      rounds: body.rounds ?? [],
      sourceObservations: body.sourceObservations,
      sourceReference: body.sourceReference,
      attachments: [],
      preparedAt: new Date().toISOString(),
      preparer: owner,
    });
    return c.json(await store(envelope, owner, `book:${id}`));
  });

  /** The ingestor's latest snapshot of an event a book uses (its venue result, for the
   * resolution job). */
  app.get("/v2/admin/events/:key/snapshot", async (c) => {
    await operator(c.req.header("authorization"));
    const key = c.req.param("key").toLowerCase();
    const s = indexer.trading();
    for (const b of s.books.values()) {
      const leg = indexer
        .meta(b.defHash)
        ?.metadata.legs.find((l) => l.eventKey.toLowerCase() === key);
      if (leg) return c.json(await events().metadata(leg.conditionId as Hex));
    }
    throw invalid("No book uses this event", 404);
  });

  // ---------------------------------------------------------------- pricing inputs

  /** The world keeper's pricing inputs for some conditions (`?conditions=0x…,0x…`), or every
   * one: fitted and admin correlations, stated relations, gaps, volatilities. */
  app.get("/v2/admin/pricing", async (c) => {
    await operator(c.req.header("authorization"), true);
    const raw = c.req.query("conditions");
    const conditions = raw
      ? raw.split(",").map((value, i) => condition(value.trim(), `conditions[${i}]`))
      : undefined;
    if (conditions && conditions.length > 200) throw invalid("Ask for up to 200 conditions");
    const [correlations, relations, gaps, vols, probit] = await Promise.all([
      db.worldCorrelations(conditions),
      db.legRelations(conditions),
      db.worldGaps(),
      db.worldVols(),
      db.eventVolatilities(conditions),
    ]);
    const wanted = conditions ? new Set(conditions) : null;
    return c.json({
      correlations,
      relations,
      gaps: wanted ? gaps.filter((g) => wanted.has(g.condition.toLowerCase() as Hex)) : gaps,
      vols,
      probitVols: probit,
    });
  });
  /** A stated relation between two events' YES outcomes, which the keeper prices exactly
   * (`implies`, `exclusive`, `duplicate`) or as a correlation from its conditional chances. */
  app.post("/v2/admin/pricing/relations", async (c) => {
    const owner = await operator(c.req.header("authorization"), true);
    const body = (await c.req.json()) as Record<string, unknown>;
    const a = condition(body.a, "a"),
      b = condition(body.b, "b");
    if (a === b) throw invalid("A relation joins two different events");
    const kind = body.kind;
    if (
      typeof kind !== "string" ||
      !["independent", "positive", "negative", "exclusive", "implies", "duplicate"].includes(kind)
    )
      throw invalid("kind is independent, positive, negative, exclusive, implies or duplicate");
    const chance = (value: unknown, name: string) => {
      if (value === undefined || value === null) return null;
      if (typeof value !== "number" || !(value >= 0 && value <= 1))
        throw invalid(`${name} is a probability`);
      return value;
    };
    // The exact relations fix P(B|A); the others need both conditional chances, in order.
    let pBGivenA = chance(body.pBGivenA, "pBGivenA");
    const pBGivenNotA = chance(body.pBGivenNotA, "pBGivenNotA");
    if (kind === "implies" || kind === "duplicate") pBGivenA = 1;
    if (kind === "exclusive") pBGivenA = 0;
    if (
      (kind === "positive" || kind === "negative") &&
      (pBGivenA === null ||
        pBGivenNotA === null ||
        (kind === "positive" ? pBGivenA <= pBGivenNotA : pBGivenA >= pBGivenNotA))
    )
      throw invalid("A positive relation needs P(B|A) above P(B|not A), a negative one below it");
    const reasoning =
      body.reasoning === undefined ? null : requiredString(body.reasoning, "reasoning", 2_000);
    await db.putLegRelation({
      a,
      b,
      kind: kind as LegRelationKind,
      pBGivenA,
      pBGivenNotA,
      confidence: 1,
      source: "admin",
      model: null,
      reasoning,
      reviewer: owner,
    });
    return c.json({ relations: await db.legRelations([a, b]) });
  });
  /** An admin's estimate of a pair's latent correlation, which fits never replace. */
  app.post("/v2/admin/pricing/correlations", async (c) => {
    await operator(c.req.header("authorization"), true);
    const body = (await c.req.json()) as Record<string, unknown>;
    const a = condition(body.a, "a"),
      b = condition(body.b, "b");
    if (a === b) throw invalid("A correlation joins two different events");
    const rho = bounded(body.rho, "rho", -0.95, 0.95);
    const error = bounded(body.error ?? 0.1, "error", 0.01, 1);
    await db.putWorldCorrelations([{ a, b, rho, error, samples: 0, method: "admin" }], {
      overrideAdmin: true,
    });
    return c.json({ correlations: await db.worldCorrelations([a, b]) });
  });
  /** An admin's event gap: the stock's log move when the event happens, against when not. */
  app.post("/v2/admin/pricing/gaps", async (c) => {
    await operator(c.req.header("authorization"), true);
    const body = (await c.req.json()) as Record<string, unknown>;
    const row = {
      condition: condition(body.condition, "condition"),
      underlying: underlying(body.underlying),
      gap: bounded(body.gap, "gap", -0.5, 0.5),
      error: bounded(body.error ?? 0.03, "error", 0, 0.5),
      samples: 0,
      method: "admin",
    };
    await db.putWorldGaps([row], { overrideAdmin: true });
    return c.json({ gaps: await db.worldGaps(row.underlying) });
  });
  /** An admin's annualized volatility of an underlying (the keeper still applies its floor). */
  app.post("/v2/admin/pricing/vols", async (c) => {
    await operator(c.req.header("authorization"), true);
    const body = (await c.req.json()) as Record<string, unknown>;
    const row = {
      underlying: underlying(body.underlying),
      vol: bounded(body.vol, "vol", 0.01, 5),
      error: bounded(body.error ?? 0.05, "error", 0, 5),
      samples: 0,
      method: "admin",
    };
    await db.putWorldVols([row], { overrideAdmin: true });
    return c.json({ vols: await db.worldVols() });
  });

  // ---------------------------------------------------------------- review and execution

  app.get("/v2/admin/evidence", async (c) => {
    await operator(c.req.header("authorization"));
    const rows = await db.evidenceList(domain);
    const actions = await db.evidenceActionsFor(
      domain,
      rows.map((r) => r.hash),
    );
    return c.json({
      packets: rows.map((row) =>
        views(
          row.envelope as WorldEvidenceEnvelope,
          actions.filter((a) => a.packet_hash === row.hash),
        ),
      ),
    });
  });
  app.get("/v2/admin/evidence/:hash", async (c) => {
    await operator(c.req.header("authorization"));
    return c.json(await read(c.req.param("hash")));
  });
  app.post("/v2/admin/evidence/:hash/review", async (c) => {
    const owner = await operator(c.req.header("authorization"), true);
    const hash = c.req.param("hash");
    const body = await c.req.json();
    await db.locked(`evidence:${domain}`, async (tx) => {
      const view = await read(hash, tx);
      if (view.status !== "prepared") throw invalid("An immutable review already exists", 409);
      if (body.decision !== "approve" && body.decision !== "reject")
        throw invalid("Review decision is invalid");
      const checks = CHECKS[view.envelope.packet.kind];
      if (body.decision === "approve" && checks.some((k) => body.checklist?.[k] !== true))
        throw invalid("Every review checklist item must be confirmed", 409);
      await tx.audit(domain, hash, "REVIEW", owner, {
        decision: body.decision,
        reviewer: owner,
        reviewedAt: new Date().toISOString(),
        checklist: Object.fromEntries(checks.map((k) => [k, body.checklist?.[k] === true])),
        notes: typeof body.notes === "string" ? body.notes.slice(0, 4096) : "",
      });
    });
    return c.json(await read(hash));
  });
  /** The next transaction an approved packet authorizes, simulated, as its role key signs it. */
  app.post("/v2/admin/evidence/:hash/transaction", async (c) => {
    const owner = await operator(c.req.header("authorization"));
    const hash = c.req.param("hash");
    const view = await read(hash);
    if (view.status !== "approved") throw invalid("Explicit approval is required", 409);
    const p = view.envelope.packet;
    const s = indexer.trading();
    const d = deployment();
    let action: WorldAdminAction;
    if (p.kind === "book-creation") {
      action = "create-book";
      const def = bookDefOf(p, worldMetadataUri(metadataBase, view.envelope.packetHash as Hex));
      if (s.bookOf.has(bookDefHash(def))) throw invalid("The book exists already", 409);
    } else if (p.kind === "event-resolution") {
      const e = eventOf(s, p.event.eventKey);
      if (e.state !== EVENT_STATE.frozen && e.state !== EVENT_STATE.committed)
        throw invalid("The event is not frozen or committed", 409);
      const committed =
        e.commitment ===
        eventResolutionHash(
          d.chainId,
          d.oracle,
          p.event.eventKey,
          p.outcome,
          view.envelope.packetHash as Hex,
          p.sourceReference,
        );
      // An event awaiting another commitment is committed again to this packet.
      action = e.state === EVENT_STATE.committed && committed ? "resolve-event" : "commit-event";
    } else {
      const b = s.books.get(Number(p.book.id));
      if (!b || b.status !== BOOK_STATUS.undecided) throw invalid("The book is decided", 409);
      const committed =
        b.fixCommitment ===
        fixHash(
          d.chainId,
          d.books,
          BigInt(b.id),
          BigInt(p.price),
          view.envelope.packetHash as Hex,
          p.sourceReference,
        );
      action = committed ? "resolve-fix" : "commit-fix";
    }
    const transaction = worldEvidenceTransaction(view.envelope, action, d);
    await preflightAdmin(client, transaction);
    const preview = { ...transaction, packetHash: hash, previewId: crypto.randomUUID() };
    await db.audit(domain, hash, "PREVIEW", owner, preview);
    return c.json(preview);
  });
  app.post("/v2/admin/evidence/:hash/reconcile", async (c) => {
    const owner = await operator(c.req.header("authorization"));
    const hash = c.req.param("hash");
    const view = await read(hash);
    const body = await c.req.json();
    const txHash = requiredString(body.transactionHash, "transactionHash", 66) as Hex;
    if (!isHex32(txHash)) throw invalid("Invalid transaction hash");
    const preview = view.previews.findLast((p) => p.action === body.action);
    if (!preview || view.status !== "approved") throw invalid("Approved preview not found", 409);
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);
    if (
      receipt.status !== "success" ||
      getAddress(transaction.to ?? zeroAddress) !== getAddress(preview.to as string) ||
      getAddress(transaction.from) !== getAddress(preview.from as string) ||
      transaction.input.toLowerCase() !== String(preview.data).toLowerCase()
    )
      throw invalid("The executed transaction differs from the approved preview", 409);
    const observation = {
      action: preview.action,
      transactionHash: txHash,
      observedAt: new Date().toISOString(),
      block: receipt.blockNumber.toString(),
    };
    await db.audit(domain, hash, "RECONCILE", owner, observation);
    const p = view.envelope.packet;
    if (p.kind === "book-creation") {
      // Each leg's odds start streaming, for quotes and marks.
      await Promise.all(
        p.legs.map((l) =>
          Promise.resolve()
            .then(() => events().track(l.metadataSnapshotId))
            .catch(() => null),
        ),
      );
      await indexer.refreshMetadata();
    }
    return c.json(observation);
  });

  // ---------------------------------------------------------------- public

  /** A book's metadata URI: its creation packet, served once approved and never changed. */
  app.get("/v2/books/packets/:hash", async (c) => {
    const view = await read(c.req.param("hash"));
    if (view.status !== "approved" || view.envelope.packet.kind !== "book-creation")
      throw invalid("Published packet not found", 404);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.json(view.envelope);
  });
  /** The packet an event resolved by (its on-chain evidence hash). */
  app.get("/v2/events/:key/resolution-evidence", async (c) => {
    const key = c.req.param("key").toLowerCase() as Hex;
    if (!isHex32(key)) throw invalid("Invalid event key");
    const e = eventOf(indexer.trading(), key);
    if (!e.evidence) throw invalid("Final evidence is not available", 404);
    return c.json(await read(e.evidence));
  });
}
