/** Chain facts shared by the scripts, the API and the UIs. */

export const MONAD_TESTNET = 10143;

/** Testnets: mock assets, the asset faucet and relaxed reference-price freshness. */
export const TESTNET_CHAIN_IDS: readonly number[] = [31337, 46630, 84532, MONAD_TESTNET];

/** The chain's gas token: MON on Monad, ether elsewhere. */
export function nativeCurrency(chainId: number) {
  return chainId === MONAD_TESTNET
    ? { name: "Monad", symbol: "MON", decimals: 18 }
    : { name: "Ether", symbol: "ETH", decimals: 18 };
}
