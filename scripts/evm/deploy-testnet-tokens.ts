/** Testnet only: deploys a copy of every asset the Monad testnet lists, as Monad mainnet has it:
 * the Robinhood testnet's assets (the tier-1 and tier-2 prediction-market pairings of
 * reports/Polymarket and Kalshi market research.md) that have an xStock on Monad, the crypto
 * assets and the quote token. Each copy is minted to MINT_TO and recorded in
 * deployments/<chainId>-testnet-tokens.json. Resumable: recorded deployments and mints are kept.
 *
 * - xStocks (contracts/test/mocks/TestnetXStockToken.sol) copy Backed's mainnet token: name,
 *   symbol, 18 decimals, permit domain, terms, VERSION and multiplier, read live from Monad
 *   (MAINNET_RPC_URL) at the address xStocks lists (https://xstocks.fi/us/products). BULL, SHY,
 *   BND and DJT have no xStock and are left out.
 * - USDC, WETH and cbBTC copy Monad's mainnet tokens (WETH with permits, as on mainnet).
 * - SOL, XRP and DOGE have no Monad token: they carry the native coin's name, symbol and
 *   decimals.
 * Every copy is open mint and has no value; its icon is the asset's logo in the token catalog.
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=https://testnet-rpc.monad.xyz CHAIN_ID=10143 MINT_TO=0x…[,0x…]
 *   [MAINNET_RPC_URL=https://rpc.monad.xyz] bun scripts/evm/deploy-testnet-tokens.ts */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { MONAD_TESTNET, nativeCurrency } from "@conditional-stocks/shared/chains";
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

/** Backed's xStocks on Monad mainnet (xstocks.fi's product list). */
const XSTOCKS: Readonly<Record<string, Address>> = {
  USOx: "0xc9e5a5df9aeb1f36801a90e4179fb785b6566564",
  XOMx: "0xeedb0273c5af792745180e9ff568cd01550ffa13",
  PRx: "0x430bd46defc33d14ef23ae8ae4501871db375959",
  CCLx: "0xa416520fa325b5c3f1ea30fc622a040385c2ff15",
  BAx: "0x5e5e6aa595f5ba2e12d3120810b9fe607735ac8c",
  SPYx: "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48",
  QQQx: "0xa753a7395cae905cd615da0b82a53e0560f250af",
  MSTRx: "0xae2f842ef90c0d5213259ab82639d5bbf649b08e",
  COINx: "0x364f210f430ec2448fc68a49203040f6124096f0",
  CRCLx: "0xfebded1b0986a8ee107f5ab1a1c5a813491deceb",
  GLXYx: "0xf7f4fac56f012de7dd6adff54c761986b9e0655a",
  CLSKx: "0xd0194f0f077968da8ca59811e9407f54ae6c9432",
  IRENx: "0xfbfc1fd14eec970276c8a3bf5e6131cd751cc0b9",
  WULFx: "0xc0c2150cf0870e2d7abc7cde17c20a542fafbb9b",
  SLVx: "0x4833e7f4f0460f4b72a3a5879a6c9841bcc5b58b",
  GLDx: "0x2380f2673c640fb67e2d6b55b44c62f0e0e69da9",
  NUx: "0xef14e2ecba99e303c18759e5b71acfaac91212de",
  SOFIx: "0xcf8e8e4d348502d5ab212ceaaa6062a6de1a53e2",
  NVDAx: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
  CRWVx: "0x16314d1032e6476c9451d1f02ba365a249ff36c7",
  AAPLx: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a",
  SMHx: "0x8d512a03600981b8e86556fd5c0fbdd726fe1821",
  EWTx: "0x81886fe9544987376ef9ed6f85381d879ae927b0",
};
/** Monad mainnet tokens and native coins; the quote token first. */
const OTHERS: readonly {
  symbol: string;
  mint: string;
  permit?: boolean;
  mainnet?: Address;
  native?: { name: string; decimals: number; reference: string };
}[] = [
  { symbol: "USDC", mint: "10000000", mainnet: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" },
  {
    symbol: "WETH",
    mint: "50000",
    permit: true,
    mainnet: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
  },
  { symbol: "cbBTC", mint: "2000", mainnet: "0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b" },
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
const XSTOCK_MINT = "1000000";
const MAINNET_CHAIN_ID = 143;
const TESTNETS: Record<number, string> = { [MONAD_TESTNET]: "Monad Testnet" };

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const network = TESTNETS[chainId];
if (!network) throw new Error("Dummy tokens copy Monad mainnet: CHAIN_ID must be 10143");
const rpc = required("RPC_URL");
const mainnetRpc = process.env.MAINNET_RPC_URL?.trim() || "https://rpc.monad.xyz";
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const recipients = required("MINT_TO")
  .split(",")
  .map((value) => getAddress(value.trim()));

const chain = defineChain({
  id: chainId,
  name: network,
  nativeCurrency: nativeCurrency(chainId),
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const mainnet = createPublicClient({
  transport: http(mainnetRpc, { batch: { batchSize: 8 }, retryCount: 5 }),
});
const [testnetId, mainnetId] = await Promise.all([client.getChainId(), mainnet.getChainId()]);
if (testnetId !== chainId) throw new Error("RPC_URL serves a different chain than CHAIN_ID");
if (mainnetId !== MAINNET_CHAIN_ID) throw new Error("MAINNET_RPC_URL is not Monad mainnet");
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function terms() view returns (string)",
  "function VERSION() view returns (string)",
  "function multiplier() view returns (uint256)",
  "function newMultiplier() view returns (uint256)",
  "function multiplierNonce() view returns (uint256)",
  "function mint(address,uint256)",
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
  xstock: await artifact("TestnetXStockToken.sol", "TestnetXStockToken"),
  permit: await artifact("TestnetToken.sol", "TestnetPermitToken"),
  plain: await artifact("TestnetToken.sol", "TestnetToken"),
};
const CONTRACTS = {
  xstock: "TestnetXStockToken",
  permit: "TestnetPermitToken",
  plain: "TestnetToken",
} as const;

interface Planned {
  symbol: string;
  contract: keyof typeof artifacts;
  args: unknown[];
  name: string;
  decimals: number;
  mint: string;
  source: { chainId: number; address: Address } | { reference: string };
  xstock?: {
    terms: string;
    version: string;
    multiplier: string;
    newMultiplier: string;
    multiplierNonce: string;
  };
}

/** Mainnet identity of each xStock, read from the chain one token every 250 ms (Monad's public
 * RPC allows 50 requests a second). */
async function planXStocks(): Promise<Planned[]> {
  const plans: Planned[] = [];
  for (const [symbol, listed] of Object.entries(XSTOCKS)) {
    if (plans.length) await Bun.sleep(250);
    const address = getAddress(listed);
    const [name, onChainSymbol, decimals, terms, version, multiplier, next, nonce] =
      await Promise.all([
        read<string>(mainnet, address, "name"),
        read<string>(mainnet, address, "symbol"),
        read<number>(mainnet, address, "decimals"),
        read<string>(mainnet, address, "terms"),
        read<string>(mainnet, address, "VERSION"),
        read<bigint>(mainnet, address, "multiplier"),
        read<bigint>(mainnet, address, "newMultiplier"),
        read<bigint>(mainnet, address, "multiplierNonce"),
      ]);
    if (onChainSymbol !== symbol || decimals !== 18)
      throw new Error(`${symbol}: mainnet token is ${onChainSymbol} with ${decimals} decimals`);
    plans.push({
      symbol,
      contract: "xstock",
      args: [name, symbol, terms, version, multiplier, next, nonce],
      name,
      decimals,
      mint: XSTOCK_MINT,
      source: { chainId: MAINNET_CHAIN_ID, address },
      xstock: {
        terms,
        version,
        multiplier: multiplier.toString(),
        newMultiplier: next.toString(),
        multiplierNonce: nonce.toString(),
      },
    });
  }
  return plans;
}

async function planOthers(): Promise<Planned[]> {
  return Promise.all(
    OTHERS.map(async ({ symbol, mint, permit, mainnet: address, native }) => {
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
        source: { chainId: MAINNET_CHAIN_ID, address: getAddress(address) },
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
  if (plan.xstock) {
    const [terms, version, multiplier] = await Promise.all([
      read<string>(client, address, "terms"),
      read<string>(client, address, "VERSION"),
      read<bigint>(client, address, "multiplier"),
    ]);
    if (
      terms !== plan.xstock.terms ||
      version !== plan.xstock.version ||
      multiplier.toString() !== plan.xstock.multiplier
    )
      throw new Error(`${plan.symbol}: deployed terms/version/multiplier differ from mainnet`);
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
  xstock?: Planned["xstock"];
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

const plans = [...(await planOthers()), ...(await planXStocks())];
for (const plan of plans) {
  const catalog = catalogAsset(plan.symbol);
  if (!catalog) throw new Error(`${plan.symbol} needs a token-catalog entry`);
  if (catalog.kind !== "stablecoin" && !catalog.underlying)
    throw new Error(`${plan.symbol} needs a token-catalog underlying`);
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
      contract: CONTRACTS[plan.contract],
      name: plan.name,
      decimals: plan.decimals,
      logo: catalog.logo,
      underlying: catalog.underlying ?? null,
      source: plan.source,
      ...(plan.xstock ? { xstock: plan.xstock } : {}),
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
