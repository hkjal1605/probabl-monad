import { type EIP1193Provider, getAddress, isAddress } from "viem";
import type { WalletKind } from "./session";

export interface WalletHandle {
  /** EIP-6963 reverse-DNS id, or "injected" for a legacy `window.ethereum`. */
  kind: WalletKind;
  name: string;
  /** Data-URI icon announced by the wallet. */
  icon: string | null;
  provider: EIP1193Provider;
}
export interface WalletSources {
  ethereum?: EIP1193Provider | undefined;
  announced?: readonly WalletHandle[];
}

const announced = new Map<string, WalletHandle>();

/** EIP-6963 discovery. Wallets announce themselves once asked; late announcements are kept. */
export function discoverWallets(target: Window) {
  const onAnnounce = (event: Event) => {
    const detail = (
      event as CustomEvent<{ info?: Record<string, unknown>; provider?: EIP1193Provider }>
    ).detail;
    const info = detail?.info,
      provider = detail?.provider;
    if (
      !info ||
      typeof info.rdns !== "string" ||
      !/^[a-z0-9.-]{1,100}$/i.test(info.rdns) ||
      typeof provider?.request !== "function"
    )
      return;
    announced.set(info.rdns, {
      kind: info.rdns,
      name: (typeof info.name === "string" && info.name.trim().slice(0, 40)) || info.rdns,
      icon:
        typeof info.icon === "string" && /^data:image\/(svg\+xml|png|webp|jpeg);/.test(info.icon)
          ? info.icon
          : null,
      provider,
    });
  };
  target.addEventListener("eip6963:announceProvider", onAnnounce);
  target.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => target.removeEventListener("eip6963:announceProvider", onAnnounce);
}

export const walletSources = (): WalletSources => ({
  ethereum: window.ethereum,
  announced: [...announced.values()],
});

export function availableWallets(sources: WalletSources): WalletHandle[] {
  const handles = [...(sources.announced ?? [])];
  if (sources.ethereum && !handles.some(({ provider }) => provider === sources.ethereum))
    handles.push({
      kind: "injected",
      name: "Browser wallet",
      icon: null,
      provider: sources.ethereum,
    });
  return handles;
}
export function findWallet(sources: WalletSources, preferred?: WalletKind): WalletHandle | null {
  const handles = availableWallets(sources);
  return (preferred ? handles.find(({ kind }) => kind === preferred) : handles[0]) ?? null;
}

/** The wallet's selected account. A silent restore never opens a wallet prompt. */
export async function connectWallet(handle: WalletHandle, silent: boolean) {
  const accounts = (await handle.provider.request({
    method: silent ? "eth_accounts" : "eth_requestAccounts",
  })) as unknown;
  const owner = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof owner !== "string" || !isAddress(owner, { strict: false }))
    throw new Error(
      silent
        ? "Connect this wallet manually to restore its saved session."
        : "The wallet returned no account.",
    );
  return getAddress(owner);
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
