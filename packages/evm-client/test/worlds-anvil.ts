/** The world contracts on a disposable anvil node, for integration tests: USDG, the oracle, the
 * books, a world vault and an 8-decimal NVDA feed. Accounts: 0 every admin role (and the vault's
 * admin, curator and guardian), 1 Alice, 2 Bob (a vault depositor), 3 a wallet maker, 4 the
 * vault's keeper, 5 its marker, 6 a trading delegate. */
import {
  type Address,
  encodeAbiParameters,
  type Hex,
  keccak256,
  parseAbi,
  stringToBytes,
} from "viem";
import {
  approve,
  type BookDef,
  contractQuoteNonce,
  eventOracleCalls,
  eventResolutionHash,
  outcomeMask,
  packMakerData,
  reasonOf,
  underlyingId,
  WORLD_QUOTE_TYPES,
  type WorldQuote,
  type WorldVaultLimits,
  type WorldVaultRisk,
  worldBooksCalls,
  worldQuoteDomain,
  worldQuoteMessage,
  worldVaultCalls,
} from "../src/index.ts";
import { type Anvil, accounts, send, tokenAbi } from "./anvil.ts";

export const priceFeedAbi = parseAbi([
  "function update(uint80 roundId, int256 answer, uint256 updatedAt)",
  "function latestRound() view returns (uint80)",
]);
export const T0 = 1_800_000_000;
export const CONDITIONS = ["trade deal", "S-1", "GPU order", "rate cut"].map((name) =>
  keccak256(stringToBytes(`condition ${name}`)),
);
/** Event keys of the conditions, YES on index set 1. */
export const KEYS = CONDITIONS.map((c) =>
  keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }, { type: "uint8" }], [c, 1, 2]),
  ),
);
export const STRIKES = [220n, 230n, 240n, 250n, 260n].map((p) => p * 10n ** 8n);
export const URI = "https://api.example/v2/books/meta/maya";

export const limits = (): WorldVaultLimits => ({
  maxTtl: 300,
  cutoffBuffer: 3_600,
  maxTenor: 60 * 86_400,
  maxLegs: 4,
  maxFeeBps: 200,
  marginBps: 10,
  eventOnly: true,
});
export const risk = (): WorldVaultRisk => ({
  maxQuoteSize: 100_000_000_000n,
  maxQuotePrice: 100_000_000_000n,
  maxBookRisk: 200_000_000_000n,
  maxLegRisk: 300_000_000_000n,
  maxLossBps: 5_000,
  maxDailyExposureBps: 2_000,
});

export async function deployWorlds(node: Anvil, now: number) {
  const admin = accounts[0]!.address;
  const deploymentBlock = (await node.client.getBlockNumber()) + 1n;
  const usdg = await node.deploy(0, "Base.t.sol", "MockToken", ["USDG", 6]);
  const feed = await node.deploy(0, "MockPriceFeed.sol", "MockPriceFeed", [
    8,
    "NVDA / USD",
    1,
    209n * 10n ** 8n,
    now - 60,
  ]);
  const oracle = await node.deploy(0, "EventOracle.sol", "EventOracle", [
    admin,
    admin,
    admin,
    admin,
  ]);
  const books = await node.deploy(0, "WorldBooks.sol", "WorldBooks", [
    usdg,
    oracle,
    admin,
    admin,
    admin,
    admin,
  ]);
  const vault = await node.deploy(0, "WorldVault.sol", "WorldVault", [
    books,
    admin,
    0,
    "World Vault",
    "wUSDG",
  ]);
  const w = worldBooksCalls(books),
    v = worldVaultCalls(vault),
    o = eventOracleCalls(oracle);
  const mint = (to: Address, amount: bigint) =>
    node
      .wallet(0)
      .writeContract({ address: usdg, abi: tokenAbi, functionName: "mint", args: [to, amount] });
  // Users hold credit on the books; the vault is seeded with 1,000,000 USDG.
  for (const i of [1, 2, 3, 6]) {
    await mint(accounts[i]!.address, 1_000_000_000_000n);
    await send(node, i, approve(usdg, books, 2n ** 255n));
    await send(node, i, w.deposit(500_000_000_000n));
  }
  await mint(admin, 2_000_000_000_000n);
  await mint(accounts[2]!.address, 1_000_000_000_000n);
  await send(node, 0, approve(usdg, vault, 2n ** 255n));
  await send(node, 2, approve(usdg, vault, 2n ** 255n));
  for (const [role, i] of [
    ["curator", 0],
    ["guardian", 0],
    ["keeper", 4],
    ["marker", 5],
    ["depositor", 2],
  ] as const)
    await send(node, 0, v.grantRole(role, accounts[i]!.address));
  await send(node, 0, v.setDepositCap(10_000_000_000_000n));
  await send(node, 0, v.seed(1_000_000_000_000n));
  await send(node, 0, v.setLimits(limits()));
  await send(node, 0, v.setRisk(risk()));
  await send(node, 0, v.setFeed(feed, true));
  return { usdg, feed, oracle, books, vault, deploymentBlock, w, v, o, admin };
}
export type Worlds = Awaited<ReturnType<typeof deployWorlds>>;

/** Maya's book: three legs, NVDA fixed in 28 days at five strikes, a 1% fee. */
export const pricedDef = (worlds: Worlds, now: number): BookDef => ({
  legs: KEYS.slice(0, 3).map((eventKey) => ({ eventKey, wantYes: true })),
  feed: worlds.feed,
  underlying: underlyingId("US:NVDA"),
  fixingTime: now + 28 * 86_400,
  maxStaleness: 3_600,
  strikes: STRIKES,
  cutoff: now + 27 * 86_400,
  feeBps: 100,
  metadataHash: keccak256(stringToBytes(URI)),
});
/** One leg, no feed: pays if the rate cut happens. */
export const eventDef = (now: number): BookDef => ({
  legs: [{ eventKey: KEYS[3]!, wantYes: true }],
  feed: "0x0000000000000000000000000000000000000000",
  underlying: "0x0000000000000000000000000000000000000000000000000000000000000000",
  fixingTime: 0,
  maxStaleness: 0,
  strikes: [],
  cutoff: now + 10 * 86_400,
  feeBps: 50,
  metadataHash: keccak256(stringToBytes(URI)),
});

let walletNonce = 0n,
  vaultNonce = 0n;
/** A quote signed by wallet maker `index` (its own nonce space). */
export async function walletQuote(
  node: Anvil,
  worlds: Worlds,
  index: number,
  q: Omit<WorldQuote, "nonce" | "makerData">,
) {
  const quote: WorldQuote = { ...q, makerData: 0n, nonce: ++walletNonce };
  const signature = await accounts[index]!.signTypedData({
    domain: worldQuoteDomain(node.chain.id, worlds.books),
    types: WORLD_QUOTE_TYPES,
    primaryType: "WorldQuote",
    message: worldQuoteMessage(quote),
  });
  return { quote, signature };
}
/** A vault quote signed by its keeper (account 4) at `signedAt`, for quote epoch `epoch`. */
export async function vaultQuote(
  node: Anvil,
  worlds: Worlds,
  q: Omit<WorldQuote, "nonce" | "makerData">,
  signedAt: bigint,
  epoch = 0n,
) {
  const quote: WorldQuote = {
    ...q,
    makerData: packMakerData(epoch, signedAt),
    nonce: contractQuoteNonce(worlds.vault, ++vaultNonce),
  };
  const signature = await accounts[4]!.signTypedData({
    domain: worldQuoteDomain(node.chain.id, worlds.books),
    types: WORLD_QUOTE_TYPES,
    primaryType: "WorldQuote",
    message: worldQuoteMessage(quote),
  });
  return { quote, signature };
}

/** Freezes, commits and resolves `key` as account 0 (every oracle role). */
export async function resolveEvent(node: Anvil, worlds: Worlds, key: Hex, outcome: number) {
  const evidence = keccak256(stringToBytes(`evidence ${key} ${outcome}`));
  const uri = "https://api.example/evidence";
  await send(node, 0, worlds.o.freeze(key, reasonOf("result known")));
  await send(
    node,
    0,
    worlds.o.commit(
      key,
      eventResolutionHash(node.chain.id, worlds.oracle, key, outcome, evidence, uri),
    ),
  );
  await send(node, 0, worlds.o.resolve(key, outcome, evidence, uri));
}

/** Moves anvil's clock to `timestamp` and mines a block there. */
export async function warp(node: Anvil, timestamp: number) {
  await node.client.setNextBlockTimestamp({ timestamp: BigInt(timestamp) });
  await node.client.mine({ blocks: 1 });
}

export { outcomeMask };
