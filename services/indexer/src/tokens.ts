import { type Address, erc20Abi, type PublicClient, parseAbi } from "viem";
import type { BaseLive } from "./projection.ts";

const issuerAbi = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function paused() view returns (bool)",
]);

/** External token reads. Calls share the client's Multicall3 batch. Wallet balances are cached
 * per owner and dropped when the owner's tokens move through the exchange, so concurrent and
 * repeated wallet views never fan out into separate round trips. */
export class TokenReader {
  private balances = new Map<
    Address,
    { tokens: string; at: number; value: Promise<Map<Address, bigint>> }
  >();
  readonly live = new Map<Address, BaseLive>();
  /** On-chain symbol and name of listed tokens, read once. */
  readonly identity = new Map<Address, { symbol: string | null; name: string | null }>();
  /** Increments when `live` or `identity` changes: views built from them are memoized by it. */
  version = 0;

  constructor(
    private readonly client: PublicClient,
    private readonly ttlMs = 15_000,
  ) {}

  /** ERC-20 wallet balances of `owner` (outside the exchange). */
  walletBalances(owner: Address, tokens: Address[]) {
    const signature = tokens.join(",");
    const cached = this.balances.get(owner);
    if (cached && cached.tokens === signature && Date.now() - cached.at < this.ttlMs)
      return cached.value;
    if (this.balances.size >= 4096) this.balances.clear();
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
    const entry = { tokens: signature, at: Date.now(), value };
    this.balances.set(owner, entry);
    value.catch(() => this.balances.get(owner) === entry && this.balances.delete(owner));
    return value;
  }

  /** Drops an owner's cached balances (its tokens moved into or out of the exchange). */
  forget(owner: Address) {
    this.balances.delete(owner);
  }

  async refreshIdentity(tokens: Address[]) {
    const unknown = tokens.filter((address) => !this.identity.has(address));
    if (!unknown.length) return;
    await Promise.all(
      unknown.map(async (address) => {
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
    this.version++;
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
    if (changed.length) this.version++;
    return changed;
  }
}
