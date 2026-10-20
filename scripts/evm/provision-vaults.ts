/** Testnet only: deploys and provisions the Δ-vaults planned in
 * deployments/<chainId>-vault-plan.json, end to end and resumably (progress is written back).
 * For each planned stock:
 * - the admin (the exchange's market admin) lists the stock's pool when no market has yet, with
 *   its underlying from the token catalog: a vault needs its base's pool;
 * - the vault is deployed (the deployer key pays) over the stock's price feed;
 * - the vault admin, also its curator (MARKET_ADMIN_PRIVATE_KEY), grants the curator, guardian
 *   and keeper roles, sets the deposit caps and order limits and registers any planned market
 *   (market automation's curate-vaults job registers new ones);
 * - the admin makes the seed deposit, which sets the vault's quote/stock ratio, and the deployer
 *   then deposits in kind when the plan says so. The admin's own tokens fund its seed, topped up
 *   from the deployer's when short; mock USDG is minted.
 *
 *   DEPLOYER_PRIVATE_KEY=… MARKET_ADMIN_PRIVATE_KEY=… RPC_URL=… CHAIN_ID=46630
 *   bun scripts/evm/provision-vaults.ts */
import { resolve } from "node:path";
import {
  approve,
  conditionalStocksAbi,
  DELTA_VAULT_ROLES,
  type DeltaVaultLimits,
  type DeltaVaultRisk,
  deltaVaultAbi,
  deltaVaultAddMarket,
  deltaVaultDeposit,
  deltaVaultGrantRole,
  deltaVaultSetCaps,
  deltaVaultSetLimits,
  listPool,
  underlyingId,
} from "@conditional-stocks/evm-client";
import { catalogUnderlying } from "@conditional-stocks/shared/token-catalog";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  fallback,
  getAddress,
  type Hex,
  http,
  parseAbi,
  parseUnits,
  zeroAddress,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";

const TESTNETS: Record<number, string> = {
  46630: "Robinhood Chain Testnet",
  84532: "Base Sepolia",
};
interface PlannedVault {
  symbol: string;
  token: Address;
  priceFeed: Address;
  keeper: Address;
  /** Deposit caps, whole tokens. */
  caps: { quote: string; base: string };
  /** The admin's first deposit and, optionally, the deployer's, whole tokens. */
  seed: { quote: string; base: string };
  deposit?: { quote: string; base: string };
  markets?: { market: number; risk: Record<keyof DeltaVaultRisk, string | number> }[];
  // Progress.
  vault?: Address;
  deploymentBlock?: string;
  transactionHash?: string;
  seeded?: true;
  deposited?: true;
}
interface Plan {
  chainId: number;
  exchange: Address;
  quote: Address;
  admin: Address;
  guardian: Address;
  adminDelay: number;
  limits: DeltaVaultLimits;
  vaults: PlannedVault[];
}
const mockUsdg = parseAbi(["function mint(address to, uint256 amount)"]);
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const chainId = Number(required("CHAIN_ID"));
const name = TESTNETS[chainId];
if (!name) throw new Error("Vault provisioning is for testnets only (46630, 84532)");
const root = resolve(import.meta.dir, "../..");
const planPath = resolve(root, `deployments/${chainId}-vault-plan.json`);
const plan = (await Bun.file(planPath).json()) as Plan;
const save = () => Bun.write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
if (plan.chainId !== chainId) throw new Error("The plan is for another chain");

const rpcs = required("RPC_URL")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const chain = defineChain({
  id: chainId,
  name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: rpcs } },
});
const transport = fallback(rpcs.map((url) => http(url)));
const client = createPublicClient({ chain, transport });
if ((await client.getChainId()) !== chainId) throw new Error("RPC_URL serves another chain");
const deployer = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as Hex);
const admin = privateKeyToAccount(required("MARKET_ADMIN_PRIVATE_KEY") as Hex);
if (admin.address !== getAddress(plan.admin))
  throw new Error("MARKET_ADMIN_PRIVATE_KEY is not the planned vault admin");
if (deployer.address === admin.address) throw new Error("The deployer must not be the admin");

async function send(account: PrivateKeyAccount, to: Address, data: Hex) {
  const wallet = createWalletClient({ account, chain, transport });
  const hash = await wallet.sendTransaction({ to, data });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 250 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return receipt;
}
const read = <T>(address: Address, functionName: string, args: readonly unknown[] = []) =>
  client.readContract({ address, abi: deltaVaultAbi, functionName, args } as never) as Promise<T>;
const [quoteDecimals, artifact] = await Promise.all([
  client.readContract({ address: plan.quote, abi: erc20Abi, functionName: "decimals" }),
  Bun.file(resolve(root, "contracts/out/DeltaVault.sol/DeltaVault.json"))
    .json()
    .catch(() => {
      throw new Error("Build the contracts first: bun run build:contracts");
    }) as Promise<{ abi: unknown[]; bytecode: { object: Hex } }>,
]);

for (const v of plan.vaults) {
  const symbol = await client.readContract({
    address: v.token,
    abi: erc20Abi,
    functionName: "symbol",
  });
  if (symbol !== v.symbol) throw new Error(`${v.token} is ${symbol}, not ${v.symbol}`);
  const baseDecimals = await client.readContract({
    address: v.token,
    abi: erc20Abi,
    functionName: "decimals",
  });
  const quoteUnits = (value: string) => parseUnits(value, quoteDecimals);
  const baseUnits = (value: string) => parseUnits(value, baseDecimals);

  const pool = (await client.readContract({
    address: plan.exchange,
    abi: conditionalStocksAbi,
    functionName: "pool",
    args: [v.token],
  })) as { listed: boolean };
  if (!pool.listed) {
    const underlying = catalogUnderlying(symbol);
    if (!underlying) throw new Error(`${v.symbol} has no underlying in the token catalog`);
    const call = listPool(plan.exchange, v.token, underlyingId(underlying));
    await send(admin, call.to, call.data);
    console.info(`${v.symbol}: pool listed as ${underlying}`);
  }
  if (!v.vault) {
    const wallet = createWalletClient({ account: deployer, chain, transport });
    const hash = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [
        {
          exchange: plan.exchange,
          base: v.token,
          priceFeed: v.priceFeed,
          sequencerFeed: zeroAddress,
          admin: plan.admin,
          adminDelay: plan.adminDelay,
          name: `Probabl Δ-Vault ${v.symbol}`,
          symbol: `dv${v.symbol}`,
        },
      ],
    } as never);
    const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 250 });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`The ${v.symbol} vault deployment reverted`);
    v.vault = getAddress(receipt.contractAddress);
    v.deploymentBlock = String(receipt.blockNumber);
    v.transactionHash = hash;
    await save();
    console.info(`${v.symbol}: vault ${v.vault} at block ${receipt.blockNumber}`);
  }
  const vault = v.vault;

  // Roles: the admin also curates; the guardian and the keeper are separate wallets.
  for (const [role, to] of [
    ["curator", plan.admin],
    ["guardian", plan.guardian],
    ["keeper", v.keeper],
  ] as const) {
    if (!(await read<boolean>(vault, "hasRole", [DELTA_VAULT_ROLES[role], to]))) {
      const call = deltaVaultGrantRole(vault, role, to);
      await send(admin, call.to, call.data);
    }
  }
  const [capQuote, capBase] = await read<readonly [bigint, bigint]>(vault, "caps");
  if (capQuote !== quoteUnits(v.caps.quote) || capBase !== baseUnits(v.caps.base)) {
    const call = deltaVaultSetCaps(vault, quoteUnits(v.caps.quote), baseUnits(v.caps.base));
    await send(admin, call.to, call.data);
  }
  const limits = await read<DeltaVaultLimits>(vault, "limits");
  if (
    limits.maxTtl !== plan.limits.maxTtl ||
    limits.maxOracleAge !== plan.limits.maxOracleAge ||
    limits.maxFeeBps !== plan.limits.maxFeeBps
  ) {
    const call = deltaVaultSetLimits(vault, plan.limits);
    await send(admin, call.to, call.data);
  }
  const listed = await read<readonly number[]>(vault, "markets");
  for (const m of v.markets ?? []) {
    if (listed.includes(m.market)) continue;
    const call = deltaVaultAddMarket(vault, m.market, {
      bandBps: Number(m.risk.bandBps),
      cutoffBuffer: Number(m.risk.cutoffBuffer),
      maxOrder: quoteUnits(String(m.risk.maxOrder)),
      maxResting: quoteUnits(String(m.risk.maxResting)),
      maxImbalance: baseUnits(String(m.risk.maxImbalance)),
    });
    await send(admin, call.to, call.data);
  }

  // Deposits: the admin's seed sets the ratio, then the deployer deposits in kind.
  const deposit = async (who: PrivateKeyAccount, amounts: { quote: string; base: string }) => {
    const quote = quoteUnits(amounts.quote),
      base = baseUnits(amounts.base);
    const held = await client.readContract({
      address: v.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [who.address],
    });
    if (held < base) {
      if (who.address === deployer.address) throw new Error(`The deployer lacks ${v.symbol}`);
      await send(
        deployer,
        v.token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [who.address, base - held],
        }),
      );
    }
    await send(
      deployer,
      plan.quote,
      encodeFunctionData({ abi: mockUsdg, functionName: "mint", args: [who.address, quote] }),
    );
    for (const [token, amount] of [
      [plan.quote, quote],
      [v.token, base],
    ] as const) {
      const call = approve(token, vault, amount);
      await send(who, call.to, call.data);
    }
    const call = deltaVaultDeposit(vault, quote, base, 0n, who.address);
    await send(who, call.to, call.data);
  };
  if (!v.seeded) {
    if ((await read<bigint>(vault, "totalSupply")) === 0n) await deposit(admin, v.seed);
    v.seeded = true;
    await save();
  }
  if (v.deposit && !v.deposited) {
    await deposit(deployer, v.deposit);
    v.deposited = true;
    await save();
  }
  console.info(`${v.symbol}: vault ${vault} provisioned with ${v.markets?.length ?? 0} market(s)`);
}
