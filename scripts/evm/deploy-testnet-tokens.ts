/** Testnet only: deploys a dummy copy of every asset with a tier-1 or tier-2 prediction-market
 * pairing (reports/Polymarket and Kalshi market research.md), mints it to MINT_TO and records it
 * in deployments/<chainId>-testnet-tokens.json. Resumable: recorded deployments and mints are
 * kept.
 *
 * - Robinhood Stock Tokens (contracts/test/mocks/TestnetStockToken.sol) copy the mainnet token's
 *   name, symbol, decimals, permit domain, uid, terms and UI multiplier, read live from Robinhood
 *   Chain (MAINNET_RPC_URL) at the address Robinhood's Stock Token API lists.
 * - WETH and cbBTC copy Robinhood Chain's tokens (WETH with permits, as on mainnet).
 * - SOL, XRP and DOGE have no Robinhood Chain token: they carry the native coin's name, symbol
 *   and decimals.
 * Every copy is open mint and has no value; its icon is the asset's logo in the token catalog.
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630 MINT_TO=0x…[,0x…]
 *   [MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com] bun scripts/evm/deploy-testnet-tokens.ts */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const STOCKS = [
  "USO",
  "XOM",
  "PR",
  "CCL",
  "BA",
  "SPY",
  "QQQ",
  "MSTR",
  "COIN",
  "CRCL",
  "GLXY",
  "CLSK",
  "IREN",
  "WULF",
  "BULL",
  "SLV",
  "GLD",
  "SHY",
  "BND",
  "NU",
  "SOFI",
  "NVDA",
  "CRWV",
  "AAPL",
  "SMH",
  "EWT",
  "DJT",
] as const;
/** Robinhood Chain mainnet tokens (docs.robinhood.com/chain/contracts/) and native coins. */
const CRYPTO: readonly {
  symbol: string;
  mint: string;
  permit?: boolean;
  mainnet?: Address;
  native?: { name: string; decimals: number; reference: string };
}[] = [
  {
    symbol: "WETH",
    mint: "50000",
    permit: true,
    mainnet: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  },
  { symbol: "cbBTC", mint: "2000", mainnet: "0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4" },
  {
    symbol: "SOL",
    mint: "1000000",
    native: { name: "Wrapped SOL", decimals: 9, reference: "Solana native mint" },
  },
  {
    symbol: "XRP",
    mint: "100000000",
    native: { name: "XRP", decimals: 6, reference: "XRP Ledger native coin" },
  },
  {
    symbol: "DOGE",
    mint: "1000000000",
    native: { name: "Dogecoin", decimals: 8, reference: "Dogecoin native coin" },
  },
];
const STOCK_MINT = "1000000";
const MAINNET_CHAIN_ID = 4663;
const TESTNETS: Record<number, string> = { 46630: "Robinhood Chain Testnet" };

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const network = TESTNETS[chainId];
if (!network) throw new Error("Dummy tokens copy Robinhood Chain: CHAIN_ID must be 46630");
const rpc = required("RPC_URL");
const mainnetRpc = process.env.MAINNET_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com";
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const recipients = required("MINT_TO")
  .split(",")
  .map((value) => getAddress(value.trim()));

const chain = defineChain({
  id: chainId,
  name: network,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const mainnet = createPublicClient({
  transport: http(mainnetRpc, { batch: { batchSize: 8 }, retryCount: 5 }),
});
const [testnetId, mainnetId] = await Promise.all([client.getChainId(), mainnet.getChainId()]);
if (testnetId !== chainId) throw new Error("RPC_URL serves a different chain than CHAIN_ID");
if (mainnetId !== MAINNET_CHAIN_ID) throw new Error("MAINNET_RPC_URL is not Robinhood Chain");
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function uid() view returns (bytes32)",
  "function terms() view returns (string)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const read = <T>(c: typeof client | typeof mainnet, address: Address, functionName: string) =>
  c.readContract({ address, abi: tokenAbi, functionName } as never) as Promise<T>;

const root = resolve(import.meta.dir, "../..");
const artifact = async (file: string, name: string) => {
  const path = resolve(root, `contracts/out/${file}/${name}.json`);
  if (!(await Bun.file(path).exists()))
    throw new Error("Build the contracts first: forge build --root contracts");
  return (await Bun.file(path).json()) as { abi: unknown[]; bytecode: { object: Hex } };
};
const artifacts = {
  stock: await artifact("TestnetStockToken.sol", "TestnetStockToken"),
  permit: await artifact("TestnetToken.sol", "TestnetPermitToken"),
  plain: await artifact("TestnetToken.sol", "TestnetToken"),
};

interface Planned {
  symbol: string;
  contract: keyof typeof artifacts;
  args: unknown[];
  name: string;
  decimals: number;
  mint: string;
  source: { chainId: number; address: Address } | { reference: string };
  stock?: {
    uid: Hex;
    terms: string;
    multiplier: string;
    newMultiplier: string;
    effectiveAt: string;
  };
}

/** Mainnet identity of each stock, from Robinhood's Stock Token API and the chain itself. */
async function planStocks(): Promise<Planned[]> {
  const response = await fetch("https://api.robinhood.com/rhj/assets");
  if (!response.ok) throw new Error(`Robinhood's Stock Token API returned ${response.status}`);
  const { assets } = (await response.json()) as {
    assets: { tokenSymbol: string; deployments: { contractAddress: string; chainId: number }[] }[];
  };
  return Promise.all(
    STOCKS.map(async (symbol) => {
      const deployment = assets
        .find((asset) => asset.tokenSymbol === symbol)
        ?.deployments.find((d) => d.chainId === MAINNET_CHAIN_ID);
      if (!deployment) throw new Error(`${symbol} has no Robinhood Chain Stock Token`);
      const address = getAddress(deployment.contractAddress);
      const [name, onChainSymbol, decimals, uid, terms, multiplier, newMultiplier, effectiveAt] =
        await Promise.all([
          read<string>(mainnet, address, "name"),
          read<string>(mainnet, address, "symbol"),
          read<number>(mainnet, address, "decimals"),
          read<Hex>(mainnet, address, "uid"),
          read<string>(mainnet, address, "terms"),
          read<bigint>(mainnet, address, "uiMultiplier"),
          read<bigint>(mainnet, address, "newUIMultiplier"),
          read<bigint>(mainnet, address, "effectiveAt"),
        ]);
      if (onChainSymbol !== symbol || decimals !== 18)
        throw new Error(`${symbol}: mainnet token is ${onChainSymbol} with ${decimals} decimals`);
      return {
        symbol,
        contract: "stock" as const,
        args: [name, symbol, uid, terms, multiplier, newMultiplier, effectiveAt],
        name,
        decimals,
        mint: STOCK_MINT,
        source: { chainId: MAINNET_CHAIN_ID, address },
        stock: {
          uid,
          terms,
          multiplier: multiplier.toString(),
          newMultiplier: newMultiplier.toString(),
          effectiveAt: effectiveAt.toString(),
        },
      };
    }),
  );
}

async function planCrypto(): Promise<Planned[]> {
  return Promise.all(
    CRYPTO.map(async ({ symbol, mint, permit, mainnet: address, native }) => {
      const contract = permit ? ("permit" as const) : ("plain" as const);
      if (native)
        return {
          symbol,
          contract,
          args: [native.name, symbol, native.decimals],
          name: native.name,
          decimals: native.decimals,
          mint,
          source: { reference: native.reference },
        };
      if (!address) throw new Error(`${symbol} needs a mainnet token or a native coin`);
      const [name, onChainSymbol, decimals] = await Promise.all([
        read<string>(mainnet, address, "name"),
        read<string>(mainnet, address, "symbol"),
        read<number>(mainnet, address, "decimals"),
      ]);
      if (onChainSymbol !== symbol) throw new Error(`${symbol}: mainnet token is ${onChainSymbol}`);
      return {
        symbol,
        contract,
        args: [name, symbol, decimals],
        name,
        decimals,
        mint,
        source: { chainId: MAINNET_CHAIN_ID, address },
      };
    }),
  );
}

/** Reads the deployed copy back and fails on any difference from the plan. */
async function verify(address: Address, plan: Planned) {
  const [name, symbol, decimals] = await Promise.all([
    read<string>(client, address, "name"),
    read<string>(client, address, "symbol"),
    read<number>(client, address, "decimals"),
  ]);
  if (name !== plan.name || symbol !== plan.symbol || decimals !== plan.decimals)
    throw new Error(`${plan.symbol}: deployed ${name}/${symbol}/${decimals}`);
  if (plan.stock) {
    const [uid, terms, multiplier] = await Promise.all([
      read<Hex>(client, address, "uid"),
      read<string>(client, address, "terms"),
      read<bigint>(client, address, "uiMultiplier"),
    ]);
    const expected =
      BigInt(Math.floor(Date.now() / 1000)) >= BigInt(plan.stock.effectiveAt)
        ? plan.stock.newMultiplier
        : plan.stock.multiplier;
    if (uid !== plan.stock.uid || terms !== plan.stock.terms || multiplier.toString() !== expected)
      throw new Error(`${plan.symbol}: deployed uid/terms/multiplier differ from mainnet`);
  }
}

const recordPath = resolve(root, `deployments/${chainId}-testnet-tokens.json`);
interface TokenRecord {
  address: Address;
  contract: string;
  name: string;
  decimals: number;
  logo: string;
  underlying: string | null;
  source: Planned["source"];
  stock?: Planned["stock"];
  deploymentBlock: string;
  transactionHash: Hex;
  minted: { [recipient: string]: string };
}
const record: {
  chainId: number;
  network: string;
  deployer: Address;
  tokens: Record<string, TokenRecord>;
} = (await Bun.file(recordPath).exists())
  ? await Bun.file(recordPath).json()
  : { chainId, network, deployer: account.address, tokens: {} };
const save = () => Bun.write(recordPath, `${JSON.stringify(record, null, 2)}\n`);
await mkdir(resolve(root, "deployments"), { recursive: true });

const plans = [...(await planStocks()), ...(await planCrypto())];
for (const plan of plans) {
  const catalog = catalogAsset(plan.symbol);
  if (!catalog?.underlying)
    throw new Error(`${plan.symbol} needs a token-catalog entry with an underlying`);
  let entry = record.tokens[plan.symbol];
  if (!entry) {
    const { abi, bytecode } = artifacts[plan.contract];
    const hash = await wallet.deployContract({
      abi,
      bytecode: bytecode.object,
      args: plan.args,
    } as never);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`${plan.symbol} deployment reverted`);
    const address = getAddress(receipt.contractAddress);
    await verify(address, plan);
    entry = {
      address,
      contract:
        plan.contract === "stock"
          ? "TestnetStockToken"
          : plan.contract === "permit"
            ? "TestnetPermitToken"
            : "TestnetToken",
      name: plan.name,
      decimals: plan.decimals,
      logo: catalog.logo,
      underlying: catalog.underlying,
      source: plan.source,
      ...(plan.stock ? { stock: plan.stock } : {}),
      deploymentBlock: receipt.blockNumber.toString(),
      transactionHash: hash,
      minted: {},
    };
    record.tokens[plan.symbol] = entry;
    await save();
    console.info(`${plan.symbol} ${address} (gas ${receipt.gasUsed})`);
  }
  for (const recipient of recipients) {
    if (entry.minted[recipient]) continue;
    const amount = parseUnits(plan.mint, plan.decimals);
    const hash = await wallet.writeContract({
      address: entry.address,
      abi: tokenAbi,
      functionName: "mint",
      args: [recipient, amount],
    });
    if ((await client.waitForTransactionReceipt({ hash })).status !== "success")
      throw new Error(`${plan.symbol} mint to ${recipient} reverted`);
    entry.minted[recipient] = plan.mint;
    await save();
    console.info(`  minted ${plan.mint} ${plan.symbol} to ${recipient}`);
  }
}
console.info(`Recorded ${Object.keys(record.tokens).length} tokens in ${recordPath}`);
