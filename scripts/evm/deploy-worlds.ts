/** Deploys the world contracts (docs/version-2-plan.md §4–6): `EventOracle`, `WorldBooks` on the
 * deployment's stablecoin and a `WorldVault`, and records them in
 * deployments/<chainId>-worlds-deployment.json. The deployer key only pays: every role is an
 * explicit address. The vault admin's and curator's follow-up calls (roles, deposit cap, seed,
 * limits at the research defaults sized to the seed) are printed as payloads for them to sign;
 * on a testnet, `--apply` signs them with VAULT_ADMIN_PRIVATE_KEY and CURATOR_PRIVATE_KEY.
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630
 *   WORLDS_ADMIN=0x… BOOK_ADMIN=0x… GUARDIAN=0x… RESOLUTION_ADMIN=0x…
 *   [MARKET_ADMIN=BOOK_ADMIN] [QUOTE_TOKEN=the exchange's quote]
 *   VAULT_ADMIN=0x… CURATOR=0x… KEEPER=0x… MARKER=0x… VAULT_GUARDIAN=0x… [FEEDS=0x…,0x…]
 *   [VAULT_ADMIN_DELAY_SECONDS=259200] [SEED=1000000 whole tokens] [DEPOSIT_CAP=…]
 *   bun scripts/evm/deploy-worlds.ts [--mainnet] [--apply] */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseTokenAmount } from "@conditional-stocks/domain";
import {
  approve,
  conditionalStocksAbi,
  type Envelope,
  eventOracleAbi,
  type WorldVaultLimits,
  type WorldVaultRisk,
  worldBooksAbi,
  worldVaultAbi,
  worldVaultCalls,
} from "@conditional-stocks/evm-client";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  getAddress,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NETWORKS: Record<number, { name: string; mainnet: boolean }> = {
  31337: { name: "Anvil", mainnet: false },
  8453: { name: "Base", mainnet: true },
  84532: { name: "Base Sepolia", mainnet: false },
  4663: { name: "Robinhood Chain", mainnet: true },
  46630: { name: "Robinhood Chain Testnet", mainnet: false },
  10143: { name: "Monad Testnet", mainnet: false },
};
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const optional = (name: string) => process.env[name]?.trim() || undefined;
const chainId = Number(required("CHAIN_ID"));
const network = NETWORKS[chainId];
if (!network) throw new Error(`Unsupported CHAIN_ID ${chainId}`);
if (network.mainnet && !process.argv.includes("--mainnet"))
  throw new Error(`${network.name} is a mainnet: pass --mainnet explicitly`);
const apply = process.argv.includes("--apply");
if (apply && network.mainnet)
  throw new Error("--apply is for testnets: sign mainnet roles separately");
const root = resolve(import.meta.dir, "../..");

const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const role = (name: string, fallback?: string) =>
  getAddress(optional(name) ?? fallback ?? required(name));
const admin = role("WORLDS_ADMIN"),
  bookAdmin = role("BOOK_ADMIN"),
  guardian = role("GUARDIAN"),
  resolutionAdmin = role("RESOLUTION_ADMIN"),
  marketAdmin = role("MARKET_ADMIN", bookAdmin),
  vaultAdmin = role("VAULT_ADMIN"),
  curator = role("CURATOR"),
  keeper = role("KEEPER"),
  marker = role("MARKER"),
  vaultGuardian = role("VAULT_GUARDIAN");
if (
  network.mainnet &&
  [admin, bookAdmin, guardian, resolutionAdmin, vaultAdmin].includes(account.address)
)
  throw new Error("Mainnet roles must not be the deployer key");
if ([vaultAdmin, curator, marker].includes(keeper))
  throw new Error("The keeper must hold no admin, curator or marker role");
const adminDelay = Number(
  optional("VAULT_ADMIN_DELAY_SECONDS") ?? (network.mainnet ? 3 * 86_400 : 0),
);
if (!Number.isSafeInteger(adminDelay) || adminDelay < 0 || (network.mainnet && adminDelay < 86_400))
  throw new Error("VAULT_ADMIN_DELAY_SECONDS must be at least a day on a mainnet");

const rpc = required("RPC_URL");
const chain = defineChain({
  id: chainId,
  name: network.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== chainId) throw new Error("RPC_URL serves another chain");
const exchange = (await Bun.file(resolve(root, `deployments/${chainId}.json`))
  .json()
  .catch(() => null)) as { exchange?: Address } | null;
const quote = getAddress(
  optional("QUOTE_TOKEN") ??
    (exchange?.exchange
      ? await client.readContract({
          address: exchange.exchange,
          abi: conditionalStocksAbi,
          functionName: "quote",
        })
      : required("QUOTE_TOKEN")),
);
const [symbol, decimals] = await Promise.all([
  client.readContract({ address: quote, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
]);
console.info(
  `Deploying the world contracts on ${network.name} over ${symbol} (${decimals} decimals)`,
);

const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const artifact = async (file: string, name: string) =>
  (await Bun.file(resolve(root, `contracts/out/${file}/${name}.json`))
    .json()
    .catch(() => {
      throw new Error("Build the contracts first: bun run build:contracts");
    })) as { abi: unknown[]; bytecode: { object: Hex } };
async function deploy(file: string, name: string, args: unknown[]) {
  const { abi, bytecode } = await artifact(file, name);
  const hash = await wallet.deployContract({ abi, bytecode: bytecode.object, args } as never);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`${name} deployment reverted`);
  console.info(`${name}: ${receipt.contractAddress} (block ${receipt.blockNumber})`);
  return { address: getAddress(receipt.contractAddress), block: receipt.blockNumber, hash };
}
const oracle = await deploy("EventOracle.sol", "EventOracle", [
  admin,
  marketAdmin,
  guardian,
  resolutionAdmin,
]);
const books = await deploy("WorldBooks.sol", "WorldBooks", [
  quote,
  oracle.address,
  admin,
  bookAdmin,
  guardian,
  resolutionAdmin,
]);
const vault = await deploy("WorldVault.sol", "WorldVault", [
  books.address,
  vaultAdmin,
  adminDelay,
  `Probabl World Vault ${symbol}`,
  `pw${symbol}`,
]);
const [boundOracle, boundQuote, boundBooks, owner] = await Promise.all([
  client.readContract({ address: books.address, abi: worldBooksAbi, functionName: "oracle" }),
  client.readContract({ address: books.address, abi: worldBooksAbi, functionName: "quote" }),
  client.readContract({ address: vault.address, abi: worldVaultAbi, functionName: "BOOKS" }),
  client.readContract({ address: vault.address, abi: worldVaultAbi, functionName: "defaultAdmin" }),
]);
const roles = await client.readContract({
  address: oracle.address,
  abi: eventOracleAbi,
  functionName: "roles",
});
if (
  boundOracle !== oracle.address ||
  boundQuote !== quote ||
  boundBooks !== books.address ||
  owner !== vaultAdmin ||
  roles[0] !== marketAdmin
)
  throw new Error("The deployed contracts differ from their configuration");

const path = resolve(root, `deployments/${chainId}-worlds-deployment.json`);
await mkdir(resolve(root, "deployments"), { recursive: true });
await Bun.write(
  path,
  `${JSON.stringify(
    {
      chainId,
      network: network.name,
      quote,
      oracle: oracle.address,
      books: books.address,
      vaults: [vault.address],
      deploymentBlock: String(oracle.block),
      transactions: { oracle: oracle.hash, books: books.hash, vault: vault.hash },
      roles: {
        admin,
        bookAdmin,
        marketAdmin,
        guardian,
        resolutionAdmin,
        vault: { admin: vaultAdmin, adminDelay, curator, keeper, marker, guardian: vaultGuardian },
      },
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
console.info(`Recorded in ${path}`);

// The vault's follow-up: roles, cap and seed (admin), then limits at the research defaults sized
// to the seed (curator): a book's worst case at 2% of NAV, a leg's at 6%, 10% of NAV of exposure
// a day, the guaranteed value never under half the reference value.
const seed = parseTokenAmount(optional("SEED") ?? "1000000", decimals);
const cap =
  parseTokenAmount(optional("DEPOSIT_CAP") ?? optional("SEED") ?? "1000000", decimals) * 10n;
const calls = worldVaultCalls(vault.address);
const adminCalls: Envelope[] = [
  calls.grantRole("curator", curator),
  calls.grantRole("keeper", keeper),
  calls.grantRole("marker", marker),
  calls.grantRole("guardian", vaultGuardian),
  calls.setDepositCap(cap),
  approve(quote, vault.address, seed),
  calls.seed(seed),
];
const limits: WorldVaultLimits = {
  maxTtl: 30,
  cutoffBuffer: 3_600,
  maxTenor: 35 * 86_400,
  maxLegs: 4,
  maxFeeBps: 200,
  marginBps: 10,
  eventOnly: true,
};
const risk: WorldVaultRisk = {
  maxQuoteSize: seed / 20n,
  maxQuotePrice: seed / 20n,
  maxBookRisk: seed / 50n,
  maxLegRisk: (seed * 6n) / 100n,
  maxLossBps: 5_000,
  maxDailyExposureBps: 1_000,
};
const feeds = (optional("FEEDS") ?? "")
  .split(",")
  .map((f) => f.trim())
  .filter(Boolean)
  .map((f) => getAddress(f));
const curatorCalls: Envelope[] = [
  calls.setLimits(limits),
  calls.setRisk(risk),
  ...feeds.map((f) => calls.setFeed(f, true)),
];
if (apply) {
  const signerOf = (name: string, expected: Address) => {
    const a = privateKeyToAccount(required(name) as Hex);
    if (a.address !== expected) throw new Error(`${name} is not ${expected}`);
    return createWalletClient({ account: a, chain, transport: http(rpc) });
  };
  for (const [signer, list] of [
    [signerOf("VAULT_ADMIN_PRIVATE_KEY", vaultAdmin), adminCalls],
    [signerOf("CURATOR_PRIVATE_KEY", curator), curatorCalls],
  ] as const)
    for (const call of list) {
      const hash = await signer.sendTransaction({ to: call.to, data: call.data, chain } as never);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error(`Follow-up call to ${call.to} reverted (${hash})`);
    }
  console.info("Roles, cap, seed and limits applied.");
} else {
  console.info(`Next, from the vault admin ${vaultAdmin}:`);
  console.info(
    JSON.stringify(
      adminCalls.map((c) => ({ from: vaultAdmin, chainId, ...c })),
      null,
      2,
    ),
  );
  console.info(`Then from the curator ${curator}:`);
  console.info(
    JSON.stringify(
      curatorCalls.map((c) => ({ from: curator, chainId, ...c })),
      null,
      2,
    ),
  );
}
console.info(
  `API: WORLD_BOOKS_ADDRESS=${books.address} WORLD_VAULT_ADDRESSES=${vault.address} WORLD_DEPLOYMENT_BLOCK=${oracle.block}`,
);
