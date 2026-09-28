import { type Address, erc20Abi, type PublicClient, parseAbi } from "viem";
import type { BaseLive } from "./projection.ts";

const issuerAbi = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function paused() view returns (bool)",
]);

/** External token reads. Calls share the client's JSON-RPC batch; results are cached briefly
 * so concurrent wallet views never fan out into separate round trips. */
export class TokenReader {
  private balances = new Map<string, { at: number; value: Promise<Map<Address, bigint>> }>();
  readonly live = new Map<Address, BaseLive>();
  /** On-chain symbol and name of listed tokens, read once. */
  readonly identity = new Map<Address, { symbol: string | null; name: string | null }>();

  constructor(
    private readonly client: PublicClient,
    private readonly ttlMs = 5_000,
  ) {}

  /** ERC-20 wallet balances of `owner` (outside the exchange). */
  walletBalances(owner: Address, tokens: Address[]) {
    const key = `${owner}:${tokens.join(",")}`;
    const cached = this.balances.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value;
    if (this.balances.size > 512) this.balances.clear();
    const value = Promise.all(
      tokens.map((address) =>
        this.client.readContract({
          address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        }),
      ),
    ).then((values) => new Map(tokens.map((token, i) => [token, values[i]!])));
    const entry = { at: Date.now(), value };
    this.balances.set(key, entry);
    value.catch(() => this.balances.get(key) === entry && this.balances.delete(key));
    return value;
  }

  async refreshIdentity(tokens: Address[]) {
    await Promise.all(
      tokens
        .filter((address) => !this.identity.has(address))
        .map(async (address) => {
          const [symbol, name] = await Promise.all([
            this.client
              .readContract({ address, abi: erc20Abi, functionName: "symbol" })
              .catch(() => null),
            this.client
              .readContract({ address, abi: erc20Abi, functionName: "name" })
              .catch(() => null),
          ]);
          this.identity.set(address, {
            symbol: typeof symbol === "string" ? symbol.slice(0, 32) : null,
            name: typeof name === "string" ? name.slice(0, 64) : null,
          });
        }),
    );
  }

  /** Issuer pause and UI multiplier of base tokens; functions a token lacks keep defaults.
   * Returns the tokens whose state changed. */
  async refreshLive(tokens: Address[]) {
    const changed: Address[] = [];
    await Promise.all(
      tokens.map(async (address) => {
        const [multiplier, paused] = await Promise.all([
          this.client
            .readContract({ address, abi: issuerAbi, functionName: "uiMultiplier" })
            .catch(() => 10n ** 18n),
          this.client
            .readContract({ address, abi: issuerAbi, functionName: "paused" })
            .catch(() => false),
        ]);
        const previous = this.live.get(address);
        if (!previous || previous.multiplier !== multiplier || previous.paused !== paused)
          changed.push(address);
        this.live.set(address, { multiplier, paused });
      }),
    );
    return changed;
  }
}
