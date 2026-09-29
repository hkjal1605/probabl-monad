/** Direct reads of the deployed exchange: roles, market ids, pools and token facts. */
import { conditionalStocksAbi, underlyingId } from "@conditional-stocks/evm-client";
import {
  type AdminDeployment,
  type AdminTransaction,
  preflightAdmin,
} from "@conditional-stocks/evm-client/admin";
import { catalogUnderlying } from "@conditional-stocks/shared/token-catalog";
import {
  type Address,
  createPublicClient,
  defineChain,
  erc20Abi,
  getAddress,
  type Hex,
  http,
  isAddress,
  type PublicClient,
  parseAbi,
} from "viem";
import { adminConfig } from "@/config/protocol";

let client: PublicClient | undefined;
export const publicClient = (): PublicClient =>
  (client ??= createPublicClient({
    chain: defineChain({
      id: adminConfig.chainId,
      name: adminConfig.chainName,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [adminConfig.rpcUrl] } },
    }),
    transport: http(adminConfig.rpcUrl, { batch: true }),
  }));

const exchange = { address: adminConfig.exchange, abi: conditionalStocksAbi } as const;

export async function assertNetwork(c: Pick<PublicClient, "getChainId"> = publicClient()) {
  if (/^0x0{40}$/.test(adminConfig.exchange))
    throw new Error(
      "NEXT_PUBLIC_EXCHANGE_ADDRESS is not configured. Set the deployment settings and restart the admin UI.",
    );
  if ((await c.getChainId()) !== adminConfig.chainId)
    throw new Error(`The RPC does not serve ${adminConfig.chainName}.`);
}

/** Governance role holders read from the exchange itself. */
export async function readRoles(c: PublicClient = publicClient()) {
  await assertNetwork(c);
  const [admin, [marketAdmin, guardian, resolutionAdmin], quote] = await Promise.all([
    c.readContract({ ...exchange, functionName: "admin" }),
    c.readContract({ ...exchange, functionName: "roles" }),
    c.readContract({ ...exchange, functionName: "quote" }),
  ]);
  return { admin, marketAdmin, guardian, resolutionAdmin, quote };
}

/** Everything `evidenceTransactions` needs: roles, the next market id, listed pools and the
 * catalogued underlying of each token (from its on-chain symbol). */
export async function readDeployment(
  tokens: readonly string[] = [],
  c: PublicClient = publicClient(),
) {
  const [roles, count, pools, symbols] = await Promise.all([
    readRoles(c),
    c.readContract({ ...exchange, functionName: "marketCount" }),
    Promise.all(
      tokens.map((token) =>
        c.readContract({ ...exchange, functionName: "pool", args: [getAddress(token)] }),
      ),
    ),
    Promise.all(
      tokens.map((token) =>
        c
          .readContract({ address: getAddress(token), abi: erc20Abi, functionName: "symbol" })
          .catch(() => null),
      ),
    ),
  ]);
  const listed = Object.fromEntries(
    tokens.map((token, i) => [getAddress(token), pools[i]!.listed]),
  );
  const underlyings = Object.fromEntries(
    tokens.map((token, i) => [getAddress(token), catalogUnderlying(symbols[i])]),
  );
  const deployment: AdminDeployment = {
    chainId: adminConfig.chainId,
    exchange: adminConfig.exchange,
    marketAdmin: roles.marketAdmin,
    resolutionAdmin: roles.resolutionAdmin,
    nextMarketId: count + 1,
    basePoolListed: (token) => listed[getAddress(token)] === true,
    baseUnderlying: (token) => {
      const symbol = underlyings[getAddress(token)];
      return symbol ? underlyingId(symbol) : null;
    },
  };
  return { roles, deployment, listed };
}

const issuerAbi = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function paused() view returns (bool)",
]);
export interface TokenInfo {
  address: Address;
  decimals: number;
  symbol: string | null;
  name: string | null;
  /** Issuer UI multiplier (economic shares per whole token); 1 when the token has none. */
  multiplierValue: number;
  paused: boolean;
}
export type TokenCheck =
  | { ok: true; token: TokenInfo }
  | { ok: false; address: string; error: string };

/** A token's on-chain facts. Contracts without `decimals()` are rejected; issuer extensions
 * (`uiMultiplier`, `paused`) are optional. */
export async function inspectToken(
  value: string,
  c: PublicClient = publicClient(),
): Promise<TokenCheck> {
  if (!isAddress(value, { strict: false }))
    return { ok: false, address: value, error: "Not a token address" };
  const address = getAddress(value);
  try {
    const code = await c.getCode({ address });
    if (!code || code === "0x")
      return { ok: false, address, error: "No contract is deployed at this address" };
    const [decimals, symbol, name, multiplier, paused] = await Promise.all([
      c.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      c.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
      c.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => null),
      c
        .readContract({ address, abi: issuerAbi, functionName: "uiMultiplier" })
        .catch(() => 10n ** 18n),
      c.readContract({ address, abi: issuerAbi, functionName: "paused" }).catch(() => false),
    ]);
    if (decimals > 36) return { ok: false, address, error: "Unsupported token decimals" };
    return {
      ok: true,
      token: {
        address,
        decimals,
        symbol: typeof symbol === "string" ? symbol.slice(0, 32) : null,
        name: typeof name === "string" ? name.slice(0, 64) : null,
        multiplierValue: Number(multiplier) / 1e18,
        paused,
      },
    };
  } catch {
    return { ok: false, address, error: "Not a readable ERC-20 token" };
  }
}

/** Simulates an admin call from its role account before any wallet prompt. */
export const preflightTransaction = (transaction: AdminTransaction) =>
  preflightAdmin(publicClient(), transaction);

export async function waitForAdminReceipt(hash: string) {
  const receipt = await publicClient().waitForTransactionReceipt({
    hash: hash as Hex,
    timeout: 180_000,
  });
  if (receipt.status !== "success")
    throw new Error("The transaction reverted; its changes were rolled back");
  return receipt;
}
