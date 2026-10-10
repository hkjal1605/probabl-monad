/** Testnet only: deploys the dummy quote token (USDC) and one dummy token per market asset
 * (contracts/test/mocks/TestnetToken.sol, open mint) and records them in
 * deployments/<chainId>-testnet-tokens.json. Symbols match the shared token catalog, which gives
 * each asset its underlying; the quote token is QUOTE_TOKEN for deploy.ts. Resumable: tokens
 * already recorded are kept.
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=10143 bun scripts/evm/deploy-testnet-tokens.ts */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeCurrency, TESTNET_CHAIN_IDS } from "@conditional-stocks/shared/chains";
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** The quote token, then the Solana testnet's assets, one token each. */
const TOKENS: readonly { symbol: string; decimals: number }[] = [
  { symbol: "USDC", decimals: 6 },
  ...["NVDA", "TSLA", "SPY", "OPENAI", "SPACEX", "KALSHI", "ANTHROPIC", "BTC", "ETH", "SOL"].map(
    (symbol) => ({ symbol, decimals: 18 }),
  ),
];

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
if (!TESTNET_CHAIN_IDS.includes(chainId)) throw new Error("Dummy tokens are for testnets only");
const rpc = required("RPC_URL");
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const chain = defineChain({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: nativeCurrency(chainId),
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== chainId)
  throw new Error("RPC_URL serves a different chain than CHAIN_ID");
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

const root = resolve(import.meta.dir, "../..");
const artifactPath = resolve(root, "contracts/out/TestnetToken.sol/TestnetToken.json");
if (!(await Bun.file(artifactPath).exists()))
  throw new Error("Build the contracts first: forge build --root contracts");
const { abi, bytecode } = (await Bun.file(artifactPath).json()) as {
  abi: unknown[];
  bytecode: { object: Hex };
};
const recordPath = resolve(root, `deployments/${chainId}-testnet-tokens.json`);
type Record = {
  chainId: number;
  deployer: string;
  tokens: { [symbol: string]: { address: string; name: string; decimals: number; block: string } };
};
const record: Record = (await Bun.file(recordPath).exists())
  ? await Bun.file(recordPath).json()
  : { chainId, deployer: account.address, tokens: {} };
await mkdir(resolve(root, "deployments"), { recursive: true });

for (const { symbol, decimals } of TOKENS) {
  if (record.tokens[symbol]) continue;
  const catalog = catalogAsset(symbol);
  if (!catalog) throw new Error(`${symbol} is not in the shared token catalog`);
  const name = `${catalog.name} (testnet)`;
  const hash = await wallet.deployContract({
    abi,
    bytecode: bytecode.object,
    args: [name, symbol, decimals],
  } as never);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`${symbol} deployment reverted`);
  record.tokens[symbol] = {
    address: getAddress(receipt.contractAddress),
    name,
    decimals,
    block: receipt.blockNumber.toString(),
  };
  await Bun.write(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  console.info(`${symbol} ${record.tokens[symbol]!.address} (gas ${receipt.gasUsed})`);
}
console.info(`Recorded ${Object.keys(record.tokens).length} tokens in ${recordPath}`);
