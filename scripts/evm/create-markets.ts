/** Creates the markets planned in deployments/<chainId>-markets.json with the market
 * automation's `createMarkets` (the API's admin evidence flow, signed by the market admin). Each
 * planned event lists the stock tokens it moves; every (event, stock) pair is one market, trading
 * until the event's end. A market's maker and taker fees (whole bps, fixed at creation) come from
 * its own `fees`, else its event's, else the plan's, else none; its maker rebate (bps of the taker
 * fee, up to 5,000) likewise from `makerRebateBps`, set before the market opens and updated on a
 * later run when the plan changes it. Resumable: created markets are written back to the plan.
 *
 *   MARKET_ADMIN_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630 bun scripts/evm/create-markets.ts */
import { resolve } from "node:path";
import {
  Admin,
  createMarkets,
  type Fees,
  type MarketSpec,
} from "@conditional-stocks/market-automation";
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface MarketRecord {
  fees?: Fees;
  /** Maker rebate in bps of the taker fee, as a decimal string (e.g. "2500" = 25%). */
  makerRebateBps?: string;
  /** The rebate this script last set on chain. */
  rebate?: string;
  marketId?: string;
}
interface Plan {
  chainId: number;
  api: string;
  tokens: Record<string, `0x${string}`>;
  fees?: Fees;
  makerRebateBps?: string;
  events: {
    fees?: Fees;
    makerRebateBps?: string;
    gammaMarketId: string;
    slug: string;
    question: string;
    rationale: string;
    markets: Record<string, MarketRecord>;
  }[];
}
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
const { exchange } = (await Bun.file(resolve(root, `deployments/${chainId}.json`)).json()) as {
  exchange: `0x${string}`;
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
const marketAdmin = privateKeyToAccount(required("MARKET_ADMIN_PRIVATE_KEY") as Hex);
if ((await client.getBalance({ address: marketAdmin.address })) === 0n)
  throw new Error(`The market admin ${marketAdmin.address} has no gas`);
const admin = new Admin({
  api: plan.api,
  origin: ORIGIN,
  client,
  wallet: createWalletClient({ chain, transport }),
  exchange,
  marketAdmin,
});
const stocks = new Map<string, `0x${string}`>();
for (const [ticker, token] of Object.entries(plan.tokens)) {
  const symbol = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "symbol",
  });
  if (symbol !== ticker || !catalogUnderlying(symbol))
    throw new Error(`${token} is ${symbol}, not a catalogued ${ticker}`);
  stocks.set(ticker, getAddress(token));
}

const planned = plan.events.flatMap((event) =>
  Object.entries(event.markets).map(([ticker, record]) => {
    const base = stocks.get(ticker);
    if (!base) throw new Error(`${ticker} has no planned token`);
    const rebate = record.makerRebateBps ?? event.makerRebateBps ?? plan.makerRebateBps ?? "0";
    const fees = record.fees ?? event.fees ?? plan.fees;
    const spec: MarketSpec = {
      gammaMarketId: event.gammaMarketId,
      base,
      makerRebateBps: Number(rebate),
      note: `${ticker}: ${event.rationale}`,
      ...(fees ? { fees } : {}),
    };
    return { label: `${ticker} · ${event.question}`, record, rebate, spec };
  }),
);

let failed = 0;
const results = await createMarkets(
  admin,
  planned.filter((p) => !p.record.marketId).map((p) => p.spec),
);
for (const { label, record, rebate, spec } of planned) {
  try {
    const result = results.find((r) => r.spec === spec);
    if (result && "error" in result) throw new Error(result.error);
    if (result) {
      record.marketId = result.marketId;
      record.rebate = rebate;
    } else if (record.marketId && rebate !== (record.rebate ?? "0")) {
      await admin.setMakerRebate(record.marketId, Number(rebate));
      record.rebate = rebate;
    }
    await save();
    console.info(`Market ${record.marketId}: ${label}`);
  } catch (error) {
    failed++;
    console.error(`${label}: ${error instanceof Error ? error.message : error}`);
  }
}
if (failed) {
  console.error(`${failed} market(s) failed; run again to resume.`);
  process.exitCode = 1;
}
