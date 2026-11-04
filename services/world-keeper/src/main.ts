/** The world keeper (docs/version-2-plan.md §10.5): one process per mode.
 *
 *   quote  the world vault's market maker on the API's RFQ stream (keeper key)
 *   mark   closes due batches and marks them (marker key)
 *   fit    the nightly fit of correlations, volatilities and gaps (database only), after
 *          filling each live leg's missing days from its venue (WK_BACKFILL=off skips it)
 *
 * Dry run by default: signing needs WK_MODE=live and --execute. Environment:
 *   WK_CHAIN_ID, WK_RPC_URL, WK_BOOKS_ADDRESS, WK_DEPLOYMENT_BLOCK, WK_CONFIG_PATH,
 *   WK_VAULT_ADDRESSES (every vault the API follows, so its checkpoint restores; default the
 *   configured vault), WK_DATABASE_URL (the API's database: its checkpoint, book metadata and
 *   fits, read only but for the fit and marks), WK_API_ORIGIN, WK_RFQ_URL, WK_RFQ_API_KEY,
 *   WK_PRIVATE_KEY + WK_WALLET_ADDRESS (keeper), WK_MARKER_PRIVATE_KEY + WK_MARKER_ADDRESS,
 *   WK_STATE_DIR (private), WK_FEEDS_PATH (the deployment's feeds, default
 *   deployments/<chainId>-mock-feeds.json: every stock a user's world may fix on gets settings
 *   and its token's spot unless the config names it). */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, type Database, type WorldBookRecord } from "@conditional-stocks/db";
import { BOOK_STATUS, DEPLOYLESS_BATCH_SIZE, worldBooksAbi } from "@conditional-stocks/evm-client";
import {
  hasVaultRole,
  type WorldEvent,
  type WorldState,
  type WorldTouched,
} from "@conditional-stocks/evm-client/world-ledger";
import { ChainFollower } from "@conditional-stocks/indexer";
import { worldLedger } from "@conditional-stocks/indexer/worlds";
import { apiOrigin, Executor, signer } from "@conditional-stocks/operator";
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";
import { type Address, createPublicClient, defineChain, getAddress, http, zeroAddress } from "viem";
import { backfillProbabilities, type HistoryLeg, VenueHistory } from "./backfill.ts";
import { settings as parseSettings } from "./config.ts";
import { log, WorldKeeper } from "./engine.ts";
import { runFit } from "./fit.ts";
import { emptyData, type PricingData, spotSources } from "./inputs.ts";
import { WorldMarker } from "./marker.ts";
import { LegReferences, SpotReferences } from "./references.ts";
import { WorldRfqMaker } from "./rfq.ts";
import { StateFile } from "./state.ts";

const env = process.env;
const required = (name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

/** The pricing data from the database: fits, relations, volatilities and gaps. */
async function loadData(db: Database, conditions: string[]): Promise<PricingData> {
  const [correlations, relations, vols, gaps, probit] = await Promise.all([
    db.worldCorrelations(conditions),
    db.legRelations(conditions),
    db.worldVols(),
    db.worldGaps(),
    db.eventVolatilities(conditions),
  ]);
  const data = emptyData();
  for (const c of correlations)
    data.correlations.set(`${c.a.toLowerCase()}:${c.b.toLowerCase()}`, {
      rho: c.rho,
      se: c.error,
      samples: c.samples,
    });
  for (const r of relations) data.relations.set(`${r.a.toLowerCase()}:${r.b.toLowerCase()}`, r);
  for (const v of vols)
    data.vols.set(v.underlying, { vol: v.vol, error: v.error, method: v.method });
  for (const g of gaps)
    data.gaps.set(`${g.condition.toLowerCase()}:${g.underlying}`, { gap: g.gap, error: g.error });
  for (const p of probit) data.probitVols.set(p.condition.toLowerCase(), p.vol);
  return data;
}

async function main() {
  const command = process.argv[2];
  if (command !== "quote" && command !== "mark" && command !== "fit")
    throw new Error("Run quote, mark or fit");
  // The fit signs nothing: it runs with the keeper's environment, live or not.
  const live = env.WK_MODE === "live" && command !== "fit";
  if (live && !process.argv.includes("--execute"))
    throw new Error("Live signing requires --execute as well as WK_MODE=live");
  const rpc = required("WK_RPC_URL");
  const url = new URL(rpc);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid RPC transport");
  const chainId = Number(required("WK_CHAIN_ID"));
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({
    chain,
    batch: { multicall: { deployless: true, batchSize: DEPLOYLESS_BATCH_SIZE, wait: 5 } },
    transport: http(rpc, { batch: { wait: 5 }, retryCount: 2 }),
  });
  if ((await client.getChainId()) !== chainId) throw new Error("RPC serves a different chain");
  const raw = JSON.parse(
    readFileSync(env.WK_CONFIG_PATH ?? "services/world-keeper/config.example.json", "utf8"),
  ) as { underlyings?: Record<string, Record<string, unknown>> };
  // Users choose the stock of their world: every listed feed's underlying is quotable, its
  // token's reference price the spot, unless the config sets it.
  const feedsPath = env.WK_FEEDS_PATH ?? `deployments/${chainId}-mock-feeds.json`;
  if (existsSync(feedsPath)) {
    const underlyings = { ...(raw.underlyings ?? {}) };
    for (const f of JSON.parse(readFileSync(feedsPath, "utf8")) as {
      symbol?: string;
      token?: string;
    }[]) {
      const asset = catalogAsset(f.symbol);
      if (!asset?.underlying || asset.kind === "stablecoin") continue;
      const configured = underlyings[asset.underlying];
      const kind = asset.kind === "etf" ? "etf" : asset.kind === "crypto" ? "crypto" : "stock";
      underlyings[asset.underlying] = {
        kind,
        ...(f.token ? { token: f.token } : {}),
        ...configured,
      };
    }
    raw.underlyings = underlyings;
  }
  const settings = parseSettings(raw);
  const books = getAddress(required("WK_BOOKS_ADDRESS"));
  const [oracle, quote] = await Promise.all([
    client.readContract({ address: books, abi: worldBooksAbi, functionName: "oracle" }),
    client.readContract({ address: books, abi: worldBooksAbi, functionName: "quote" }),
  ]);
  const vaults = (env.WK_VAULT_ADDRESSES ?? settings.vault)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => getAddress(v));
  if (!vaults.includes(settings.vault))
    throw new Error("WK_VAULT_ADDRESSES must include the configured vault");
  const deployment = { chainId, books, oracle, quote, vaults };
  const domain = `${chainId}:${books}`;
  const databaseUrl = env.WK_DATABASE_URL?.trim();
  const db = databaseUrl
    ? createDatabase({
        connectionString: databaseUrl,
        max: 2,
        applicationName: `probabl-world-${command}`,
      })
    : undefined;
  const origin = apiOrigin(env.WK_API_ORIGIN ?? "https://api.probabl.trade");

  let onEvents: ((s: WorldState, events: WorldEvent[]) => void) | undefined;
  const follower = new ChainFollower<WorldState, WorldTouched, WorldEvent>({
    client,
    exchange: books,
    quote,
    ledger: worldLedger(deployment),
    deploymentBlock: BigInt(required("WK_DEPLOYMENT_BLOCK")),
    domain,
    pollMs: 1_000,
    ...(db ? { db } : {}),
    onCommit: (notice) => onEvents?.(notice.state, notice.events),
    onError: () => log("chain-read-failed"),
  });
  await follower.start();

  // Book metadata: the API's database when configured, else its public metadata route.
  let metadata = new Map<number, WorldBookRecord>();
  const loadMetadata = async () => {
    const s = follower.confirmed;
    const rows = db
      ? await db.worldBooks(domain)
      : await Promise.all(
          [...s.books.values()].map(async (b) => {
            const r = await fetch(`${origin}/v2/books/meta/${b.defHash}`, {
              signal: AbortSignal.timeout(8_000),
            });
            if (!r.ok) return null;
            const m = (await r.json()) as WorldBookRecord["metadata"] & {
              title: string;
              kind: "curated" | "user";
            };
            return {
              defHash: b.defHash,
              book: b.id,
              title: m.title,
              kind: m.kind,
              metadata: m,
              packetHash: null,
              createdAt: new Date(),
            };
          }),
        );
    const next = new Map<number, WorldBookRecord>();
    for (const row of rows) {
      if (!row) continue;
      const id = s.bookOf.get(row.defHash.toLowerCase() as `0x${string}`);
      if (id) next.set(id, row);
    }
    metadata = next;
  };
  await loadMetadata().catch((error) =>
    log("metadata-unavailable", { reason: (error as Error).message }),
  );
  const conditions = () => [
    ...new Set(
      [...metadata.values()].flatMap((m) =>
        m.metadata.legs.map((l) => l.conditionId.toLowerCase()),
      ),
    ),
  ];

  if (command === "fit") {
    if (!db) throw new Error("The fit needs WK_DATABASE_URL");
    const s = follower.confirmed;
    const underlyings = new Map<
      string,
      { symbol: string; feed: Address; kind: "stock" | "etf" | "crypto"; conditions: string[] }
    >();
    for (const b of s.books.values()) {
      const m = metadata.get(b.id);
      const symbol = m?.metadata.underlying;
      if (!m || !symbol || b.def.feed === zeroAddress) continue;
      const u = underlyings.get(symbol) ?? {
        symbol,
        feed: b.def.feed,
        kind: settings.underlyings[symbol]?.kind ?? "stock",
        conditions: [],
      };
      u.conditions.push(...m.metadata.legs.map((l) => l.conditionId.toLowerCase()));
      underlyings.set(symbol, u);
    }
    // Live legs' missing history first, so a new event's correlations fit from its first night.
    if (env.WK_BACKFILL !== "off") {
      const live = [...metadata].filter(
        ([id]) => s.books.get(id)?.status === BOOK_STATUS.undecided,
      );
      const legs: HistoryLeg[] = live.flatMap(([, m]) =>
        m.metadata.legs.map((l) => ({
          condition: l.conditionId.toLowerCase(),
          source: l.source,
          marketId: l.marketId,
          yesIndex: l.yesIndex,
        })),
      );
      await backfillProbabilities({ db, legs, history: new VenueHistory(), log });
    }
    await runFit({
      db,
      client,
      conditions: conditions(),
      underlyings: [...underlyings.values()],
      log,
    });
    follower.stop();
    await db.close();
    return;
  }

  let data: PricingData = emptyData();
  const loadData_ = async () => {
    if (db) data = await loadData(db, conditions());
  };
  await loadData_().catch((error) =>
    log("pricing-data-unavailable", { reason: (error as Error).message }),
  );
  const legs = new LegReferences({ origin, onError: log });
  const spot = new SpotReferences({
    client,
    origin,
    pollMs: 2_000,
    sources: () => spotSources(follower.confirmed, metadata, settings),
    onError: log,
  });
  spot.start();
  const followLegs = () => {
    for (const c of conditions()) legs.follow(c as `0x${string}`);
  };
  followLegs();

  // The signing key of this mode, checked against the vault's roles.
  const vault = follower.confirmed.vaults.get(settings.vault);
  if (!vault) throw new Error("The configured vault is not followed");
  const keyName = command === "quote" ? "WK_PRIVATE_KEY" : "WK_MARKER_PRIVATE_KEY";
  const addressName = command === "quote" ? "WK_WALLET_ADDRESS" : "WK_MARKER_ADDRESS";
  const account = live
    ? signer(required(keyName), required(addressName), keyName, addressName)
    : undefined;
  if (account) {
    const role = command === "quote" ? "keeper" : "marker";
    if (!hasVaultRole(vault, role, account.address))
      throw new Error(`The wallet is not the vault's ${role}`);
    if (
      role === "keeper" &&
      (["admin", "curator", "marker"] as const).some((r) => hasVaultRole(vault, r, account.address))
    )
      throw new Error("A keeper must hold no admin, curator or marker role");
    if (role === "marker" && hasVaultRole(vault, "keeper", account.address))
      throw new Error("A marker must not also be a keeper");
  }
  const directory = env.WK_STATE_DIR ?? ".local/world-keeper";
  const scope = [chainId, settings.vault, command, account?.address ?? "dry-run"].join(":");
  const file = account
    ? new StateFile(
        resolve(directory, `${chainId}-${settings.vault.toLowerCase()}-${command}.json`),
        scope,
      )
    : undefined;
  const state = file?.state ?? (await import("./state.ts")).initialState(scope);
  const save = () => file?.saveAsync();
  const executor = account
    ? new Executor(client, account, settings, state, save, {
        receiptPollMs: settings.receiptPollMs,
        gasHeadroomBps: 2_500,
      })
    : undefined;
  const keeper = new WorldKeeper({
    follower,
    settings,
    chainId,
    legs,
    spot,
    metadata: () => metadata,
    data: () => data,
    state,
    save,
    ...(command === "quote" && account ? { account } : {}),
    ...(command === "quote" && executor ? { executor } : {}),
  });
  const marker =
    command === "mark"
      ? new WorldMarker({
          keeper,
          vault: settings.vault,
          ...(db ? { db } : {}),
          domain,
          ...(executor ? { executor } : {}),
          log,
        })
      : null;
  onEvents = (s, events) => {
    keeper.onFills(events);
    marker?.observe(s, events);
    if (events.some((e) => e.name === "BookCreated"))
      void loadMetadata()
        .then(followLegs)
        .catch(() => {});
  };

  let maker: WorldRfqMaker | undefined;
  if (command === "quote") {
    maker = new WorldRfqMaker({
      keeper,
      url: env.WK_RFQ_URL ?? `${origin.replace(/^http/, "ws")}/v1/rfq/stream`,
      apiKey: required("WK_RFQ_API_KEY"),
      chainId,
      indicationMs: settings.quotes.indicationMs,
      live: Boolean(account),
      log,
    });
    maker.start();
  }
  let stopped = false;
  const stop = () => {
    stopped = true;
    keeper.stopped = true;
    maker?.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  log("starting", { command, live, vault: settings.vault, books: follower.confirmed.books.size });
  const timers = [
    setInterval(() => {
      keeper.refresh();
      if (keeper.unannounced()) maker?.indicate();
    }, 1_000),
    setInterval(
      () =>
        void loadMetadata()
          .then(followLegs)
          .catch(() => {}),
      60_000,
    ),
    setInterval(() => void loadData_().catch(() => {}), 600_000),
  ];
  try {
    while (!stopped) {
      keeper.refresh();
      try {
        if (marker) log("mark-round", { result: await marker.round(follower.confirmed) });
        else await keeper.housekeeping();
      } catch (error) {
        log("round-failed", { reason: (error as Error).message });
      }
      if (process.argv.includes("--once")) break;
      await new Promise((r) => setTimeout(r, marker ? 30_000 : settings.pollMs));
    }
  } finally {
    for (const t of timers) clearInterval(t);
    maker?.stop();
    legs.stop();
    spot.stop();
    follower.stop();
    file?.close();
    await db?.close();
  }
}

main().catch((error) => {
  console.error(
    `World keeper stopped: ${error instanceof Error && /^(Missing|Run|Live|Invalid|The |A |WK_)/.test(error.message) ? error.message : "configuration or safety validation failed"}`,
  );
  process.exitCode = 1;
});
