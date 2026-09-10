import { conditionalExchangeAbi, marketRegistryAbi } from "@conditional-stocks/contract-bindings";
import { createPublicClient, erc20Abi, getAddress, type Hex, http, isHex, zeroAddress } from "viem";
import { protocolConfig } from "@/config/protocol";
import type { MarketView } from "@/lib/api/types";
import { assertNoModeSwitch } from "@/lib/demo/navigation";

const client = () =>
  createPublicClient({
    transport: http(protocolConfig.rpcUrl, { timeout: 10_000, retryCount: 1 }),
    batch: { multicall: false },
  });
async function checkedClient() {
  assertNoModeSwitch();
  const rpc = client();
  if ((await rpc.getChainId()) !== protocolConfig.chainId)
    throw new Error("RPC network does not match this deployment.");
  return rpc;
}
/** Verify the local CTF condition and collateral against the deployed registry, not the external evidence mapping. */
export async function readClaimMarket(market: MarketView) {
  const rpc = await checkedClient();
  if (!isHex(market.id, { strict: true }) || market.id.length !== 66)
    throw new Error("Invalid market identifier.");
  const exchange = getAddress(protocolConfig.exchange),
    ctf = getAddress(protocolConfig.conditionalTokens);
  if ([exchange, ctf].includes(zeroAddress)) throw new Error("Contracts are not configured.");
  const registry = await rpc.readContract({
    address: exchange,
    abi: conditionalExchangeAbi,
    functionName: "registry",
  });
  const [canonical, registryCtf, baseDecimals, quoteDecimals] = await Promise.all([
    rpc.readContract({
      address: registry,
      abi: marketRegistryAbi,
      functionName: "getMarket",
      args: [market.id as Hex],
    }),
    rpc.readContract({ address: registry, abi: marketRegistryAbi, functionName: "ctf" }),
    rpc.readContract({
      address: getAddress(market.baseToken),
      abi: erc20Abi,
      functionName: "decimals",
    }),
    rpc.readContract({
      address: getAddress(market.quoteToken),
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  if (
    registryCtf.toLowerCase() !== ctf.toLowerCase() ||
    canonical.baseToken.toLowerCase() !== market.baseToken.toLowerCase() ||
    canonical.quoteToken.toLowerCase() !== market.quoteToken.toLowerCase() ||
    baseDecimals !== market.baseTokenDecimals ||
    quoteDecimals !== market.quoteTokenDecimals
  )
    throw new Error("Indexed collateral metadata differs from the deployed market.");
  return canonical;
}
export async function splitFunding(account: string, token: string, amount: bigint) {
  const rpc = await checkedClient(),
    address = getAddress(token),
    owner = getAddress(account),
    spender = getAddress(protocolConfig.conditionalTokens);
  const [balance, allowance] = await Promise.all([
    rpc.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    rpc.readContract({ address, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
  ]);
  if (balance < amount) throw new Error("Insufficient whole-token balance.");
  return { approved: allowance >= amount, allowance };
}
export async function transactionReceipt(hash: string) {
  if (!isHex(hash, { strict: true }) || hash.length !== 66)
    throw new Error("Invalid transaction hash.");
  return (await checkedClient()).waitForTransactionReceipt({
    hash: hash as Hex,
    timeout: 120_000,
    pollingInterval: 3000,
    confirmations: 1,
  });
}
