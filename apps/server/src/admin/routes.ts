import type { Database } from "@conditional-stocks/db";
import { conditionalStocksAbi, resolutionHash, underlyingId } from "@conditional-stocks/evm-client";
import {
  type AdminPreview,
  type AdminTransaction,
  evidenceTransactions,
  type PacketEnvelope,
  preflightAdmin,
} from "@conditional-stocks/evm-client/admin";
import type { IndexerService } from "@conditional-stocks/indexer";
import {
  type AttachmentReference,
  assertAttachmentIntegrity,
  assertEvidenceIntegrity,
  attachmentContentHash,
  buildCreationEvidence,
  buildResolutionEvidence,
  canonicalStringify,
  isHex32,
  noOutcome,
  requiredString,
  yesOutcome,
} from "@conditional-stocks/market-data";
import { catalogUnderlying } from "@conditional-stocks/shared/token-catalog";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type Address,
  decodeEventLog,
  erc20Abi,
  getAddress,
  type Hex,
  type PublicClient,
} from "viem";
import type { PolymarketIngestorClient } from "../integrations/polymarket.ts";

/** Reviewer confirmations; keys are shared with the admin UI. */
const creationChecks = [
  "stock-and-quote",
  "condition-id",
  "yes-no-orientation",
  "rules-and-dates",
  "source-and-raw-hash",
];
const resolutionChecks = [
  "frozen-or-awaiting",
  "condition-id",
  "yes-no-orientation",
  "final-status",
  "polygon-reference",
  "attachments",
  "payout-vector",
];
type Review = { decision: "approve" | "reject" };
type Preview = AdminPreview & { prerequisites: AdminTransaction[] };
type View = {
  envelope: PacketEnvelope;
  status: "prepared" | "approved" | "rejected";
  reviews: Review[];
  previews: Preview[];
  observations: unknown[];
};
const invalid = (message: string, status: 400 | 403 | 404 | 409 | 503 = 400) =>
  new HTTPException(status, { message });

export function mountAdmin(
  app: Hono,
  options: {
    db: Database;
    indexer: IndexerService;
    client: PublicClient;
    chainId: number;
    domain: string;
    authenticate: (header: string | undefined) => Promise<string>;
    polymarket: () => PolymarketIngestorClient;
  },
) {
  const { db, indexer, client, chainId, domain, authenticate, polymarket } = options;
  const exchange = indexer.options.exchange;
  const roles = () => {
    const c = indexer.trading().config;
    if (!c.marketAdmin || !c.resolutionAdmin)
      throw invalid("Governance roles are not indexed yet", 503);
    return { marketAdmin: c.marketAdmin, resolutionAdmin: c.resolutionAdmin };
  };
  const operator = async (header: string | undefined, reviewOnly = false) => {
    const owner = getAddress(await authenticate(header));
    const r = roles();
    if (owner !== r.marketAdmin && (reviewOnly || owner !== r.resolutionAdmin))
      throw invalid("Required governance role is not assigned to this wallet", 403);
    return owner;
  };
  const views = (envelope: PacketEnvelope, actions: { kind: string; payload: unknown }[]): View => {
    assertEvidenceIntegrity(envelope);
    const select = <T>(kind: string) =>
      actions.filter((a) => a.kind === kind).map((a) => a.payload as T);
    const reviews = select<Review>("REVIEW");
    return {
      envelope,
      status:
        reviews.at(-1)?.decision === "approve"
          ? "approved"
          : reviews.at(-1)?.decision === "reject"
            ? "rejected"
            : "prepared",
      reviews,
      previews: select<Preview>("PREVIEW"),
      observations: select("RECONCILE"),
    };
  };
  const read = async (
    hash: string,
    query = db as Pick<Database, "evidence" | "evidenceActions">,
  ): Promise<View> => {
    if (!isHex32(hash)) throw invalid("Invalid packet hash");
    const envelope = (await query.evidence(domain, hash)) as PacketEnvelope | undefined;
    if (!envelope) throw invalid("Evidence packet not found", 404);
    return views(envelope, await query.evidenceActions(domain, hash));
  };
  const attachments = async (input: unknown, putAttachment: Database["putAttachment"]) => {
    if (!Array.isArray(input) || input.length > 32)
      throw invalid("At most 32 attachments are allowed");
    const base = process.env.EVIDENCE_PUBLIC_BASE_URL;
    if (input.length && (!base || new URL(base).protocol !== "https:"))
      throw invalid("A public HTTPS evidence attachment URL must be configured", 503);
    const references: AttachmentReference[] = [];
    let total = 0;
    for (const value of input) {
      const filename = requiredString(value.filename, "filename", 256),
        mediaType = requiredString(value.mediaType, "mediaType", 128),
        encoded = requiredString(value.contentBase64, "contentBase64", 14_000_000);
      const content = Buffer.from(encoded, "base64");
      total += content.length;
      if (
        !content.length ||
        content.length > 10 * 1024 * 1024 ||
        total > 25 * 1024 * 1024 ||
        content.toString("base64") !== encoded
      )
        throw invalid("Attachment size or base64 is invalid");
      const contentHash = attachmentContentHash(content);
      if (value.contentHash !== undefined && value.contentHash !== contentHash)
        throw invalid("Declared attachment hash differs", 409);
      await putAttachment(domain, contentHash, content);
      references.push({
        filename,
        mediaType,
        contentHash,
        byteLength: String(content.length),
        uri: `${base!.replace(/\/$/, "")}/${contentHash.slice(2)}`,
      });
    }
    return references;
  };
  const verifyAttachments = async (view: View) => {
    for (const reference of view.envelope.packet.attachments) {
      const content = await db.attachment(domain, reference.contentHash);
      if (!content) throw invalid("Evidence attachment is missing", 409);
      assertAttachmentIntegrity(reference, content);
    }
  };
  const market = (id: string) => {
    const m = indexer.market(id);
    if (!m) throw invalid("Unknown market", 404);
    return m;
  };

  app.post("/v1/admin/polymarket/metadata/fetch", async (c) => {
    await operator(c.req.header("authorization"));
    const body = await c.req.json();
    return c.json(
      await polymarket().fetchMetadata(requiredString(body.gammaMarketId, "gammaMarketId", 256)),
    );
  });

  for (const kind of ["creation", "resolution"] as const)
    app.post(`/v1/admin/evidence/${kind}/prepare`, async (c) => {
      const owner = await operator(c.req.header("authorization"), true);
      const body = await c.req.json();
      const source = await polymarket().snapshot(
        requiredString(body.metadataSnapshotId, "metadataSnapshotId", 256),
      );
      const m = kind === "resolution" ? market(String(body.marketId)) : null;
      if (m) {
        if (![3, 4].includes(m.state))
          throw invalid("Resolution requires a frozen or awaiting market", 409);
        if (
          source.normalized.conditionId.toLowerCase() !== m.condition.toLowerCase() ||
          yesOutcome(source.normalized).indexSet !== String(m.yesIndex) ||
          noOutcome(source.normalized).indexSet !== String(m.noIndex)
        )
          throw invalid("External snapshot does not match immutable market orientation", 409);
      }
      const deployment = { chainId: String(chainId), exchange };
      const hash = await db.locked(`evidence:${domain}`, async (tx) => {
        const references = await attachments(body.attachments ?? [], tx.putAttachment);
        const shared = {
          deployment,
          attachments: references,
          preparedAt: new Date().toISOString(),
          preparer: owner,
          metadataRawHash: source.rawHash,
          metadataSnapshotId: source.snapshotId,
        };
        const value: PacketEnvelope =
          kind === "creation"
            ? buildCreationEvidence({
                ...shared,
                config: body.config,
                metadata: source.normalized,
                sourceUrls: body.sourceUrls,
              })
            : buildResolutionEvidence({
                ...shared,
                conditionId: String(m!.id),
                marketId: String(m!.id),
                officialStatus: body.officialStatus,
                officialUrl: body.officialUrl,
                payout: body.payout,
                polygon: body.polygon,
                polymarketConditionId: m!.condition,
                polymarketYesIndex: String(m!.yesIndex),
                polymarketNoIndex: String(m!.noIndex),
                sourceObservations: body.sourceObservations,
                sourceReference: body.sourceReference,
              });
        assertEvidenceIntegrity(value);
        const marketId =
          value.packet.kind === "market-resolution" ? value.packet.localMarket.marketId : null;
        if (value.packet.kind === "market-resolution") {
          for (const row of await tx.evidenceForMarket(domain, marketId!)) {
            const prior = await read(row.hash, tx);
            if (
              prior.status !== "rejected" &&
              prior.envelope.packet.kind === "market-resolution" &&
              canonicalStringify(prior.envelope.packet.payout) !==
                canonicalStringify(value.packet.payout)
            )
              throw invalid("An active evidence packet declares a conflicting payout", 409);
          }
        }
        await tx.putEvidence(
          domain,
          value.packetHash,
          marketId,
          value,
          references.map((r) => r.contentHash),
        );
        await tx.audit(domain, value.packetHash, "PREPARE", owner, { kind: value.packet.kind });
        return value.packetHash;
      });
      return c.json(await read(hash));
    });

  app.get("/v1/admin/evidence", async (c) => {
    await operator(c.req.header("authorization"));
    const rows = await db.evidenceList(domain);
    const actions = await db.evidenceActionsFor(
      domain,
      rows.map((r) => r.hash),
    );
    return c.json({
      packets: rows.map((row) =>
        views(
          row.envelope as PacketEnvelope,
          actions.filter((a) => a.packet_hash === row.hash),
        ),
      ),
    });
  });
  app.get("/v1/admin/evidence/:hash", async (c) => {
    await operator(c.req.header("authorization"));
    return c.json(await read(c.req.param("hash")));
  });
  app.post("/v1/admin/evidence/:hash/review", async (c) => {
    const owner = await operator(c.req.header("authorization"), true);
    const hash = c.req.param("hash");
    const body = await c.req.json();
    await db.locked(`evidence:${domain}`, async (tx) => {
      const view = await read(hash, tx);
      if (view.status !== "prepared") throw invalid("An immutable review already exists", 409);
      if (body.decision !== "approve" && body.decision !== "reject")
        throw invalid("Review decision is invalid");
      const checks =
        view.envelope.packet.kind === "market-creation" ? creationChecks : resolutionChecks;
      if (body.decision === "approve" && checks.some((k) => body.checklist?.[k] !== true))
        throw invalid("Every review checklist item must be confirmed", 409);
      await verifyAttachments(view);
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
  app.post("/v1/admin/evidence/:hash/transaction", async (c) => {
    const owner = await operator(c.req.header("authorization"));
    const hash = c.req.param("hash");
    const view = await read(hash);
    if (view.status !== "approved") throw invalid("Explicit approval is required", 409);
    await verifyAttachments(view);
    const p = view.envelope.packet;
    const m = p.kind === "market-resolution" ? market(p.localMarket.marketId) : null;
    if (m && ![3, 4].includes(m.state))
      throw invalid("Market is no longer frozen or awaiting resolution", 409);
    // A market awaiting a different commitment (mistyped or contested) is re-committed to this
    // packet: the exchange lets the market admin replace a pending commitment.
    const matches =
      p.kind === "market-resolution" &&
      m!.commitment ===
        resolutionHash(
          chainId,
          exchange,
          m!.id,
          Number(p.payout.yes),
          Number(p.payout.no),
          view.envelope.packetHash as Hex,
          p.sourceReference,
        );
    const action =
      p.kind === "market-creation"
        ? "create-market"
        : m!.state === 3 || !matches
          ? "begin-resolution"
          : "resolve-market";
    const s = indexer.trading();
    const r = roles();
    // An unlisted base token is listed with the catalogued underlying of its on-chain symbol.
    const base = p.kind === "market-creation" ? getAddress(p.config.baseToken) : null;
    const symbol =
      base && !s.pools.has(base)
        ? await client
            .readContract({ address: base, abi: erc20Abi, functionName: "symbol" })
            .catch(() => null)
        : null;
    const { transactions, expectedMarketId } = evidenceTransactions(view.envelope, action, {
      chainId,
      exchange,
      marketAdmin: r.marketAdmin,
      resolutionAdmin: r.resolutionAdmin,
      nextMarketId: s.markets.size + 1,
      basePoolListed: (token: Address) => s.pools.has(token),
      baseUnderlying: () => {
        const underlying = catalogUnderlying(symbol);
        return underlying ? underlyingId(underlying) : null;
      },
    });
    const main = transactions.at(-1)!;
    const prerequisites = transactions.slice(0, -1);
    // Simulate what can execute now: the prerequisites, or the action itself.
    await preflightAdmin(client, prerequisites[0] ?? main);
    const preview: Preview = {
      ...main,
      action,
      packetHash: hash,
      previewId: crypto.randomUUID(),
      expectedMarketId,
      prerequisites,
    };
    await db.audit(domain, hash, "PREVIEW", owner, preview);
    return c.json(preview);
  });
  app.post("/v1/admin/evidence/:hash/verify-transaction", async (c) => {
    await operator(c.req.header("authorization"));
    const view = await read(c.req.param("hash"));
    const body = await c.req.json();
    const preview = view.previews.findLast((p) => p.action === body.action);
    if (!preview || view.status !== "approved") throw invalid("Approved preview not found", 409);
    for (const field of ["chainId", "from", "to", "data", "value"] as const)
      if (String(body[field]).toLowerCase() !== String(preview[field]).toLowerCase())
        throw invalid("Transaction differs from the approved preview", 409);
    return c.json({ matches: true, previewId: preview.previewId });
  });
  app.post("/v1/admin/evidence/:hash/reconcile", async (c) => {
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
      getAddress(transaction.to ?? "0x0000000000000000000000000000000000000000") !==
        getAddress(preview.to) ||
      getAddress(transaction.from) !== getAddress(preview.from) ||
      transaction.input.toLowerCase() !== preview.data.toLowerCase()
    )
      throw invalid("The executed transaction differs from the approved preview", 409);
    let marketId = preview.expectedMarketId;
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({
          abi: conditionalStocksAbi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "MarketCreated")
          marketId = String((event.args as { market: number }).market);
      } catch {
        // Not a protocol event.
      }
    }
    const observation = {
      action: preview.action,
      transactionHash: txHash,
      marketId,
      observedAt: new Date().toISOString(),
      block: receipt.blockNumber.toString(),
    };
    await db.audit(domain, hash, "RECONCILE", owner, observation);
    if (view.envelope.packet.kind === "market-creation")
      await polymarket().track(view.envelope.packet.polymarket.metadataSnapshotId);
    return c.json(observation);
  });
  app.get("/v1/admin/history", async (c) => {
    await operator(c.req.header("authorization"));
    const rows = await db.auditHistory(domain);
    return c.json({
      actions: rows.map((r) => ({
        id: r.id,
        action: r.kind,
        actor: r.actor,
        packetHash: r.packet_hash,
        details: r.payload,
        createdAt: r.created_at,
      })),
    });
  });
  app.get("/v1/markets/:id/resolution-evidence", async (c) => {
    const m = market(c.req.param("id"));
    if (!m.evidence) throw invalid("Final evidence is not available", 404);
    return c.json(await read(m.evidence));
  });
  // Content-addressed and published only by an (immutable) approval: caches may keep it forever,
  // and a revalidation is answered without reading the content from the database.
  const immutable = "public, max-age=31536000, immutable";
  app.get("/v1/attachments/:hash", async (c) => {
    const hash = `0x${c.req.param("hash").replace(/^0x/, "")}`;
    if (!isHex32(hash)) throw invalid("Invalid attachment hash");
    const etag = `"${hash.slice(2)}"`;
    let published = false;
    for (const packet of await db.attachmentPackets(domain, hash))
      if ((await read(packet)).status === "approved") published = true;
    if (!published) throw invalid("Published attachment not found", 404);
    if (c.req.header("if-none-match") === etag)
      return new Response(null, { status: 304, headers: { etag, "cache-control": immutable } });
    const content = await db.attachment(domain, hash);
    if (!content || attachmentContentHash(content) !== hash)
      throw invalid("Attachment integrity failure", 409);
    return new Response(new Uint8Array(content), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment",
        "x-content-type-options": "nosniff",
        "cache-control": immutable,
        etag,
      },
    });
  });
}
