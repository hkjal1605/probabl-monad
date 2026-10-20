/** The Δ-vaults this service curates: each registers the new markets of its stock, with risk
 * limits from a per-vault template, so its keeper quotes them over RFQ. */
import {
  DELTA_VAULT_ROLES,
  type DeltaVaultRisk,
  deltaVaultAbi,
  deltaVaultAddMarket,
  validateDeltaVaultRisk,
} from "@conditional-stocks/evm-client";
import {
  type Address,
  erc20Abi,
  getAddress,
  type Hex,
  type PublicClient,
  parseUnits,
  type WalletClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

/** Risk limits a newly registered market gets, in whole tokens. */
export interface RiskTemplate {
  /** Largest distance of a quote from the vault's oracle price, in bps of it. */
  bandBps: number;
  /** Quoting stops this long before the cutoff; shorter markets get a tenth of their remaining
   * life (at least a minute). */
  cutoffBufferSeconds: number;
  /** Largest notional of one quote, whole quote tokens. */
  maxOrderQuote: string;
  /** Largest notional of all the vault's resting orders in the market, whole quote tokens. */
  maxRestingQuote: string;
  /** Largest YES-minus-NO stock position, whole stock tokens. */
  maxImbalanceBase: string;
}
export interface VaultCurationConfig {
  vaults: { vault: Address; risk: RiskTemplate }[];
}

/** A market is registered only with at least this much quoting time before its buffer. */
const MIN_QUOTING_SECONDS = 300;

export class CuratedVault {
  private constructor(
    readonly address: Address,
    /** The vault's stock: it quotes only markets on this token. */
    readonly base: Address,
    /** Markets the vault can hold at once (`MAX_MARKETS`). */
    readonly capacity: number,
    private readonly limits: Omit<DeltaVaultRisk, "cutoffBuffer">,
    private readonly maxCutoffBuffer: number,
    private readonly client: PublicClient,
    private readonly wallet: WalletClient,
    private readonly curator: PrivateKeyAccount,
  ) {}

  /** Reads the vault's stock, quote decimals and capacity, and checks `curator` holds its role. */
  static async load(
    client: PublicClient,
    wallet: WalletClient,
    curator: PrivateKeyAccount,
    config: VaultCurationConfig["vaults"][number],
  ) {
    const address = getAddress(config.vault);
    const read = (functionName: string, args: readonly unknown[] = []) =>
      client.readContract({ address, abi: deltaVaultAbi, functionName, args } as never);
    const [base, quote, capacity, isCurator] = (await Promise.all([
      read("BASE"),
      read("QUOTE"),
      read("MAX_MARKETS"),
      read("hasRole", [DELTA_VAULT_ROLES.curator, curator.address]),
    ])) as [Address, Address, bigint, boolean];
    if (!isCurator) throw new Error(`${curator.address} is not the curator of vault ${address}`);
    const [baseDecimals, quoteDecimals] = await Promise.all(
      [base, quote].map((token) =>
        client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ),
    );
    const { risk } = config;
    const limits = {
      bandBps: risk.bandBps,
      maxOrder: parseUnits(risk.maxOrderQuote, Number(quoteDecimals)),
      maxResting: parseUnits(risk.maxRestingQuote, Number(quoteDecimals)),
      maxImbalance: parseUnits(risk.maxImbalanceBase, Number(baseDecimals)),
    };
    validateDeltaVaultRisk({ ...limits, cutoffBuffer: risk.cutoffBufferSeconds });
    return new CuratedVault(
      address,
      getAddress(base),
      Number(capacity),
      limits,
      risk.cutoffBufferSeconds,
      client,
      wallet,
      curator,
    );
  }

  /** The markets the vault has registered. */
  async markets() {
    const ids = (await this.client.readContract({
      address: this.address,
      abi: deltaVaultAbi,
      functionName: "markets",
    })) as readonly number[];
    return ids.map(Number);
  }

  /** The risk a market with `cutoff` gets now, or null when too little quoting time is left. */
  riskFor(cutoff: number, now: number): DeltaVaultRisk | null {
    const life = cutoff - now;
    const cutoffBuffer = Math.min(this.maxCutoffBuffer, Math.max(60, Math.floor(life / 10)));
    if (life - cutoffBuffer < MIN_QUOTING_SECONDS) return null;
    return { ...this.limits, cutoffBuffer };
  }

  async addMarket(market: number, risk: DeltaVaultRisk): Promise<Hex> {
    const { to, data } = deltaVaultAddMarket(this.address, market, risk);
    await this.client.call({ account: this.curator, to, data });
    const hash = await this.wallet.sendTransaction({
      account: this.curator,
      chain: this.client.chain,
      to,
      data,
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
    return hash;
  }
}
