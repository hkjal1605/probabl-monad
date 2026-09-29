/** Creates the demo catalogue on a local deployment through the real admin evidence flow:
 * Polymarket metadata → creation evidence → review → API transaction preview, verified against
 * a locally built transaction → signed by the market admin → reconciled → opened. Then funds
 * the market maker. Resumable: progress is kept in .local/market-seed.json.
 *
 * Requires the dev stack (scripts/evm/dev.ts) with the Polymarket ingestor enabled. */
import { resolve } from "node:path";
import { conditionalStocksAbi, underlyingId } from "@conditional-stocks/evm-client";
import {
  type AdminPreview,
  type AdminTransaction,
  evidenceTransactions,
  lifecycleTransaction,
  type PacketEnvelope,
} from "@conditional-stocks/evm-client/admin";
import { catalogUnderlying } from "@conditional-stocks/shared/token-catalog";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  type Hex,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { DEMO_MARKET_SEED, validateMarketSeed } from "./seed-policy.ts";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required: run with --env-file=.local/anvil.env`);
  return value;
};
const root = resolve(import.meta.dir, "../..");
const statePath = resolve(root, ".local/market-seed.json");
const deployment = (await Bun.file(resolve(root, ".local/anvil-deployment.json")).json()) as {
  exchange: `0x${string}`;
  quote: `0x${string}`;
  stocks: Record<string, `0x${string}`>;
};
const api = required("API_URL"),
  rpc = required("RPC_URL"),
  origin = "http://localhost:3002";
const admin = privateKeyToAccount(required("SEED_ADMIN_PRIVATE_KEY") as Hex);
const chain = { ...foundry, rpcUrls: { default: { http: [rpc] } } };
const client = createPublicClient({ chain, transport: http(rpc), pollingInterval: 250 });
const wallet = createWalletClient({ account: admin, chain, transport: http(rpc) });
validateMarketSeed();

type SeedRecord = { packetHash?: string; marketId?: string; opened?: true };
const state: Record<string, SeedRecord> = (await Bun.file(statePath).exists())
  ? await Bun.file(statePath).json()
  : {};
const save = () => Bun.write(statePath, JSON.stringify(state, null, 2));

async function call<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`${path}: ${json.error?.message ?? response.status}`);
  return json;
}
async function send(transaction: AdminTransaction | { to: `0x${string}`; data: Hex }) {
  const hash = await wallet.sendTransaction({ to: transaction.to, data: transaction.data });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Seed transaction reverted");
  return hash;
}

const { challengeId, message } = await call<{ challengeId: string; message: string }>(
  "/v1/auth/challenge",
  { address: admin.address, origin },
);
const { token } = await call<{ token: string }>("/v1/auth/verify", {
  address: admin.address,
  challengeId,
  signature: await admin.signMessage({ message }),
});
const checklist = Object.fromEntries(
  [
    "stock-and-quote",
    "condition-id",
    "yes-no-orientation",
    "rules-and-dates",
    "source-and-raw-hash",
  ].map((key) => [key, true]),
);
const now = Math.floor(Date.now() / 1000);
const markets: { market: number; base: `0x${string}` }[] = [];

for (const event of DEMO_MARKET_SEED) {
  let snapshot:
    | { snapshotId: string; normalized: { endTime: string; canonicalUrl: string; rules: string } }
    | undefined;
  for (const ticker of event.tickers) {
    const id = `${event.slug}:${ticker}`,
      record = state[id] ?? {},
      base = deployment.stocks[ticker]!;
    state[id] = record;
    try {
      if (!record.marketId) {
        if (!record.packetHash) {
          snapshot ??= await call(
            "/v1/admin/polymarket/metadata/fetch",
            { gammaMarketId: event.gammaMarketId },
            token,
          );
          const end = Math.floor(Date.parse(snapshot!.normalized.endTime) / 1000);
          const envelope = await call<{ envelope: PacketEnvelope }>(
            "/v1/admin/evidence/creation/prepare",
            {
              metadataSnapshotId: snapshot!.snapshotId,
              sourceUrls: [snapshot!.normalized.canonicalUrl],
              attachments: [],
              config: {
                baseToken: base,
                quoteToken: deployment.quote,
                baseStep: "1000000000000000",
                priceTickRawX18: "10000",
                minNotional: "1000000",
                maxOrderQuantity: "1000000000000000000000",
                maxOrderNotional: "10000000000",
                maxWalletOpenNotional: "100000000000",
                maxMarketOpenNotional: "1000000000000",
                tradingOpen: String(now - 60),
                tradingCutoff: String(end > now + 3600 ? end : now + 90 * 86_400),
                metadataUri: snapshot!.normalized.canonicalUrl,
                rules: snapshot!.normalized.rules,
              },
            },
            token,
          );
          record.packetHash = envelope.envelope.packetHash;
          await save();
          await call(
            `/v1/admin/evidence/${record.packetHash}/review`,
            { decision: "approve", checklist, notes: "Local demo seed" },
            token,
          );
        }
        const view = await call<{
          envelope: PacketEnvelope;
          status: string;
          observations: { marketId?: string }[];
        }>(`/v1/admin/evidence/${record.packetHash}`, undefined, token);
        // Already executed and recorded (e.g. only the Polymarket subscription failed).
        const executed = view.observations.find((o) => o.marketId)?.marketId;
        if (executed) record.marketId = executed;
      }
      if (!record.marketId) {
        const view = await call<{ envelope: PacketEnvelope }>(
          `/v1/admin/evidence/${record.packetHash}`,
          undefined,
          token,
        );
        const preview = await call<AdminPreview & { prerequisites: AdminTransaction[] }>(
          `/v1/admin/evidence/${record.packetHash}/transaction`,
          {},
          token,
        );
        // Sign only what this script builds from the approved evidence and the live chain.
        const [[marketAdmin, , resolutionAdmin], count, pool, symbol] = await Promise.all([
          client.readContract({
            address: deployment.exchange,
            abi: conditionalStocksAbi,
            functionName: "roles",
          }),
          client.readContract({
            address: deployment.exchange,
            abi: conditionalStocksAbi,
            functionName: "marketCount",
          }),
          client.readContract({
            address: deployment.exchange,
            abi: conditionalStocksAbi,
            functionName: "pool",
            args: [base],
          }),
          client.readContract({ address: base, abi: erc20Abi, functionName: "symbol" }),
        ]);
        const underlying = catalogUnderlying(symbol);
        const { transactions } = evidenceTransactions(view.envelope, "create-market", {
          chainId: foundry.id,
          exchange: deployment.exchange,
          marketAdmin,
          resolutionAdmin,
          nextMarketId: count + 1,
          basePoolListed: () => pool.listed,
          baseUnderlying: () => (underlying ? underlyingId(underlying) : null),
        });
        const remote = [...preview.prerequisites, preview];
        if (
          remote.length !== transactions.length ||
          transactions.some((t, i) => t.data !== remote[i]!.data || t.to !== remote[i]!.to)
        )
          throw new Error("API preview differs from the locally built transaction");
        let hash: Hex = "0x";
        for (const transaction of transactions) hash = await send(transaction);
        const receipt = await client.getTransactionReceipt({ hash });
        const created = parseEventLogs({
          abi: conditionalStocksAbi,
          logs: receipt.logs,
          eventName: "MarketCreated",
        })[0];
        if (!created) throw new Error("No market was created");
        record.marketId = String(created.args.market);
        await save();
        await call(
          `/v1/admin/evidence/${record.packetHash}/reconcile`,
          { action: "create-market", transactionHash: hash },
          token,
        ).catch((error) =>
          console.warn(
            `Market ${record.marketId} reconciled with a warning: ${error instanceof Error ? error.message : error}`,
          ),
        );
      }
      if (!record.opened) {
        await send(
          lifecycleTransaction(
            { chainId: foundry.id, exchange: deployment.exchange },
            admin.address,
            Number(record.marketId),
            0,
            "",
          ),
        );
        record.opened = true;
        await save();
      }
      markets.push({ market: Number(record.marketId), base });
      console.info(`Market ${record.marketId}: ${ticker} · ${event.question}`);
    } catch (error) {
      console.warn(`Skipped ${id}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
if (process.env.MM_CONFIG_PATH && markets.length) {
  await Bun.write(
    process.env.MM_CONFIG_PATH,
    JSON.stringify(
      {
        markets: markets.map(({ market, base }) => ({
          market,
          base,
          baseInventory: "100",
          quoteInventory: "20000",
          orderQuote: "2000",
          gapBps: 200,
          basePriceMultiplier: "1",
          quotePriceMultiplier: "1",
        })),
        // US equity references do not update outside market hours; a local node still quotes.
        allowStaleSpot: true,
        quoteLevels: 3,
        maxFeedAgeMs: 900000,
        pollMs: 15000,
        ttlSeconds: 300,
      },
      null,
      2,
    ),
  );
  // The maker quotes only from live reference prices (Pyth Hermes requires PYTH_HERMES_API_KEY).
  const spot = await call<{ prices: { status: string }[] }>(
    `/v1/spot-prices?tokens=${deployment.quote},${markets[0]!.base}`,
  );
  if (spot.prices.some((price) => price.status !== "available" && price.status !== "stale")) {
    console.warn(
      "Reference prices are unavailable (set PYTH_HERMES_API_KEY for the API); market maker funding skipped.",
    );
    process.exit(0);
  }
  const fund = Bun.spawn(
    [process.execPath, "--no-env-file", "services/market-maker/src/main.ts", "--execute", "--fund"],
    {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
      env: process.env,
    },
  );
  if ((await fund.exited) !== 0) throw new Error("Market maker funding failed");
}
console.info(
  `${markets.length} markets ready. Restart scripts/evm/dev.ts to start the market maker.`,
);
