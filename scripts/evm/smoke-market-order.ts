/** Smoke test of market orders on a deployment, as a member using one-click trading would: signs
 * in (with an invite the first time), funds its exchange account with mock USDG, approves the
 * API's trading delegate, then submits a market buy through the API, which asks the approved RFQ
 * makers (Δ-vaults) for quotes and executes it with the delegate. Prints who filled it.
 *
 *   RPC_URL=… CHAIN_ID=… EXCHANGE_ADDRESS=… API_AUTH_ORIGINS=… TAKER_KEY_PATH=<file with a key>
 *   [INVITE=XXXX-XXXX] [API_URL=http://127.0.0.1:3000]
 *   bun scripts/evm/smoke-market-order.ts <market> <YES|NO> <shares> <worst price>
 * Testnets only: it mints the deployment's mock USDG. */
import {
  approve,
  approveDelegate,
  conditionalStocksAbi,
  DELEGATE_TRADE,
  deposit,
  MAX_FEE_BPS,
} from "@conditional-stocks/evm-client";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  getAddress,
  type Hex,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createOrder } from "../../apps/web/src/lib/trading/order.ts";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
if (![46630, 84532].includes(chainId)) throw new Error("The smoke test runs on testnets only");
const [marketId, branch = "YES", quantity = "1", price] = process.argv.slice(2);
if (!marketId || !price || (branch !== "YES" && branch !== "NO"))
  throw new Error("Usage: smoke-market-order.ts <market> <YES|NO> <shares> <worst price>");
const api = (process.env.API_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
const origin = required("API_AUTH_ORIGINS").split(",")[0]?.trim() ?? "";
const exchange = getAddress(required("EXCHANGE_ADDRESS"));
const rpc = required("RPC_URL").split(",")[0]?.trim() ?? "";
const chain = defineChain({
  id: chainId,
  name: "testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const taker = privateKeyToAccount(
  (await Bun.file(required("TAKER_KEY_PATH")).text()).trim() as Hex,
);
const wallet = createWalletClient({ account: taker, chain, transport: http(rpc) });
const send = async ({ to, data }: { to: Address; data: Hex }) => {
  const hash = await wallet.sendTransaction({ to, data });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return receipt;
};

async function call<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: unknown };
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(json.error ?? response.status)}`);
  return json;
}

// 1. A member session.
const { challengeId, message } = await call<{ challengeId: string; message: string }>(
  "/v1/auth/challenge",
  {
    address: taker.address,
    origin,
    // The signed message names the invite a wallet joins with.
    ...(process.env.INVITE?.trim() ? { invite: process.env.INVITE.trim() } : {}),
  },
);
const { token } = await call<{ token: string }>("/v1/auth/verify", {
  address: taker.address,
  challengeId,
  signature: await taker.signMessage({ message }),
});
console.info(`Signed in as ${taker.address}`);

// 2. Exchange credit: mock USDG, minted, approved and deposited when short.
const quote = (await client.readContract({
  address: exchange,
  abi: conditionalStocksAbi,
  functionName: "quote",
})) as Address;
const market = await call<Record<string, unknown> & { quoteTokenDecimals: number }>(
  `/markets/${marketId}`,
);
const need = parseUnits("1000", market.quoteTokenDecimals);
const credit = (await client.readContract({
  address: exchange,
  abi: conditionalStocksAbi,
  functionName: "credit",
  args: [taker.address, quote],
})) as bigint;
if (credit < need) {
  await send({
    to: quote,
    data: encodeFunctionData({
      abi: parseAbi(["function mint(address to, uint256 amount)"]),
      functionName: "mint",
      args: [taker.address, need],
    }),
  });
  await send(approve(quote, exchange, need));
  await send(deposit(exchange, quote, need));
  console.info("Deposited 1,000 USDG into the exchange account");
}

// 3. One-click trading: the API's delegate, approved on chain (as the Portfolio page does).
type Permission = {
  active: boolean;
  delegate: Address | null;
  grant: { expiresAt: string } | null;
};
let permission = await call<Permission>(
  `/v1/trading/permission?owner=${taker.address}`,
  undefined,
  token,
);
if (!permission.active) {
  if (!permission.delegate) throw new Error("The API has no trading delegate");
  const now = BigInt(Math.floor(Date.now() / 1000));
  await send(
    approveDelegate(
      exchange,
      permission.delegate,
      {
        market: 0,
        expiresAt: now + 7n * 86_400n,
        maxOrderQuote: parseUnits("1000", market.quoteTokenDecimals),
        totalQuote: parseUnits("10000", market.quoteTokenDecimals),
        maxOrderBase: 10n ** 19n,
        totalBase: 10n ** 20n,
        maxFeeBps: MAX_FEE_BPS,
        permissions: DELEGATE_TRADE,
      },
      now,
    ),
  );
  // The API's index trails the chain by a few seconds.
  for (let i = 0; i < 30 && !permission.active; i++) {
    await Bun.sleep(1000);
    permission = await call<Permission>(
      `/v1/trading/permission?owner=${taker.address}`,
      undefined,
      token,
    );
  }
  if (!permission.active || !permission.grant) throw new Error("The grant is not indexed yet");
  console.info(`Approved the trading delegate ${permission.delegate}`);
}

// 4. The market buy: priced and planned by the API, quoted by the RFQ makers, executed by the
// delegate in one transaction.
const order = createOrder({
  ...(market as Record<string, unknown>),
  account: taker.address,
  delegate: permission.delegate ?? undefined,
  delegateExpiresAt: permission.grant?.expiresAt,
  branch,
  cutoff: new Date(Number(market.tradingCutoff) * 1000).toISOString(),
  funding: "whole",
  marketId,
  maxFeeBps: Math.max(Number(market.makerFeeBps), Number(market.takerFeeBps)),
  price,
  quantity,
  side: "buy",
  tif: "ioc",
} as Parameters<typeof createOrder>[0]);
const prepared = await call<{ rfq?: { makers: number } }>("/v1/orders/prepare", { order }, token);
console.info(`Planned; RFQ makers online for it: ${prepared.rfq?.makers ?? 0}`);
const submitted = await call<Record<string, unknown>>(
  "/v1/trading/submit",
  { order, clientId: crypto.randomUUID() },
  token,
);
console.info("Submitted:", JSON.stringify(submitted));
const hash = (submitted.transactionHash ?? submitted.hash) as Hex | undefined;
if (hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({
        abi: conditionalStocksAbi,
        data: log.data,
        topics: log.topics,
      });
      if (/Fill|Quote|Trade/.test(event.eventName))
        console.info(
          event.eventName,
          JSON.stringify(event.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
        );
    } catch {
      // Not an exchange event.
    }
  }
}
