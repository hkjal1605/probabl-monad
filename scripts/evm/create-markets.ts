/** Creates the markets planned in deployments/<chainId>-markets.json through the API's admin
 * evidence flow, the admin console's path: Polymarket metadata → creation evidence → approval →
 * API transaction preview, checked against a locally built one → signed by the market admin →
 * reconciled (subscribes the Polymarket ingestor) → opened. Each planned event lists the stock
 * tokens it moves; every (event, stock) pair is one market, trading until the event's end.
 * Resumable: progress is written back to the plan file.
 *
 *   MARKET_ADMIN_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630 bun scripts/evm/create-markets.ts */
import { resolve } from "node:path";
import { conditionalStocksAbi, underlyingId } from "@conditional-stocks/evm-client";
import {
  type AdminPreview,
  type AdminTransaction,
  evidenceTransactions,
  lifecycleTransaction,
  type PacketEnvelope,
  preflightAdmin,
} from "@conditional-stocks/evm-client/admin";
import { catalogUnderlying } from "@conditional-stocks/shared/token-catalog";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  fallback,
  getAddress,
  type Hex,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface MarketRecord {
  packetHash?: string;
  marketId?: string;
  transactionHash?: string;
  opened?: true;
}
interface Plan {
  chainId: number;
  api: string;
  tokens: Record<string, `0x${string}`>;
  events: {
    gammaMarketId: string;
    slug: string;
    question: string;
    rationale: string;
    markets: Record<string, MarketRecord>;
  }[];
}
/** Order and exposure limits of every planned market, in raw units of 18-decimal stocks and
 * 6-decimal quote: 0.001-share steps, $0.01 ticks, $1 to $10,000 orders, 1,000 shares per
 * order, $100,000 open per wallet and $1,000,000 per market. */
const LIMITS = {
  baseStep: "1000000000000000",
  priceTickRawX18: "10000",
  minNotional: "1000000",
  maxOrderQuantity: "1000000000000000000000",
  maxOrderNotional: "10000000000",
  maxWalletOpenNotional: "100000000000",
  maxMarketOpenNotional: "1000000000000",
};
/** A Polymarket metadata snapshot recorded by the API. */
type Snapshot = {
  snapshotId: string;
  normalized: { endTime: string; canonicalUrl: string; rules: string };
};
/** The admin console's origin, which the API accepts for wallet sign-in. */
const ORIGIN = "http://localhost:3002";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const root = resolve(import.meta.dir, "../..");
const planPath = resolve(root, `deployments/${chainId}-markets.json`);
const plan = (await Bun.file(planPath).json()) as Plan;
const { exchange, quote } = (await Bun.file(
  resolve(root, `deployments/${chainId}.json`),
).json()) as {
  exchange: `0x${string}`;
  quote: `0x${string}`;
};
if (plan.chainId !== chainId) throw new Error("The plan is for another chain");
const save = () => Bun.write(planPath, `${JSON.stringify(plan, null, 2)}\n`);

const rpcs = required("RPC_URL")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const chain = defineChain({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: rpcs } },
});
const transport = fallback(rpcs.map((url) => http(url)));
const client = createPublicClient({ chain, transport });
if ((await client.getChainId()) !== chainId) throw new Error("RPC_URL serves another chain");
const admin = privateKeyToAccount(required("MARKET_ADMIN_PRIVATE_KEY") as Hex);
const wallet = createWalletClient({ account: admin, chain, transport });
const [marketAdmin, , resolutionAdmin] = await client.readContract({
  address: exchange,
  abi: conditionalStocksAbi,
  functionName: "roles",
});
if (marketAdmin !== admin.address)
  throw new Error(`MARKET_ADMIN_PRIVATE_KEY is not the exchange's market admin ${marketAdmin}`);
if ((await client.getBalance({ address: admin.address })) === 0n)
  throw new Error(`The market admin ${admin.address} has no gas`);
const stocks = new Map<string, { token: `0x${string}`; underlying: Hex }>();
for (const [ticker, token] of Object.entries(plan.tokens)) {
  const symbol = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "symbol",
  });
  const underlying = catalogUnderlying(symbol);
  if (symbol !== ticker || !underlying)
    throw new Error(`${token} is ${symbol}, not a catalogued ${ticker}`);
  stocks.set(ticker, { token: getAddress(token), underlying: underlyingId(underlying) });
}

async function call<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${plan.api}${path}`, {
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
async function send(transaction: AdminTransaction) {
  await preflightAdmin(client, transaction);
  const hash = await wallet.sendTransaction({ to: transaction.to, data: transaction.data });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return hash;
}

const { challengeId, message } = await call<{ challengeId: string; message: string }>(
  "/v1/auth/challenge",
  { address: admin.address, origin: ORIGIN },
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

let failed = 0;
for (const event of plan.events) {
  let snapshot: Snapshot | undefined;
  for (const [ticker, record] of Object.entries(event.markets)) {
    try {
      const stock = stocks.get(ticker);
      if (!stock) throw new Error(`${ticker} has no planned token`);
      const base = stock.token;
      if (!record.marketId && !record.packetHash) {
        snapshot ??= await call<Snapshot>(
          "/v1/admin/polymarket/metadata/fetch",
          { gammaMarketId: event.gammaMarketId },
          token,
        );
        const s = snapshot;
        const now = Math.floor(Date.now() / 1000);
        const end = Math.floor(Date.parse(s.normalized.endTime) / 1000);
        if (end < now + 86_400) throw new Error("The event ends within a day");
        const { envelope } = await call<{ envelope: PacketEnvelope }>(
          "/v1/admin/evidence/creation/prepare",
          {
            metadataSnapshotId: s.snapshotId,
            sourceUrls: [s.normalized.canonicalUrl],
            attachments: [],
            config: {
              baseToken: base,
              quoteToken: quote,
              ...LIMITS,
              tradingOpen: String(now - 60),
              tradingCutoff: String(end),
              metadataUri: s.normalized.canonicalUrl,
              rules: s.normalized.rules,
            },
          },
          token,
        );
        record.packetHash = envelope.packetHash;
        await save();
        await call(
          `/v1/admin/evidence/${record.packetHash}/review`,
          { decision: "approve", checklist, notes: `${ticker}: ${event.rationale}` },
          token,
        );
      }
      if (!record.marketId) {
        const view = await call<{
          envelope: PacketEnvelope;
          observations: { marketId?: string }[];
        }>(`/v1/admin/evidence/${record.packetHash}`, undefined, token);
        // Executed earlier, with only the reconciliation left undone.
        const executed = view.observations.find((o) => o.marketId)?.marketId;
        if (executed) record.marketId = executed;
        else {
          const preview = await call<AdminPreview & { prerequisites: AdminTransaction[] }>(
            `/v1/admin/evidence/${record.packetHash}/transaction`,
            {},
            token,
          );
          // Sign only what this script builds from the approved evidence and the live chain.
          const [count, pool] = await Promise.all([
            client.readContract({
              address: exchange,
              abi: conditionalStocksAbi,
              functionName: "marketCount",
            }),
            client.readContract({
              address: exchange,
              abi: conditionalStocksAbi,
              functionName: "pool",
              args: [base],
            }),
          ]);
          const { transactions } = evidenceTransactions(view.envelope, "create-market", {
            chainId,
            exchange,
            marketAdmin,
            resolutionAdmin,
            nextMarketId: count + 1,
            basePoolListed: () => pool.listed,
            baseUnderlying: () => stock.underlying,
          });
          const remote = [...preview.prerequisites, preview];
          if (
            remote.length !== transactions.length ||
            transactions.some((t, i) => t.data !== remote[i]?.data || t.to !== remote[i]?.to)
          )
            throw new Error("The API preview differs from the locally built transaction");
          let hash: Hex = "0x";
          for (const transaction of transactions) hash = await send(transaction);
          const created = parseEventLogs({
            abi: conditionalStocksAbi,
            logs: (await client.getTransactionReceipt({ hash })).logs,
            eventName: "MarketCreated",
          })[0];
          if (!created) throw new Error("No market was created");
          record.marketId = String(created.args.market);
          record.transactionHash = hash;
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
        await save();
      }
      if (!record.opened) {
        await send(
          lifecycleTransaction({ chainId, exchange }, admin.address, Number(record.marketId), 0),
        );
        record.opened = true;
        await save();
      }
      console.info(`Market ${record.marketId}: ${ticker} · ${event.question}`);
    } catch (error) {
      failed++;
      console.error(
        `${ticker} · ${event.question}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
if (failed) {
  console.error(`${failed} market(s) failed; run again to resume.`);
  process.exitCode = 1;
}
