import { conditionalExchangeAbi, marketRegistryAbi } from "@conditional-stocks/contract-bindings";
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  getAddress,
  hashTypedData,
  http,
  isHex,
  keccak256,
  maxUint256,
  toBytes,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const address = (name: string): Address => getAddress(required(name));
const rpcUrl = required("ROBINHOOD_RPC_URL").split(",")[0];
if (!rpcUrl) throw new Error("ROBINHOOD_RPC_URL must contain an HTTP URL");
const chainId = Number(required("ROBINHOOD_CHAIN_ID"));
if (chainId !== 31_337)
  throw new Error(`seed script only supports Anvil chain 31337, got ${chainId}`);
const marketId = required("MARKET_ID");
if (!isHex(marketId) || marketId.length !== 66) throw new Error("MARKET_ID must be bytes32");

const mnemonic =
  process.env.ANVIL_MNEMONIC ?? "test test test test test test test test test test test junk";
const accounts = Array.from({ length: 4 }, (_, addressIndex) =>
  mnemonicToAccount(mnemonic, { addressIndex }),
);
const buyer = accounts[0];
const seller = accounts[1];
const matcher = accounts[3];
if (!buyer || !seller || !matcher) throw new Error("could not derive Anvil accounts");

const publicClient = createPublicClient({ transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== chainId) throw new Error("connected to the wrong chain");
const wallet = (account: typeof buyer) => createWalletClient({ account, transport: http(rpcUrl) });
const buyerWallet = wallet(buyer);
const sellerWallet = wallet(seller);
const matcherWallet = wallet(matcher);
const exchange = address("EXCHANGE_ADDRESS");
const registry = address("MARKET_REGISTRY_ADDRESS");
const stock = address("STOCK_ADDRESS");
const quote = address("USDG_ADDRESS");

const tokenArtifact = (await Bun.file(
  new URL("../../../packages/contracts/out/MockTokens.sol/MockERC20.json", import.meta.url),
).json()) as { abi: Abi };

const transact = async (label: string, submit: () => Promise<`0x${string}`>): Promise<void> => {
  const hash = await submit();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
};

const quantity = 2n * 10n ** 18n;
const fillQuantity = 10n ** 18n;
const bidPrice = 10n * 10n ** 6n;
const askPrice = 9n * 10n ** 6n;
await transact("mint buyer quote", () =>
  buyerWallet.writeContract({
    abi: tokenArtifact.abi,
    address: quote,
    args: [buyer.address, (quantity * bidPrice) / 10n ** 18n],
    functionName: "mint",
  } as never),
);
await transact("mint seller stock", () =>
  sellerWallet.writeContract({
    abi: tokenArtifact.abi,
    address: stock,
    args: [seller.address, quantity],
    functionName: "mint",
  } as never),
);
await transact("approve buyer quote", () =>
  buyerWallet.writeContract({
    abi: tokenArtifact.abi,
    address: quote,
    args: [exchange, maxUint256],
    functionName: "approve",
  } as never),
);
await transact("approve seller stock", () =>
  sellerWallet.writeContract({
    abi: tokenArtifact.abi,
    address: stock,
    args: [exchange, maxUint256],
    functionName: "approve",
  } as never),
);

const market = (await publicClient.readContract({
  abi: marketRegistryAbi,
  address: registry,
  args: [marketId],
  functionName: "getMarket",
})) as { tradingCutoff: bigint };
const head = await publicClient.getBlock();
if (head.timestamp >= market.tradingCutoff - 1n) throw new Error("seed market has expired");

const orderTypes = {
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
} as const;
const domain = {
  chainId,
  name: "ConditionalExchange",
  verifyingContract: exchange,
  version: "2",
} as const;
const common = {
  branch: 0,
  expiry: market.tradingCutoff - 1n,
  fundingKind: 0,
  marketId,
  nonce: head.number,
  quantity,
  tif: 0,
} as const;
const bid = {
  ...common,
  limitPriceRawX18: bidPrice,
  maker: buyer.address,
  recipient: buyer.address,
  salt: keccak256(toBytes(`anvil-indexer-bid-${head.hash}`)),
  maxFeeBps: 0,
  side: 0,
} as const;
const ask = {
  ...common,
  limitPriceRawX18: askPrice,
  maker: seller.address,
  recipient: seller.address,
  salt: keccak256(toBytes(`anvil-indexer-ask-${head.hash}`)),
  maxFeeBps: 0,
  side: 1,
} as const;
const typedData = (message: typeof bid | typeof ask) => ({
  domain,
  message,
  primaryType: "Order" as const,
  types: orderTypes,
});
const [bidSignature, askSignature] = await Promise.all([
  buyer.signTypedData(typedData(bid)),
  seller.signTypedData(typedData(ask)),
]);
const [bidHash, askHash] = await Promise.all([
  publicClient.readContract({
    abi: conditionalExchangeAbi,
    address: exchange,
    args: [bid],
    functionName: "hashOrder",
  } as never),
  publicClient.readContract({
    abi: conditionalExchangeAbi,
    address: exchange,
    args: [ask],
    functionName: "hashOrder",
  } as never),
]);
if (bidHash !== hashTypedData(typedData(bid)) || askHash !== hashTypedData(typedData(ask))) {
  throw new Error("local EIP-712 hashes do not match the exchange");
}

await transact("open bid", () =>
  buyerWallet.writeContract({
    abi: conditionalExchangeAbi,
    address: exchange,
    args: [bid, bidSignature],
    functionName: "openOrder",
  } as never),
);
await transact("open ask", () =>
  sellerWallet.writeContract({
    abi: conditionalExchangeAbi,
    address: exchange,
    args: [ask, askSignature],
    functionName: "openOrder",
  } as never),
);
await transact("partially match orders", () =>
  matcherWallet.writeContract({
    abi: conditionalExchangeAbi,
    address: exchange,
    args: [bid, ask, fillQuantity],
    functionName: "matchOrders",
  } as never),
);

process.stdout.write(
  `${JSON.stringify(
    {
      askHash,
      bidHash,
      buyer: getAddress(buyer.address),
      fillQuantity: fillQuantity.toString(),
      marketId,
      seller: getAddress(seller.address),
    },
    null,
    2,
  )}\n`,
);
