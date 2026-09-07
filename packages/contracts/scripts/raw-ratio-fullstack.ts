/** Local-only integration of real Ponder handlers, HTTP gateway, matcher, worker and rebuild. */
import { resolve } from "node:path";
import { createDatabase, databaseUrl } from "@conditional-stocks/db/connection";
import { createGatewayQueries } from "@conditional-stocks/db/gateway";
import type { ReconciliationSnapshot } from "@conditional-stocks/db/reconciliation/types";
import { createSettlementQueries } from "@conditional-stocks/db/settlement";
import {
  type Abi,
  type Address,
  createPublicClient,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  toHex,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { createApp } from "../../../apps/api/src/app.ts";
import { IndexerClient, ViemGatewayChain } from "../../../apps/api/src/chain.ts";
import { GatewayService, HttpSettlementIntentSink } from "../../../apps/api/src/service.ts";
import { createOrder } from "../../../apps/ui/src/lib/trading/order.ts";
import { loadIndexerEnvironment } from "../../../services/rh-indexer/src/environment.ts";
import {
  hashProjection,
  runReconciliation,
} from "../../../services/rh-indexer/src/reconciliation/engine.ts";
import {
  PonderSettlementSource,
  type SettlementEnvironment,
  ViemSettlementChain,
} from "../../../services/settlement-worker/src/chain.ts";
import { SettlementWorker } from "../../../services/settlement-worker/src/worker.ts";
import {
  assertMarketUnits,
  hashOrder,
  type Order,
  orderTypedData,
} from "../../domain/src/index.ts";
import { parseOrder } from "../../gateway/src/index.ts";
import {
  canonicalParse,
  DeterministicMatcher,
  type MatcherEventEnvelope,
  makeBookKey,
  SlowReferenceMatcher,
} from "../../orderbook/src/index.ts";

interface Context {
  account: PrivateKeyAccount;
  privateKey: Hex; // Ephemeral Anvil signer, never persisted.
  seller: PrivateKeyAccount;
  localUrl: string;
  deploymentBlock: bigint;
  registry: Address;
  controller: Address;
  exchange: Address;
  settlement: Address;
  ioc: Address;
  recovery: Address;
  authority: Address;
  ctf: Address;
  router: Address;
  quote: Address;
  stocks: readonly { symbol: string; address: Address }[];
  abi(name: string): Abi;
  write(
    address: Address,
    abi: Abi,
    name: string,
    args?: readonly unknown[],
    signer?: PrivateKeyAccount,
  ): Promise<unknown>;
  pass(name: string, detail?: unknown): void;
  save(name: string, value: unknown): Promise<unknown>;
  record(value: unknown): void;
}

export async function verifyRawRatioFullstack(ctx: Context): Promise<void> {
  if (ctx.localUrl !== "http://127.0.0.1:18547") throw new Error("Private fork required");
  const local = createPublicClient({ transport: http(ctx.localUrl), pollingInterval: 20 });
  const rpc = (method: string, params: unknown[] = []) =>
    local.request({ method, params } as never);
  const connectionString = databaseUrl(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(connectionString).hostname))
    throw new Error("Fullstack rehearsal requires an isolated loopback PostgreSQL database");
  const database = createDatabase({ connectionString, chainId: 4663, exchange: ctx.exchange });
  await database.migrate();
  const indexerUrl = "http://127.0.0.1:18548";
  const rebuiltUrl = "http://127.0.0.1:18550";
  const children: { process: ReturnType<typeof Bun.spawn>; logs: Promise<void> }[] = [];
  const store = createGatewayQueries(database);
  const settlementStore = createSettlementQueries(database);
  let apiServer: ReturnType<typeof Bun.serve> | undefined;
  const json = <T>(value: T): string =>
    JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));
  const assert = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(message);
  };
  const fetchJson = async <T>(url: string): Promise<T> => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  const waitFor = async (label: string, ready: () => Promise<boolean>): Promise<void> => {
    const deadline = Date.now() + 90_000;
    let last = "not ready";
    while (Date.now() < deadline) {
      try {
        if (await ready()) return;
      } catch (error) {
        last = String(error);
      }
      for (const child of children)
        if (child.process.exitCode !== null) throw new Error(`Indexer exited during ${label}`);
      await Bun.sleep(250);
    }
    throw new Error(`Timeout: ${label}: ${last}`);
  };
  const environment = {
    ...process.env,
    ROBINHOOD_CHAIN_ID: "4663",
    ROBINHOOD_RPC_URL: ctx.localUrl,
    DEPLOYMENT_BLOCK: ctx.deploymentBlock.toString(),
    INDEXER_CONFIRMATION_BLOCKS: "1",
    INDEXER_FINALITY_BLOCKS: "2",
    INDEXER_FINALITY_MODE: "local-depth",
    INDEXER_CONFIRMATION_MODE: "sequencer-depth",
    INDEXER_MAX_HEAD_AGE_SECONDS: "315360000",
    INDEXER_POLLING_INTERVAL_MS: "250",
    PONDER_DISABLE_CACHE: "true",
    PONDER_TELEMETRY_DISABLED: "true",
    DO_NOT_TRACK: "1",
    DATABASE_URL: connectionString,
    INDEXER_END_BLOCK: "",
    CONDITIONAL_TOKENS_ADDRESS: ctx.ctf,
    EXCHANGE_ADDRESS: ctx.exchange,
    MARKET_REGISTRY_ADDRESS: ctx.registry,
    ORDER_RECOVERY_ROUTER_ADDRESS: ctx.recovery,
    POSITION_ROUTER_ADDRESS: ctx.router,
    PROTOCOL_AUTHORITY_ADDRESS: ctx.authority,
    RESOLUTION_CONTROLLER_ADDRESS: ctx.controller,
    SETTLEMENT_ADDRESS: ctx.settlement,
  };
  const startIndexer = async (port: number, name: string): Promise<void> => {
    const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("reserved") });
    probe.stop(true);
    const child = Bun.spawn(
      [
        "bun",
        "scripts/ponder.ts",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
        "--disable-ui",
      ],
      {
        cwd: resolve(import.meta.dir, "../../../services/rh-indexer"),
        env: { ...environment, DATABASE_SCHEMA: name.replaceAll("-", "_") },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const logs = Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]).then(async ([stdout, stderr]) => {
      await ctx.save(`${name}-logs.json`, { stdout, stderr });
    });
    children.push({ process: child, logs });
  };
  const advance = async (): Promise<bigint> => {
    for (let i = 0; i < 3; i++) await rpc("evm_mine");
    return (await local.getBlock()).number;
  };
  const sync = async (): Promise<void> => {
    const target = await advance();
    await waitFor(
      "primary indexer caught up",
      async () =>
        BigInt(
          (await fetchJson<{ head: { indexedBlock: string } }>(`${indexerUrl}/indexer/health`)).head
            .indexedBlock,
        ) >= target,
    );
  };
  try {
    const marketIds: { id: Hex; symbol: string }[] = [];
    for (const stock of ctx.stocks) {
      const now = (await local.getBlock()).timestamp;
      const uri = `ipfs://raw-ratio-fullstack-${stock.symbol}`;
      const config = {
        baseToken: stock.address,
        quoteToken: ctx.quote,
        polymarketConditionId: keccak256(toHex(uri)),
        polymarketYesIndex: 1n,
        polymarketNoIndex: 2n,
        tradingOpen: now,
        tradingCutoff: now + 3600n,
        rulesHash: keccak256(toHex(uri)),
        metadataHash: keccak256(toHex(uri)),
        priceTickRawX18: 10_000n,
        baseStep: 10n ** 15n,
        minNotional: 10_000n,
        maxOrderQuantity: 10n ** 19n,
        maxOrderNotional: 10_000_000_000n,
        maxWalletOpenNotional: 100_000_000_000n,
        maxMarketOpenNotional: 1_000_000_000_000n,
      };
      const id = (await ctx.write(ctx.registry, ctx.abi("MarketRegistry"), "createMarket", [
        config,
        uri,
      ])) as Hex;
      await ctx.write(ctx.registry, ctx.abi("MarketRegistry"), "openMarket", [id]);
      marketIds.push({ id, symbol: stock.symbol });
    }
    await startIndexer(18548, "primary");
    await sync();
    const apiEnvironment = {
      authDomain: "localhost",
      authOrigin: "http://localhost",
      chainId: 4663,
      conditionalTokens: ctx.ctf,
      exchange: ctx.exchange,
      indexerUrl,
      iocRouter: ctx.ioc,
      marketRegistry: ctx.registry,
      positionRouter: ctx.router,
      relayerPrivateKey: null,
      rpcUrl: ctx.localUrl,
      settlementWorkerUrl: "http://127.0.0.1:1",
      settlementWorkerToken: "local-only",
    };
    const gatewayChain = new ViemGatewayChain(apiEnvironment);
    await gatewayChain.assertNetwork();
    const service = new GatewayService(
      apiEnvironment,
      store,
      gatewayChain,
      new IndexerClient(indexerUrl),
      new HttpSettlementIntentSink(apiEnvironment.settlementWorkerUrl, "local-only"),
    );
    apiServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createApp(service).fetch });
    const apiUrl = `http://127.0.0.1:${apiServer.port}`;
    const api = async <T>(path: string, body: unknown, token?: string): Promise<T> => {
      const response = await fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: json(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Gateway ${path}: ${await response.text()}`);
      return response.json() as Promise<T>;
    };
    const sessions = new Map<Address, string>();
    for (const actor of [ctx.account, ctx.seller]) {
      const challenge = await api<{ message: string; challengeId: string }>("/v1/auth/challenge", {
        address: actor.address,
      });
      const session = await api<{ token: string }>("/v1/auth/verify", {
        address: actor.address,
        challengeId: challenge.challengeId,
        signature: await actor.signMessage({ message: challenge.message }),
      });
      sessions.set(actor.address, session.token);
    }
    const settlementEnvironment: SettlementEnvironment = {
      chainId: 4663,
      exchange: ctx.exchange,
      indexerUrl,
      internalToken: "local-only",
      iocRouter: ctx.ioc,
      leaseTtlMs: 15_000n,
      matcherCallbackUrl: null,
      ownerId: "raw-ratio-e2e",
      port: 0,
      privateKey: ctx.privateKey,
      protocolAuthority: ctx.authority,
      replacementBumpBps: 1250n,
      rpcUrl: ctx.localUrl,
      stuckMs: 30_000n,
    };
    const settlementChain = new ViemSettlementChain(settlementEnvironment);
    await settlementChain.preflight();
    const worker = new SettlementWorker(
      settlementStore,
      settlementChain,
      new PonderSettlementSource(indexerUrl),
      { environment: settlementEnvironment },
    );
    for (const { id, symbol } of marketIds) {
      const market = await fetchJson<Record<string, unknown>>(`${indexerUrl}/markets/${id}`);
      assertMarketUnits(market);
      assert(
        market.baseTokenDecimals === 18 && market.quoteTokenDecimals === 6,
        "Indexer decimals mismatch",
      );
      const now = (await local.getBlock()).timestamp;
      const orders: Order[] = [];
      for (const [actor, side, price, quantity] of [
        [ctx.seller, "sell", "200", "1"],
        [ctx.account, "buy", "210", "2"],
      ] as const) {
        const wire = createOrder(
          {
            ...market,
            account: actor.address,
            branch: "YES",
            cutoff: new Date(Number(now + 3500n) * 1000).toISOString(),
            funding: "whole",
            marketId: id,
            price,
            quantity,
            side,
            tif: "gtc",
          },
          { nowMs: Number(now * 1000n), salt: keccak256(toHex(`${id}-${side}`)) },
        );
        const preparation = await api<{
          fundingReady: boolean;
          notional: string;
          funding: { amount: string; decimals: number };
          schemaVersion: number;
        }>("/v1/orders/prepare", { order: wire }, sessions.get(actor.address));
        assert(
          preparation.schemaVersion === 2 && preparation.fundingReady,
          "API could not prepare real-token order",
        );
        assert(
          preparation.notional === (side === "buy" ? "420000000" : "200000000"),
          "HTTP notional scaling mismatch",
        );
        if (side === "buy")
          assert(
            preparation.funding.amount === "420000000" && preparation.funding.decimals === 6,
            "HTTP escrow units mismatch",
          );
        const order = parseOrder(wire);
        orders.push(order);
        await ctx.write(
          ctx.exchange,
          ctx.abi("ConditionalExchange"),
          "openOrder",
          [
            order,
            await actor.signTypedData(
              orderTypedData(order, { chainId: 4663n, verifyingContract: ctx.exchange }),
            ),
          ],
          actor,
        );
      }
      await sync();
      const response = await fetch(
        `${indexerUrl}/internal/matcher-events?afterBlock=${ctx.deploymentBlock - 1n}&limit=1000`,
      );
      assert(response.ok, "Matcher event stream unavailable");
      const stream = canonicalParse<{
        events: MatcherEventEnvelope[];
        schemaVersion: number;
        hasMore: boolean;
      }>(await response.text());
      assert(
        stream.schemaVersion === 2 && !stream.hasMore,
        "Unexpected event stream version/pagination",
      );
      const matcher = new DeterministicMatcher();
      const reference = new SlowReferenceMatcher();
      for (const event of stream.events) {
        matcher.apply(event);
        reference.apply(event);
      }
      const preview = matcher.preview(makeBookKey(id, 0));
      assert(
        json(preview) === json(reference.preview(makeBookKey(id, 0))),
        "Live matcher/reference divergence",
      );
      const proposal = preview.proposal;
      if (!proposal) throw new Error("Live orderbook produced no proposal");
      assert(
        proposal.fills.length === 1 &&
          proposal.fills[0]?.executionPriceRawX18 === 200_000_000n &&
          proposal.fills[0]?.fillQuantity === 10n ** 18n,
        "Live proposal units mismatch",
      );
      await worker.enqueueProposal(proposal);
      await waitFor("worker confirms real-token fill", async () => {
        const result = await worker.process(proposal.batchId);
        if (result.status === "failed" || result.status === "quarantined")
          throw new Error(json(result.error));
        if (result.status === "confirmed") return true;
        await advance();
        return false;
      });
      for (const attempt of await settlementStore.attempts(proposal.batchId)) {
        const receipt = await local.getTransactionReceipt({ hash: attempt.transactionHash });
        ctx.record({
          functionName: "settlementWorkerMatch",
          hash: attempt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          status: receipt.status,
        });
      }
      await sync();
      const bid = orders[1];
      if (!bid) throw new Error("Missing bid");
      const bidHash = hashOrder(bid, { chainId: 4663n, verifyingContract: ctx.exchange });
      const indexed = await fetchJson<{ remaining: string; reserved: string }>(
        `${indexerUrl}/orders/${bidHash}`,
      );
      assert(
        indexed.remaining === "1000000000000000000" && indexed.reserved === "210000000",
        "Indexer partial reservation units mismatch",
      );
      await api(
        "/v1/orders/cancel/prepare",
        { orderHash: bidHash },
        sessions.get(ctx.account.address),
      );
      await ctx.write(ctx.exchange, ctx.abi("ConditionalExchange"), "cancelOrder", [bidHash]);
      await sync();
      const positions = await fetchJson<{
        positions: {
          marketId: string;
          stockYes: string;
          quoteNo: string;
          baseTokenDecimals: number;
          quoteTokenDecimals: number;
        }[];
      }>(`${indexerUrl}/positions/${ctx.account.address}`);
      const position = positions.positions.find(
        (row) => row.marketId.toLowerCase() === id.toLowerCase(),
      );
      assert(
        position?.stockYes === "1000000000000000000" &&
          position.quoteNo === "200000000" &&
          position.baseTokenDecimals === 18 &&
          position.quoteTokenDecimals === 6,
        "Indexed claim units mismatch",
      );
      const whole = await fetchJson<{ canonicalBalance: string; decimals: number }>(
        `${indexerUrl}/balances/${ctx.account.address}?token=${ctx.quote}`,
      );
      const rawBalance = await local.readContract({
        abi: erc20Abi,
        address: ctx.quote,
        functionName: "balanceOf",
        args: [ctx.account.address],
      });
      assert(
        whole.decimals === 6 && BigInt(whole.canonicalBalance) === rawBalance,
        "Indexed USDG canonical balance mismatch",
      );
      await ctx.save(`fullstack-${symbol}.json`, {
        market,
        proposal,
        indexedPartialBid: indexed,
        positions,
        whole,
      });
      ctx.pass(
        `${symbol}/USDG live UI input → HTTP API → Ponder → matcher/reference → settlement worker → indexed claims/cancellation`,
      );
    }
    const primary = await fetchJson<ReconciliationSnapshot>(
      `${indexerUrl}/internal/reconciliation-snapshot?deep=true`,
    );
    const reconciliation = await runReconciliation(primary, loadIndexerEnvironment(environment), {
      deep: true,
      exclusiveConditionalTokens: true,
    });
    await ctx.save("fullstack-reconciliation.json", reconciliation);
    assert(
      reconciliation.status === "ok" && reconciliation.issues.length === 0,
      "Deep reconciliation failed",
    );
    await startIndexer(18550, "rebuilt");
    await waitFor(
      "clean indexer replay",
      async () =>
        (await fetchJson<{ head: { indexedBlock: string } }>(`${rebuiltUrl}/indexer/health`)).head
          .indexedBlock === primary.state.indexedBlock,
    );
    const rebuilt = await fetchJson<ReconciliationSnapshot>(
      `${rebuiltUrl}/internal/reconciliation-snapshot?deep=true`,
    );
    assert(hashProjection(primary) === hashProjection(rebuilt), "Fresh Ponder replay differs");
    await ctx.save("fullstack-rebuild.json", {
      primaryHash: hashProjection(primary),
      rebuiltHash: hashProjection(rebuilt),
      indexedBlock: primary.state.indexedBlock,
      projectionVersion: 2,
    });
    ctx.pass("Real-token live indexer deep reconciliation and clean database replay match exactly");
  } finally {
    apiServer?.stop(true);
    for (const child of children) {
      if (child.process.exitCode === null) child.process.kill("SIGTERM");
      await child.process.exited;
      await child.logs;
    }
    await database.close();
  }
}
