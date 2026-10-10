/** Testnet only: rests a ladder of bids and asks on both books (YES and NO) of every market in
 * deployments/<chainId>-markets.json, as the Solana testnet's seeder does. Per book: a mid within
 * ±3% of the asset's spot reference (from the API), a 0.4–1.2% half-spread, each further level
 * 0.2–1.5% out, LEVELS bids and LEVELS asks of $10–100 each, all expiring at the market's cutoff.
 * The randomness is fixed per market and book, so a rerun reproduces the same ladder and places
 * only the orders a book is still missing (counted from the API's public order books).
 *
 * The seeding wallet is a dedicated, non-governance key: it mints the dummy tokens it needs
 * (open mint), deposits them as credit and funds every order from credit ("whole" funding).
 * Monad charges the gas limit, so each transaction's limit is its estimate plus 5%. Stops,
 * resumably, when the wallet's gas balance falls below MIN_GAS (whole native units).
 *
 *   SEED_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=10143 API_URL=https://api-monad.probabl.trade
 *   [LEVELS=10] [MIN_GAS=0.2] bun scripts/evm/seed-orderbooks.ts [--execute] */
import { resolve } from "node:path";
import { conditionalStocksAbi, packOrder, packPlan } from "@conditional-stocks/evm-client";
import { nativeCurrency, TESTNET_CHAIN_IDS } from "@conditional-stocks/shared/chains";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  getAddress,
  type Hex,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
if (!TESTNET_CHAIN_IDS.includes(chainId)) throw new Error("Seeding is for testnets only");
const rpc = required("RPC_URL");
const api = required("API_URL").replace(/\/$/, "");
const execute = process.argv.includes("--execute");
const LEVELS = Number(process.env.LEVELS ?? 10);
const MIN_GAS = parseEther(process.env.MIN_GAS?.trim() || "0.2");
const account = privateKeyToAccount(required("SEED_PRIVATE_KEY") as Hex);
const chain = defineChain({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: nativeCurrency(chainId),
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== chainId) throw new Error("RPC_URL serves another chain");
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

const root = resolve(import.meta.dir, "../..");
const { exchange, quote } = (await Bun.file(
  resolve(root, `deployments/${chainId}.json`),
).json()) as {
  exchange: `0x${string}`;
  quote: `0x${string}`;
};
const plan = (await Bun.file(resolve(root, `deployments/${chainId}-markets.json`)).json()) as {
  tokens: Record<string, `0x${string}`>;
  events: { question: string; markets: Record<string, { marketId?: string; opened?: true }> }[];
};
const markets = plan.events.flatMap((event) =>
  Object.entries(event.markets).flatMap(([ticker, record]) =>
    record.marketId && record.opened
      ? [{ id: Number(record.marketId), ticker, token: getAddress(plan.tokens[ticker]!) }]
      : [],
  ),
);
if (!markets.length) throw new Error("No opened markets in the plan: run create-markets first");

// ------------------------------------------------------------------ deterministic ladders

/** mulberry32, seeded per market and book. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (next: () => number, low: number, high: number) => low + (high - low) * next();
const USD = 10n ** 6n;
const ONE = 10n ** 18n;

interface Rung {
  side: 0 | 1;
  level: number;
  /** Quote raw per base raw x 1e18, a multiple of the market tick. */
  price: bigint;
  /** Base raw, a multiple of the market step. */
  quantity: bigint;
}
/** LEVELS bids and LEVELS asks around `spot` (USD per whole token). */
function ladder(marketId: number, branch: number, spot: number, tick: bigint, step: bigint) {
  const next = random(marketId * 2 + branch + 1);
  const mid = spot * between(next, 0.97, 1.03);
  const half = between(next, 0.004, 0.012);
  const rungs: Rung[] = [];
  for (const side of [0, 1] as const) {
    let offset = half;
    let last: bigint | null = null;
    for (let level = 0; level < LEVELS; level++) {
      if (level) offset += between(next, 0.002, 0.015);
      const usd = mid * (side === 0 ? 1 - offset : 1 + offset);
      // Quote raw (6 decimals) per base raw (18 decimals) x 1e18 = USD x 1e6.
      let ticks = BigInt(Math.round((usd * 1e6) / Number(tick)));
      if (side === 0 && last !== null && ticks * tick >= last) ticks = last / tick - 1n;
      if (side === 1 && last !== null && ticks * tick <= last) ticks = last / tick + 1n;
      if (ticks <= 0n) break;
      const price = ticks * tick;
      last = price;
      const notional = between(next, 10, 100);
      // Whole tokens worth `notional`, down to the step but never under $1 or one step.
      let quantity = (BigInt(Math.floor((notional / usd) * 1e6)) * ONE) / 1_000_000n;
      quantity -= quantity % step;
      while ((quantity * price) / ONE < USD) quantity += step;
      if (quantity === 0n) quantity = step;
      rungs.push({ side, level, price, quantity });
    }
  }
  return rungs;
}

// ------------------------------------------------------------------ chain and API reads

const terms = async (id: number) =>
  (await client.readContract({
    address: exchange,
    abi: conditionalStocksAbi,
    functionName: "terms",
    args: [id],
  })) as unknown as { tick: bigint; step: bigint; cutoff: bigint; open: bigint; state: number };
const book = async (id: number) =>
  (await client.readContract({
    address: exchange,
    abi: conditionalStocksAbi,
    functionName: "book",
    args: [id],
  })) as unknown as { seqYes: number; seqNo: number };
async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${api}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}
/** Open orders this wallet already rests in `marketId`'s books, by branch and side (from the
 * public order book: a wallet's own order list needs its sign-in). */
async function resting(marketId: number) {
  const { orders } = await json<{
    orders: { id: string; maker: string; side: number; status: string }[];
  }>(`/orderbook/${marketId}`);
  const counts = new Map<string, number>();
  for (const o of orders) {
    if (getAddress(o.maker) !== account.address || o.status !== "open") continue;
    const id = `${(BigInt(o.id) >> 32n) & 0xffn}:${o.side}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ------------------------------------------------------------------ transactions

let sent = 0;
let gasSpent = 0n;
async function send(to: `0x${string}`, data: Hex, label: string) {
  const balance = await client.getBalance({ address: account.address });
  if (balance < MIN_GAS)
    throw new Error(
      `Gas balance ${formatEther(balance)} is below MIN_GAS; fund ${account.address} and rerun`,
    );
  const estimate = await client.estimateGas({ account, to, data });
  const hash = await wallet.sendTransaction({ to, data, gas: (estimate * 105n) / 100n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  sent++;
  gasSpent += receipt.gasUsed * receipt.effectiveGasPrice;
  return receipt;
}

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
/** Tops credit in `token` up to `target` raw: mint, approve and deposit what is missing. */
async function fund(token: `0x${string}`, target: bigint, label: string) {
  const credit = (await client.readContract({
    address: exchange,
    abi: conditionalStocksAbi,
    functionName: "credit",
    args: [account.address, token],
  })) as bigint;
  if (credit >= target) return;
  const missing = target - credit;
  console.info(`Funding ${label}: depositing ${missing} raw`);
  if (!execute) return;
  const held = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (held < missing)
    await send(
      token,
      encodeFunctionData({
        abi: mintAbi,
        functionName: "mint",
        args: [account.address, missing - held],
      }),
      `mint ${label}`,
    );
  const allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, exchange],
  });
  if (allowance < missing)
    await send(
      token,
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [exchange, 2n ** 255n] }),
      `approve ${label}`,
    );
  await send(
    exchange,
    encodeFunctionData({
      abi: conditionalStocksAbi,
      functionName: "deposit",
      args: [token, missing],
    }),
    `deposit ${label}`,
  );
}

// ------------------------------------------------------------------ plan and place

const now = BigInt(Math.floor(Date.now() / 1000));
type Work = {
  market: (typeof markets)[number];
  tick: bigint;
  step: bigint;
  cutoff: bigint;
  branch: 0 | 1;
  rungs: Rung[];
};
const work: Work[] = [];
const needQuote = { value: 0n };
const needBase = new Map<string, bigint>();
for (const market of markets) {
  const t = await terms(market.id);
  if (t.state !== 2 || now < t.open || now >= t.cutoff) {
    console.info(`Market ${market.id} (${market.ticker}) is not trading; skipped`);
    continue;
  }
  const spot = await json<{ base: { priceUsd: number | null; status: string } }>(
    `/v1/markets/${market.id}/spot-prices`,
  );
  if (!spot.base.priceUsd) {
    console.info(`Market ${market.id} (${market.ticker}) has no spot reference; skipped`);
    continue;
  }
  const counts = await resting(market.id);
  for (const branch of [0, 1] as const) {
    const all = ladder(market.id, branch, spot.base.priceUsd, t.tick, t.step);
    // Keep the ladder's outermost rungs when a book already holds some of this wallet's orders.
    const rungs = ([0, 1] as const).flatMap((side) => {
      const have = counts.get(`${branch}:${side}`) ?? 0;
      return all.filter((r) => r.side === side).slice(have);
    });
    for (const r of rungs) {
      if (r.side === 0) needQuote.value += (r.quantity * r.price + ONE - 1n) / ONE;
      else needBase.set(market.ticker, (needBase.get(market.ticker) ?? 0n) + r.quantity);
    }
    if (rungs.length)
      work.push({ market, tick: t.tick, step: t.step, cutoff: t.cutoff, branch, rungs });
  }
}
const orders = work.reduce((n, w) => n + w.rungs.length, 0);
console.info(
  `${orders} orders to place on ${work.length} books of ${markets.length} markets as ${account.address}`,
);
if (!execute) {
  console.info("Dry run: pass --execute to fund the wallet's credit and place them.");
  process.exit(0);
}

// 10% headroom over the planned need, so rounding never starves the last rung.
await fund(quote, (needQuote.value * 110n) / 100n, "USDC");
for (const [ticker, quantity] of needBase)
  await fund(plan.tokens[ticker]!, (quantity * 110n) / 100n, ticker);

for (const w of work) {
  let seq = BigInt((await book(w.market.id))[w.branch === 0 ? "seqYes" : "seqNo"]);
  for (const r of w.rungs) {
    const order = {
      maker: account.address,
      marketId: String(w.market.id),
      quantity: r.quantity.toString(),
      limitPriceRawX18: r.price.toString(),
      expiry: w.cutoff.toString(),
      maxFeeBps: 0,
      branch: w.branch,
      side: r.side,
      fundingKind: 0,
      tif: 0,
    };
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 120n;
    const data = encodeFunctionData({
      abi: conditionalStocksAbi,
      functionName: "place",
      args: [
        packOrder(order, w.tick),
        packPlan(seq, deadline < w.cutoff ? deadline : w.cutoff, 0n),
        0n,
      ],
    });
    await send(
      exchange,
      data,
      `market ${w.market.id} ${w.branch ? "NO" : "YES"} ${r.side ? "ask" : "bid"} ${r.level}`,
    );
    seq++;
  }
  console.info(
    `Market ${w.market.id} ${w.market.ticker} ${w.branch ? "NO" : "YES"}: ${w.rungs.length} orders · ${sent} transactions, ${formatEther(gasSpent)} ${chain.nativeCurrency.symbol} so far`,
  );
}
console.info(`Done: ${sent} transactions, ${formatEther(gasSpent)} ${chain.nativeCurrency.symbol}`);
