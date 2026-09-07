import {
  manualResolutionControllerAbi,
  marketRegistryAbi,
} from "@conditional-stocks/contract-bindings";
import {
  Branch,
  FundingKind,
  hashOrder,
  hashResolutionCommitment,
  type Order,
  Side,
  TimeInForce,
} from "@conditional-stocks/domain";
import { InMemoryMatcherStore, MatcherCoordinator } from "@conditional-stocks/matcher";
import {
  canonicalParse,
  canonicalStringify,
  type MatcherEventEnvelope,
} from "@conditional-stocks/orderbook";
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  keccak256,
  maxUint256,
  toBytes,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const address = (name: string): Address => getAddress(required(name));
const rpcUrl = required("ROBINHOOD_RPC_URL");
const chainId = Number(required("ROBINHOOD_CHAIN_ID"));
if (chainId !== 31_337) throw new Error("anvil-e2e only runs on chain 31337");
const chain = defineChain({
  id: chainId,
  name: "Anvil",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const mnemonic =
  process.env.ANVIL_MNEMONIC ?? "test test test test test test test test test test test junk";
const accounts = Array.from({ length: 9 }, (_, addressIndex) =>
  mnemonicToAccount(mnemonic, { addressIndex }),
);
const buyer = accounts[6];
const seller = accounts[7];
const secondSeller = accounts[8];
const marketAdmin = accounts[2];
const resolutionAdmin = accounts[5];
if (!buyer || !seller || !secondSeller || !marketAdmin || !resolutionAdmin) {
  throw new Error("Anvil accounts missing");
}
const wallet = (account: typeof buyer) =>
  createWalletClient({ account, chain, transport: http(rpcUrl) });
const exchange = address("EXCHANGE_ADDRESS");
const registry = address("MARKET_REGISTRY_ADDRESS");
const resolutionController = address("RESOLUTION_CONTROLLER_ADDRESS");
const conditionalTokens = address("CONDITIONAL_TOKENS_ADDRESS");
const positionRouter = address("POSITION_ROUTER_ADDRESS");
const quote = address("USDG_ADDRESS");
const stock = address("STOCK_ADDRESS");
const marketId = required("MARKET_ID") as Hex;
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3000";
const indexerUrl = process.env.INDEXER_URL ?? "http://127.0.0.1:42069";
const settlementUrl = process.env.SETTLEMENT_WORKER_URL ?? "http://127.0.0.1:42071";
const internalToken = required("SETTLEMENT_INTERNAL_TOKEN");

const tokenArtifact = (await Bun.file(
  new URL("../../../packages/contracts/out/MockTokens.sol/MockERC20.json", import.meta.url),
).json()) as { abi: Abi };
const ctfAbi = [
  {
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const transact = async (submit: () => Promise<Hex>): Promise<Hex> => {
  const hash = await submit();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return hash;
};

const api = async <T>(
  path: string,
  options: { body?: unknown; idempotencyKey?: string; method?: string; token?: string } = {},
): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      "content-type": "application/json",
    },
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
  });
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
};

const authenticate = async (account: typeof buyer): Promise<string> => {
  const challenge = await api<{ challengeId: string; message: string }>("/v1/auth/challenge", {
    body: { address: account.address },
  });
  const signature = await account.signMessage({ message: challenge.message });
  const verified = await api<{ token: string }>("/v1/auth/verify", {
    body: { address: account.address, challengeId: challenge.challengeId, signature },
  });
  return verified.token;
};

const waitFor = async <T>(label: string, action: () => Promise<T | null>): Promise<T> => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = await action().catch(() => null);
    if (result !== null) return result;
    await Bun.sleep(400);
  }
  throw new Error(`timed out waiting for ${label}`);
};

for (const account of [buyer, seller, secondSeller]) {
  const accountWallet = wallet(account);
  await transact(() =>
    accountWallet.writeContract({
      abi: tokenArtifact.abi,
      address: quote,
      args: [account.address, 10_000n * 10n ** 6n],
      functionName: "mint",
    } as never),
  );
  await transact(() =>
    accountWallet.writeContract({
      abi: tokenArtifact.abi,
      address: stock,
      args: [account.address, 10n * 10n ** 18n],
      functionName: "mint",
    } as never),
  );
  for (const token of [quote, stock]) {
    await transact(() =>
      accountWallet.writeContract({
        abi: tokenArtifact.abi,
        address: token,
        args: [exchange, maxUint256],
        functionName: "approve",
      } as never),
    );
  }
}

const [buyerToken, sellerToken, secondSellerToken] = await Promise.all([
  authenticate(buyer),
  authenticate(seller),
  authenticate(secondSeller),
]);
const market = await publicClient.readContract({
  abi: marketRegistryAbi,
  address: registry,
  args: [marketId],
  functionName: "getMarket",
});
const head = await publicClient.getBlock();
const makeOrder = (
  account: typeof buyer,
  side: Side,
  price: bigint,
  quantity: bigint,
  label: string,
  tif: TimeInForce = TimeInForce.Gtc,
): Order => ({
  branch: Branch.Yes,
  expiry: market.tradingCutoff - 1n,
  fundingKind: FundingKind.WholeCollateral,
  limitPriceRawX18: price,
  maker: getAddress(account.address),
  marketId,
  nonce: head.number,
  quantity,
  recipient: getAddress(account.address),
  salt: keccak256(toBytes(`milestone-11-${label}-${head.hash}`)),
  maxFeeBps: 0,
  side,
  tif,
});
const wire = (order: Order) => ({
  ...order,
  expiry: order.expiry.toString(),
  limitPriceRawX18: order.limitPriceRawX18.toString(),
  nonce: order.nonce.toString(),
  quantity: order.quantity.toString(),
});
const sign = (account: typeof buyer, order: Order) =>
  account.signTypedData({
    domain: { chainId, name: "ConditionalExchange", verifyingContract: exchange, version: "2" },
    message: order,
    primaryType: "Order",
    types: {
      Order: [
        { name: "maker", type: "address" },
        { name: "recipient", type: "address" },
        { name: "marketId", type: "bytes32" },
        { name: "branch", type: "uint8" },
        { name: "side", type: "uint8" },
        { name: "fundingKind", type: "uint8" },
        { name: "quantity", type: "uint128" },
        { name: "limitPriceRawX18", type: "uint128" },
        { name: "tif", type: "uint8" },
        { name: "expiry", type: "uint64" },
        { name: "nonce", type: "uint64" },
        { name: "salt", type: "bytes32" },
      ],
    },
  });
const submitOrder = async (account: typeof buyer, token: string, order: Order, key: string) => {
  const signature = await sign(account, order);
  const preparation = await api<{ fundingReady: boolean; orderHash: Hex }>("/v1/orders/prepare", {
    body: { order: wire(order) },
    token,
  });
  if (!preparation.fundingReady) throw new Error("prepared order is not funded");
  await api("/v1/orders/submit", {
    body: { order: wire(order), signature },
    idempotencyKey: key,
    token,
  });
  await api("/v1/orders/submit", {
    body: { order: wire(order), signature },
    idempotencyKey: key,
    token,
  });
  await waitFor(`canonical order ${preparation.orderHash}`, async () => {
    const result = await api<{ canonical: { status: string } }>(
      `/v1/orders/${preparation.orderHash}`,
      { token },
    );
    return result.canonical.status === "open" ? result : null;
  });
  return { orderHash: preparation.orderHash, signature };
};

const quantity = 10n ** 18n;
const bid = makeOrder(buyer, Side.Buy, 11n * 10n ** 6n, quantity, "bid");
const ask = makeOrder(seller, Side.Sell, 10n * 10n ** 6n, quantity, "ask");
const bidResult = await submitOrder(buyer, buyerToken, bid, "e2e-bid-0001");
const askResult = await submitOrder(seller, sellerToken, ask, "e2e-ask-0001");

const matcherStore = new InMemoryMatcherStore();
const coordinator = new MatcherCoordinator(matcherStore, { ownerId: "anvil-e2e" });
await coordinator.recover();
const proposal = await waitFor("matcher proposal", async () => {
  const response = await fetch(`${indexerUrl}/internal/matcher-events?limit=1000`);
  if (!response.ok) return null;
  const feed = canonicalParse<{ events: MatcherEventEnvelope[] }>(await response.text());
  let found = null;
  for (const envelope of feed.events) {
    const result = await coordinator.ingest(envelope);
    found ??= result.proposals[0] ?? null;
  }
  return found;
});
const enqueueResponse = await fetch(`${settlementUrl}/internal/proposals`, {
  body: canonicalStringify(proposal),
  headers: {
    authorization: `Bearer ${internalToken}`,
    "content-type": "application/vnd.conditional-stocks.canonical+json",
  },
  method: "POST",
});
if (!enqueueResponse.ok) throw new Error(`proposal enqueue failed: ${enqueueResponse.status}`);
await waitFor("settlement confirmation", async () => {
  const response = await fetch(`${settlementUrl}/internal/batches/${proposal.batchId}`, {
    headers: { authorization: `Bearer ${internalToken}` },
  });
  const result = (await response.json()) as { batch: { status: string } };
  return result.batch.status === "confirmed" ? result : null;
});
for (const { hash, token } of [
  { hash: bidResult.orderHash, token: buyerToken },
  { hash: askResult.orderHash, token: sellerToken },
]) {
  await waitFor(`filled order ${hash}`, async () => {
    const result = await api<{ canonical: { status: string } }>(`/v1/orders/${hash}`, { token });
    return result.canonical.status === "filled" ? result : null;
  });
}

const cancelOrder = makeOrder(buyer, Side.Buy, 9n * 10n ** 6n, quantity, "cancel");
const cancelOpened = await submitOrder(buyer, buyerToken, cancelOrder, "e2e-cancel-open-0001");
const cancellation = await api<{ transaction: { data: Hex; to: Address } }>(
  "/v1/orders/cancel/prepare",
  { body: { orderHash: cancelOpened.orderHash }, token: buyerToken },
);
const buyerWallet = wallet(buyer);
const cancelRequest = await buyerWallet.prepareTransactionRequest({
  account: buyer,
  chain,
  data: cancellation.transaction.data,
  to: cancellation.transaction.to,
  value: 0n,
});
const signedCancellation = await buyerWallet.signTransaction(cancelRequest);
await api("/v1/orders/cancel/submit", {
  body: { orderHash: cancelOpened.orderHash, signedTransaction: signedCancellation },
  idempotencyKey: "e2e-cancel-0001",
  token: buyerToken,
});
await waitFor("canonical cancellation", async () => {
  const result = await api<{ canonical: { status: string } }>(
    `/v1/orders/${cancelOpened.orderHash}`,
    { token: buyerToken },
  );
  return result.canonical.status === "cancelled" ? result : null;
});

const askLevelOne = makeOrder(seller, Side.Sell, 10n * 10n ** 6n, quantity, "ioc-ask-1");
const askLevelTwo = makeOrder(secondSeller, Side.Sell, 11n * 10n ** 6n, quantity, "ioc-ask-2");
await submitOrder(seller, sellerToken, askLevelOne, "e2e-ioc-maker-0001");
await submitOrder(secondSeller, secondSellerToken, askLevelTwo, "e2e-ioc-maker-0002");
const ioc = makeOrder(buyer, Side.Buy, 11n * 10n ** 6n, 2n * quantity, "ioc", TimeInForce.Ioc);
const iocSignature = await sign(buyer, ioc);
const iocHash = hashOrder(ioc, { chainId: BigInt(chainId), verifyingContract: exchange });
await api("/v1/orders/submit", {
  body: {
    order: wire(ioc),
    protection: {
      maxNotional: (22n * 10n ** 6n).toString(),
      maxQuantity: ioc.quantity.toString(),
      worstPriceRawX18: ioc.limitPriceRawX18.toString(),
    },
    signature: iocSignature,
  },
  idempotencyKey: "e2e-ioc-taker-0001",
  token: buyerToken,
});
const latestFeed = await waitFor("confirmed IOC makers", async () => {
  const response = await fetch(`${indexerUrl}/internal/matcher-events?limit=1000`);
  if (!response.ok) return null;
  const feed = canonicalParse<{ events: MatcherEventEnvelope[] }>(await response.text());
  const hashes = new Set(
    feed.events
      .filter((event) => event.event.type === "order-opened")
      .map((event) => (event.event.type === "order-opened" ? event.event.orderHash : "")),
  );
  if (
    !hashes.has(hashOrder(askLevelOne, { chainId: 31337n, verifyingContract: exchange })) ||
    !hashes.has(hashOrder(askLevelTwo, { chainId: 31337n, verifyingContract: exchange }))
  )
    return null;
  return feed;
});
const planResponse = await fetch(`${settlementUrl}/internal/ioc-plans`, {
  body: canonicalStringify({
    cursor: latestFeed.events.at(-1)?.cursor,
    fillQuantities: [quantity, quantity],
    intentId: iocHash,
    kind: "ioc",
    makerOrders: [askLevelOne, askLevelTwo],
  }),
  headers: {
    authorization: `Bearer ${internalToken}`,
    "content-type": "application/vnd.conditional-stocks.canonical+json",
  },
  method: "POST",
});
if (!planResponse.ok) throw new Error(`IOC plan failed: ${await planResponse.text()}`);
const iocBatch = (await planResponse.json()) as { batchId: Hex };
await waitFor("IOC settlement", async () => {
  const response = await fetch(`${settlementUrl}/internal/batches/${iocBatch.batchId}`, {
    headers: { authorization: `Bearer ${internalToken}` },
  });
  const result = (await response.json()) as { batch: { status: string } };
  return result.batch.status === "confirmed" ? result : null;
});

const marketWallet = wallet(marketAdmin);
const resolutionWallet = wallet(resolutionAdmin);
await transact(() =>
  marketWallet.writeContract({
    abi: marketRegistryAbi,
    address: registry,
    args: [marketId, keccak256(toBytes("MILESTONE_11_E2E_FREEZE"))],
    functionName: "freezeMarket",
  }),
);
await transact(() =>
  marketWallet.writeContract({
    abi: marketRegistryAbi,
    address: registry,
    args: [
      marketId,
      hashResolutionCommitment({
        chainId: BigInt(chainId),
        controller: resolutionController,
        marketId,
        yesPayout: 1n,
        noPayout: 0n,
        payoutDenominator: 1n,
        evidenceHash: keccak256(toBytes("MILESTONE_11_MANUAL_YES")),
        evidenceUri: "ipfs://milestone-11-e2e-evidence",
      }),
    ],
    functionName: "beginResolution",
  }),
);
await transact(() =>
  resolutionWallet.writeContract({
    abi: manualResolutionControllerAbi,
    address: resolutionController,
    args: [
      marketId,
      1n,
      0n,
      1n,
      keccak256(toBytes("MILESTONE_11_MANUAL_YES")),
      "ipfs://milestone-11-e2e-evidence",
    ],
    functionName: "resolveMarket",
  }),
);
await waitFor("redeemable market", async () => {
  const response = await fetch(`${indexerUrl}/markets/${marketId}`);
  if (!response.ok) return null;
  const indexed = (await response.json()) as { state: number };
  return indexed.state === 6 ? indexed : null;
});
await transact(() =>
  buyerWallet.writeContract({
    abi: ctfAbi,
    address: conditionalTokens,
    args: [positionRouter, true],
    functionName: "setApprovalForAll",
  }),
);
const redeemAmount = 3n * quantity;
const redemption = {
  amounts: [redeemAmount.toString()],
  collateral: "base",
  indexSets: ["1"],
  marketId,
  recipient: buyer.address,
};
const redemptionPrepared = await api<{ transaction: { data: Hex; to: Address } }>(
  "/v1/positions/redeem/prepare",
  { body: redemption, token: buyerToken },
);
const redeemRequest = await buyerWallet.prepareTransactionRequest({
  account: buyer,
  chain,
  data: redemptionPrepared.transaction.data,
  to: redemptionPrepared.transaction.to,
  value: 0n,
});
const signedRedemption = await buyerWallet.signTransaction(redeemRequest);
const redemptionSubmitted = await api<{ operation: { operationId: string } }>(
  "/v1/positions/redeem/submit",
  {
    body: { ...redemption, signedTransaction: signedRedemption },
    idempotencyKey: "e2e-redeem-0001",
    token: buyerToken,
  },
);
await waitFor("canonical redemption", async () => {
  const result = await api<{ operation: { state: string } }>(
    `/v1/operations/${redemptionSubmitted.operation.operationId}`,
    { token: buyerToken },
  );
  return result.operation.state === "canonical" ? result : null;
});

process.stdout.write(
  `${JSON.stringify(
    {
      cancellation: "canonical",
      duplicateSubmissions: "idempotent",
      gtcBatch: proposal.batchId,
      iocBatch: iocBatch.batchId,
      marketId,
      redemption: "canonical",
      result: "milestone-11-anvil-e2e-passed",
    },
    null,
    2,
  )}\n`,
);
