/** Testnet only: deploys the mock USDG quote token (contracts/test/mocks/MockUSDG.sol) where the
 * chain has no USDG with usable liquidity, mints an initial supply to the deployer and records it
 * in deployments/<chainId>-mock-usdg.json. Pass the address as QUOTE_TOKEN to deploy.ts. Anyone
 * can mint more. Stock tokens are the issuer's testnet tokens or the mainnet copies from
 * deploy-testnet-tokens.ts.
 *
 *   DEPLOYER_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630 [MINT=1000000 in whole USDG]
 *   bun scripts/evm/deploy-mock-usdg.ts */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeCurrency } from "@conditional-stocks/shared/chains";
import {
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

const TESTNETS: Record<number, string> = {
  46630: "Robinhood Chain Testnet",
  84532: "Base Sepolia",
};
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const name = TESTNETS[chainId];
if (!name) throw new Error("The mock USDG is for testnets only (46630, 84532)");
const rpc = required("RPC_URL");
const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const supply = parseUnits(process.env.MINT?.trim() || "1000000", 6);

const chain = defineChain({
  id: chainId,
  name,
  nativeCurrency: nativeCurrency(chainId),
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
if ((await client.getChainId()) !== chainId)
  throw new Error("RPC_URL serves a different chain than CHAIN_ID");

const root = resolve(import.meta.dir, "../..");
const artifactPath = resolve(root, "contracts/out/MockUSDG.sol/MockUSDG.json");
if (!(await Bun.file(artifactPath).exists()))
  throw new Error("Build the contracts first: forge build --root contracts");
const { abi, bytecode } = (await Bun.file(artifactPath).json()) as {
  abi: unknown[];
  bytecode: { object: Hex };
};
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const hash = await wallet.deployContract({ abi, bytecode: bytecode.object } as never);
const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error("Deployment reverted");
const token = getAddress(receipt.contractAddress);
const tokenAbi = parseAbi([
  "function mint(address,uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);
const minted = await wallet.writeContract({
  address: token,
  abi: tokenAbi,
  functionName: "mint",
  args: [account.address, supply],
});
if ((await client.waitForTransactionReceipt({ hash: minted })).status !== "success")
  throw new Error("Mint reverted");
const [symbol, decimals, balance] = await Promise.all([
  client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
  client.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }),
  client.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  }),
]);
if (symbol !== "USDG" || decimals !== 6 || balance !== supply)
  throw new Error("The deployed mock USDG differs from what was expected");

await mkdir(resolve(root, "deployments"), { recursive: true });
await Bun.write(
  resolve(root, `deployments/${chainId}-mock-usdg.json`),
  `${JSON.stringify(
    {
      chainId,
      network: name,
      token,
      deploymentBlock: String(receipt.blockNumber),
      transactionHash: hash,
      mintedTo: account.address,
      minted: String(supply),
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
console.info(
  `Mock USDG ${token} at block ${receipt.blockNumber}; minted ${supply / 10n ** 6n} USDG to ${account.address}. Recorded in deployments/${chainId}-mock-usdg.json`,
);
